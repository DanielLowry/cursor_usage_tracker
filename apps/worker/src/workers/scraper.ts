// Relative path: apps/worker/src/workers/scraper.ts

// Prisma client & helper DB functions used to persist raw blobs and snapshots
import prisma from '../../../../packages/db/src/client';
import { trimRawBlobs } from '../../../../packages/db/src/retention';
// Cursor authentication state management
import { getAuthHeaders, validateRawCookies, verifyAuthState, readRawCookies } from '../../../../packages/shared/cursor-auth/src';
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
import { createSnapshotIfChanged } from '../../../../packages/db/src/snapshots';
import { createHash } from 'crypto';
import { parse as parseCsv } from 'csv-parse/sync';

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
// Helpers extracted from runScrape for clarity and testability
function parseEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) throw new Error(`Invalid env: ${parsed.error.message}`);
  return parsed.data as { CURSOR_AUTH_STATE_DIR: string; RAW_BLOB_KEEP_N: number };
}

function resolveStateDir(requestedStateDir: string) {
  const requestedStatePath = path.join(path.resolve(requestedStateDir), 'cursor.state.json');
  if (fs.existsSync(requestedStatePath)) {
    return path.resolve(requestedStateDir);
  }

  let repoRoot = process.cwd();
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
  if (fs.existsSync(altStatePath)) return alt;
  return requestedStateDir;
}

async function ensureAuth(chosenStateDir: string) {
  // Preserve side-effect logging from getAuthHeaders
  await getAuthHeaders(chosenStateDir);

  const authSession = new AuthSession(chosenStateDir);
  const { hash } = await authSession.preview();
  console.log('runScrape: auth session hash:', hash);

  // Use shared wrapper verifyAuthState; fallback to manual validation if needed
  const result = await verifyAuthState(chosenStateDir);
  if (!result.proof?.ok) {
    const rawCookies = await readRawCookies(chosenStateDir);
    const proof = await validateRawCookies(rawCookies);
    if (!proof.ok) throw new Error(`auth probe failed: status=${proof.status} reason=${proof.reason}`);
  }

  return authSession;
}

async function fetchCsv(authSession: AuthSession) {
  const csvRes = await fetchWithCursorCookies(authSession, 'https://cursor.com/api/dashboard/export-usage-events-csv');
  if (csvRes.status !== 200) throw new Error(`csv fetch failed: status=${csvRes.status}`);
  return Buffer.from(await csvRes.arrayBuffer());
}

async function persistCaptured(captured: Array<{ url?: string; payload: Buffer; kind: 'html' | 'network_json' }>, keepN: number) {
  let saved = 0;
  const now = new Date();
  console.log('runScrape: captured count=', captured.length);
  for (const item of captured) {
    // compute content hash (pre-gzip) for dedup
    const contentHash = createHash('sha256').update(item.payload).digest('hex');
    const existing = await (prisma as any).rawBlob.findFirst({ where: { content_hash: contentHash }, select: { id: true } });

    // Always parse and attempt snapshot creation, even if duplicate blob content
    let parsedPayload: unknown = null;
    if (item.kind === 'network_json') {
      console.log('runScrape: parsing network json');
      try { parsedPayload = JSON.parse(item.payload.toString('utf8')); } catch { parsedPayload = null; }
    } else if (item.kind === 'html') {
      console.log('runScrape: parsing CSV');
      // CSV -> normalized payload expected by mapNetworkJson
      try {
        const csvText = item.payload.toString('utf8');
        const records: Array<Record<string, string>> = parseCsv(csvText, { columns: true, skip_empty_lines: true, trim: true });
        if (records.length > 0) {
          // Determine billing period from first row Date
          const iso = records[0]['Date'];
          const d = new Date(iso);
          const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
          const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
          const rows = records.map((r) => ({
            model: String(r['Model'] || '').trim(),
            input_with_cache_write_tokens: Number(r['Input (w/ Cache Write)'] || 0),
            input_without_cache_write_tokens: Number(r['Input (w/o Cache Write)'] || 0),
            cache_read_tokens: Number(r['Cache Read'] || 0),
            output_tokens: Number(r['Output Tokens'] || 0),
            total_tokens: Number(r['Total Tokens'] || 0),
          }));
          parsedPayload = { billing_period: { start, end }, rows } as unknown;
        } else {
          parsedPayload = { billing_period: undefined, rows: [] } as unknown;
        }
      } catch (e) {
        console.warn('runScrape: CSV parse failed', e);
        parsedPayload = null;
      }
    }

    let blobId: string | null = null;
    if (!existing) {
      const gz = await gzipBuffer(item.payload);
      const blob = await (prisma as any).rawBlob.create({
        data: {
          captured_at: now,
          kind: item.kind,
          url: item.url,
          payload: gz,
          content_hash: contentHash,
          content_type: item.kind === 'html' ? 'text/csv' : 'application/json',
          schema_version: 'v1',
        },
        select: { id: true },
      });
      saved += 1;
      blobId = blob.id;
      console.log('runScrape: saved one blob, id=', blob.id, 'kind=', item.kind);
    } else {
      blobId = existing.id;
      console.log('runScrape: duplicate content detected, using existing blob id=', blobId);
    }

    if (parsedPayload) {
      try {
        const res = await createSnapshotIfChanged({ payload: parsedPayload, capturedAt: now, rawBlobId: blobId });
        console.log('runScrape: snapshot result', res);
      } catch (e) {
        console.warn('runScrape: snapshot creation failed', e);
      }
    }
  }
  await trimRawBlobs(keepN);
  return saved;
}

export async function runScrape(): Promise<ScrapeResult> {
  const env = parseEnv();
  console.log('runScrape: env', { CURSOR_AUTH_STATE_DIR: env.CURSOR_AUTH_STATE_DIR });

  const requestedStateDir = env.CURSOR_AUTH_STATE_DIR || './data';
  const chosenStateDir = resolveStateDir(requestedStateDir);
  console.log('runScrape: using auth state dir:', chosenStateDir);

  const authSession = await ensureAuth(chosenStateDir);

  const csvBuf = await fetchCsv(authSession);

  const captured: Array<{ url?: string; payload: Buffer; kind: 'html' | 'network_json' }> = [];
  captured.push({ url: 'https://cursor.com/api/dashboard/export-usage-events-csv', payload: csvBuf, kind: 'html' });

  const saved = await persistCaptured(captured, env.RAW_BLOB_KEEP_N);
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


