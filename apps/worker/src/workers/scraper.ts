// Relative path: apps/worker/src/workers/scraper.ts

// Prisma client & helper DB functions used to persist raw blobs and snapshots
import prisma from '../../../../packages/db/src/client';
import { trimRawBlobs } from '../../../../packages/db/src/retention';
// Cursor authentication state management
import { getAuthHeaders } from '../../../../packages/shared/cursor-auth/src';
// Env validation
import { z } from 'zod';
// gzip helper for storing compressed payloads
import * as zlib from 'zlib';
// URL utilities
import * as url from 'url';


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


async function fetchWithCursorCookies(targetUrl: string, cookieHeader: string | null) {
  const headers: Record<string, string> = {
    'Accept': '*/*',
  };
  if (cookieHeader) headers['Cookie'] = cookieHeader;
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

  // Build cookie header from shared canonical state
  const headers = await getAuthHeaders(env.CURSOR_AUTH_STATE_DIR);
  const cookieHeader = headers['Cookie'] || null;

  // Pre-auth probe: usage-summary
  const usageRes = await fetchWithCursorCookies('https://cursor.com/api/usage-summary', cookieHeader);
  const usageContentType = (usageRes.headers.get('content-type') || '').toLowerCase();
  let usageJson: any = null;
  try { usageJson = await usageRes.json(); } catch { /* ignore */ }
  const usageStatus = usageRes.status;
  const usageKeys = usageJson && typeof usageJson === 'object' && !Array.isArray(usageJson) ? Object.keys(usageJson) : [];
  const required = ['billingCycleStart', 'billingCycleEnd', 'membershipType'];
  const hasRequired = required.every(k => usageJson && k in usageJson);
  if (usageStatus !== 200 || !/application\/json/.test(usageContentType) || !hasRequired) {
    throw new Error(`auth probe failed: status=${usageStatus} ct=${usageContentType} keys=${usageKeys.join(',')}`);
  }

  // Fetch CSV export directly using same Cookie header
  const csvRes = await fetchWithCursorCookies('https://cursor.com/api/dashboard/export-usage-events-csv', cookieHeader);
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


