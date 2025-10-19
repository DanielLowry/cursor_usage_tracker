// Relative path: apps/worker/src/workers/scraper.ts

// Prisma client & helper DB functions used to persist raw blobs and snapshots
import prisma from '../../../../packages/db/src/client';
import { trimRawBlobs } from '../../../../packages/db/src/retention';
// Cursor authentication state management
import { getAuthHeaders, validateRawCookies } from '../../../../packages/shared/cursor-auth/src';
import { AuthSession } from '../../../../packages/shared/cursor-auth/src/AuthSession';
// Env validation
import { z } from 'zod';
// gzip helper for storing compressed payloads
import * as zlib from 'zlib';
// URL utilities
// URL utilities (not used in build; omitted to satisfy linter)
import * as fs from 'fs';
import * as path from 'path';
import { Queue } from 'bullmq';
import { getRedis } from '@cursor-usage/redis';

// Export a lazy-initialized queue to avoid runtime ordering issues when this
// module is imported by the scheduler or when the worker runs in different
// execution contexts. The scheduler expects a `scraperQueue` with an `.add`
// method, so expose an instance created from the shared redis connection.
const connection = getRedis();
export const scraperQueue = new Queue('scraper', { connection });


// Expected environment variables and basic validation/transforms
const envSchema = z.object({
  // Directory for storing Cursor authentication state
  CURSOR_AUTH_STATE_DIR: z.string().min(1).default('./data'),
  // How many raw captures to keep (stored as string in env, converted to number)
  RAW_BLOB_KEEP_N: z
    .string()
    .optional()
    .default('20')
    .transform((s) => parseInt(s, 10)),
});

export type ScrapeResult = {
  savedCount: number;
};

// Compress a Buffer using gzip and return the compressed Buffer
function gzipBuffer(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gzip(input, (err, out) => (err ? reject(err) : resolve(out)));
  });
}


async function fetchWithCursorCookies(authSession: AuthSession, targetUrl: string) {
  const headers = await authSession.toHttpHeaders(targetUrl);
  const res = await fetch(targetUrl, { method: 'GET', headers });
  return res;
}

// Main scrape routine.
// - Validates environment
// - Performs a pre-auth probe against usage-summary using stored cookies
// - Downloads CSV export via authenticated fetch
// - Persists raw CSV as compressed blob and enforces retention
export async function runScrape(): Promise<ScrapeResult> {
  // validate and normalize env vars
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid env: ${parsed.error.message}`);
  }
  const env = parsed.data as { CURSOR_AUTH_STATE_DIR: string; RAW_BLOB_KEEP_N: number };
  console.log('runScrape: env', { CURSOR_AUTH_STATE_DIR: env.CURSOR_AUTH_STATE_DIR });
  // Resolve canonical state path. Worker default './data' may be relative to apps/worker;
  // prefer repo-level web data folder when worker-local file is missing.
  // Strategy:
  // 1) If the configured CURSOR_AUTH_STATE_DIR contains a cursor.state.json file, use it.
  // 2) Otherwise, walk up from the current cwd to find the repo root (using pnpm-workspace.yaml, turbo.json, or .git)
  //    and check `apps/web/data/cursor.state.json` there.
  // 3) If neither exists, fall back to the configured directory (may cause validation to fail later).
  const requestedStateDir = env.CURSOR_AUTH_STATE_DIR || './data';
  const requestedStatePath = path.join(path.resolve(requestedStateDir), 'cursor.state.json');
  let chosenStateDir = requestedStateDir;

  if (fs.existsSync(requestedStatePath)) {
    // configured path already contains state file
    chosenStateDir = path.resolve(requestedStateDir);
    console.log('runScrape: using configured auth state dir:', chosenStateDir);
  } else {
    // try repo web data path — robustly find repo root by walking up from current cwd
    // Look for a repo-level marker (pnpm-workspace.yaml, turbo.json, or .git)
    let repoRoot = process.cwd();
    // Walk up the filesystem to find a repo-level marker. Use a bounded loop
    // (max 100 iterations) to avoid constant-condition lint errors and to be
    // defensive against pathological symlinked directory structures.
    let foundRoot = false;
    for (let i = 0; i < 100; i++) {
      const marker1 = path.join(repoRoot, 'pnpm-workspace.yaml');
      const marker2 = path.join(repoRoot, 'turbo.json');
      const marker3 = path.join(repoRoot, '.git');
      if (fs.existsSync(marker1) || fs.existsSync(marker2) || fs.existsSync(marker3)) { foundRoot = true; break; }
      const parent = path.dirname(repoRoot);
      if (parent === repoRoot) break;
      repoRoot = parent;
    }
    if (!foundRoot) repoRoot = process.cwd();
    const alt = path.join(repoRoot, 'apps', 'web', 'data');
    const altStatePath = path.join(alt, 'cursor.state.json');
    if (fs.existsSync(altStatePath)) {
      console.log('runScrape: using alternative auth state dir (repo-root):', alt);
      chosenStateDir = alt;
    } else {
      console.log('runScrape: no cursor.state.json found at', requestedStatePath, 'or', altStatePath);
      chosenStateDir = requestedStateDir; // keep original, let validation fail
    }
  }

  // Build cookie header from shared canonical state (this will emit readRawCookies + getAuthHeaders logs)
  await getAuthHeaders(chosenStateDir);

  // Also log the preview hash for parity with previous behavior and create an AuthSession
  const authSession = new AuthSession(chosenStateDir);
  const { hash } = await authSession.preview();
  console.log('runScrape: auth session hash:', hash);

  // Pre-auth probe: reuse shared validateRawCookies helper which encapsulates the
  // usage-summary fetch and validation logic.
  // readRawCookies returns a Promise, so await it before passing to validateRawCookies
  const { readRawCookies } = await import('../../../../packages/shared/cursor-auth/src');
  const rawCookies = await readRawCookies(chosenStateDir);
  const cookiesValidation = await validateRawCookies(rawCookies);
  if (!cookiesValidation.ok) {
    throw new Error(`auth probe failed: status=${cookiesValidation.status} reason=${cookiesValidation.reason}`);
  }

  // Fetch CSV export directly using same Cookie header
  const csvRes = await fetchWithCursorCookies(authSession, 'https://cursor.com/api/dashboard/export-usage-events-csv');
  const csvStatus = csvRes.status;
  if (csvStatus !== 200) {
    throw new Error(`csv fetch failed: status=${csvStatus}`);
  }
  const csvBuf = Buffer.from(await csvRes.arrayBuffer());

  // Capture and persist
  const captured: Array<{ url?: string; payload: Buffer; kind: 'html' | 'network_json' }> = [];
  captured.push({ url: 'https://cursor.com/api/dashboard/export-usage-events-csv', payload: csvBuf, kind: 'html' });

  // Persist any captured payloads as compressed raw blobs and attempt to create snapshots
  let saved = 0;
  const now = new Date();
  console.log('runScrape: captured count=', captured.length);
  for (const item of captured) {
    const gz = await gzipBuffer(item.payload);
    const blob = await prisma.rawBlob.create({
      data: {
        captured_at: now,
        kind: item.kind,
        url: item.url,
        payload: gz,
      },
      select: { id: true },
    });
    // For CSV payloads, we currently persist only the raw blob.
    // A CSV→normalized mapping can be added later to feed snapshots/events.
    saved += 1;
    console.log('runScrape: saved one blob, id=', blob.id, 'kind=', item.kind);
  }

  // Trim raw blobs retention to the configured number
  await trimRawBlobs(env.RAW_BLOB_KEEP_N);
  return { savedCount: saved };
}

export async function ingestFixtures(fixtures: Array<{ url?: string; json: unknown }>, keepN = 20): Promise<ScrapeResult> {
  let saved = 0;
  const now = new Date();
  for (const f of fixtures) {
    const buf = Buffer.from(JSON.stringify(f.json));
    const gz = await gzipBuffer(buf);
    await prisma.rawBlob.create({
      data: {
        captured_at: now,
        kind: 'network_json',
        url: f.url,
        payload: gz,
      },
    });
    saved += 1;
  }
  await trimRawBlobs(keepN);
  return { savedCount: saved };
}


// Lightweight CLI wrapper so this module actually runs when executed directly
async function _runCli() {
  try {
    console.log('scrape: starting');
    const res = await runScrape();
    console.log('scrape: finished', { result: res });
    process.exit(0);
  } catch (err) {
    console.error('scrape: error', err);
    process.exit(2);
  }
}

// Heuristic: when executed via `tsx src/workers/scrape.ts`, process.argv[1] will be the script path.
// Use a safe basename check to avoid using `import.meta` which may be disallowed by tsconfig.
const _invokedDirectly = (() => {
  const entry = process.argv[1] || '';
  const parts = entry.split(/[\\/]/);
  const name = parts[parts.length - 1] || '';
  return name === 'scrape.ts' || name === 'scrape.js';
})();

if (_invokedDirectly) {
  void _runCli();
}


