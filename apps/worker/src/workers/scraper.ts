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
import { createSnapshotWithDelta } from '../../../../packages/db/src/snapshots';
import { createHash } from 'crypto';
import { parseUsageCsv } from './scraper/core/csv';
import { fromCsvParseResult, normalizeNetworkPayload } from './scraper/core/normalize';
import { computeTableHash } from './scraper/core/tableHash';
import { computeDeltaEvents } from './scraper/core/delta';

/**
 * Module: scraper
 *
 * Responsibilities:
 * - Expose a BullMQ `scraperQueue` for the scheduler/worker to enqueue scrape jobs
 * - Orchestrate an authenticated fetch of Cursor usage CSVs
 * - Persist raw captures as gzipped `raw_blob` records and enforce retention
 * - Normalize captured payloads into usage events and create snapshots (via DB helpers)
 *
 * High-level flow (runScrape):
 * 1. Parse environment and resolve an auth state directory
 * 2. Ensure Cursor authentication state is valid (cookies + session)
 * 3. Fetch the usage CSV using authenticated headers
 * 4. Persist the CSV as a raw blob (dedupe by content_hash), parse/normalize it,
 *    compute a stable view hash and create snapshots/deltas in the DB
 * 5. Trim old raw blobs according to retention policy
 *
 * Glossary (high-level, quick reference):
 * - `raw_blob`: Immutable stored capture of the original payload (gzipped bytes) with
 *   provenance metadata. The `content_hash` (sha256 of pre-gzip bytes) is used to
 *   deduplicate identical captures.
 * - `payload`: The raw bytes fetched from Cursor (CSV text or JSON) before gzip.
 * - `normalizedEvents` / `usage_events`: Rows produced by `mapNetworkJson` — normalized,
 *   strongly-typed usage records derived from `payload` and used to build snapshots.
 * - `billing period`: The start/end date range (YYYY-MM-DD) covering events in a capture.
 * - `stable view` / `tableHash`: A deterministic representation (billing period + ordered
 *   row summaries) hashed via `stableHash` to detect when the tabular view changed.
 * - `row_hash`: Stable per-row hash used by `usage_events` to dedupe identical rows.
 * - `snapshot`: A materialized, idempotent record representing a tableHash for a billing
 *   period; used to detect changes and store deltas.
 * - `delta`: The set of `normalizedEvents` newer than the latest existing `captured_at`
 *   for the billing period. Only deltas are persisted to avoid re-inserting previously
 *   persisted rows.
 * - `createSnapshotWithDelta`: DB helper that persists snapshot metadata and inserts
 *   delta `usage_events` for a capture.
 * - `trimRawBlobs`: Retention helper that keeps only the newest N `raw_blob` records.
 *
 * Notes:
 * - The scraper intentionally separates immutable raw captures (`raw_blob`) from the
 *   normalized rows/snapshots used by the UI so reprocessing is possible without losing
 *   auditability. The code in this file implements dedupe at multiple layers: blob-level
 *   (`content_hash`), row-level (`row_hash`), and snapshot-level (`tableHash`).
 */
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

/**
 * Compress a Buffer using gzip and return the compressed Buffer.
 *
 * Input:
 * - input: raw Buffer to compress
 *
 * Output:
 * - Promise that resolves to the gzipped Buffer
 *
 * Notes:
 * - Small wrapper around zlib.gzip that returns a Promise for convenience.
 */
function gzipBuffer(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gzip(input, (err, out) => (err ? reject(err) : resolve(out)));
  });
}


/**
 * Perform an HTTP GET to `targetUrl` using headers produced by an `AuthSession`.
 *
 * Inputs:
 * - authSession: AuthSession capable of producing valid HTTP headers for Cursor
 * - targetUrl: URL to fetch
 *
 * Output:
 * - Fetch Response object
 *
 * Side-effects:
 * - Relies on `authSession.toHttpHeaders` which may refresh cookies/session as needed.
 */
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
/**
 * Read and validate environment variables used by the scraper.
 *
 * Returns a normalized object:
 * - CURSOR_AUTH_STATE_DIR: string path to auth state directory
 * - RAW_BLOB_KEEP_N: number indicating retention count for raw blobs
 *
 * Throws an Error if required environment variables are invalid.
 */
function parseEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) throw new Error(`Invalid env: ${parsed.error.message}`);
  return parsed.data as { CURSOR_AUTH_STATE_DIR: string; RAW_BLOB_KEEP_N: number };
}

/**
 * Resolve the auth state directory to use.
 *
 * Strategy:
 * 1. If `requestedStateDir/cursor.state.json` exists, return resolved `requestedStateDir`.
 * 2. Otherwise walk up from CWD looking for workspace markers (pnpm-workspace.yaml, turbo.json, .git).
 *    If found, look for `apps/web/data/cursor.state.json` under repo root and return it if present.
 * 3. Fall back to the original requestedStateDir.
 *
 * This logic allows running the worker from different CWDs (local dev vs CI) while still
 * finding the shared `apps/web/data` auth state when present.
 */
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

/**
 * Ensure Cursor authentication state is available and valid.
 *
 * Steps:
 * - Run `getAuthHeaders(chosenStateDir)` to trigger any side-effectful refreshes/logging
 * - Construct an `AuthSession` and preview it (returns a short hash for logging)
 * - Use `verifyAuthState` as the primary probe; if it indicates failure attempt manual
 *   validation by reading raw cookies and running `validateRawCookies`.
 *
 * Returns:
 * - a ready-to-use `AuthSession` instance or throws an Error if auth cannot be validated.
 */
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

/**
 * Fetch the usage CSV export from Cursor using an authenticated session.
 *
 * Inputs:
 * - authSession: AuthSession used to sign the request
 *
 * Output:
 * - Buffer containing the raw CSV bytes
 *
 * Throws:
 * - Error when the HTTP response status is not 200
 */
async function fetchCsv(authSession: AuthSession) {
  const csvRes = await fetchWithCursorCookies(authSession, 'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens');
  if (csvRes.status !== 200) throw new Error(`csv fetch failed: status=${csvRes.status}`);
  return Buffer.from(await csvRes.arrayBuffer());
}

/**
 * Persist captured payloads and create snapshots/deltas from normalized events.
 * TODO: Split this function - it's too long as is trying to do too many things.
 * Separate the responsibilities for:
 * - Persisting full raw blobs - this should only be done weekly, and if there has been any changes since the previous blob persisted.
 * - Persisting delta raw blobs - this should be done for each capture, and if there has been any changes since the previous delta blob persisted.
 * - Creating snapshots - this should be done for each capture, and if there has been any changes since the previous snapshot created.
 *
 * Inputs:
 * - captured: array of captured items where each item is { url?, payload: Buffer, kind }
 *   - kind === 'html' indicates a CSV export; 'network_json' indicates an already-normalized JSON payload
 * - keepN: number of raw blobs to retain (retention)
 *
 * Behavior:
 * - For each item, compute a content hash (pre-gzip) and check for an existing `raw_blob`.
 * - Parse the payload (CSV -> normalized JSON or JSON.parse).
 * - If content is new, gzip and persist as `raw_blob` with provenance metadata.
 * - Normalize payload into usage events using `mapNetworkJson`.
 * - Compute a stable view hash and determine the billing period.
 * - Find the latest existing capture for that billing period to compute delta events.
 * - Call `createSnapshotWithDelta` to persist snapshot and delta usage events.
 * - Trim raw blobs to `keepN` at the end.
 *
 * Returns:
 * - number of newly created raw_blob records (saved)
 */
/**
 * Persist blob if not existing and return blob id (may reuse existing). Exported for testing/mocking.
 */
export async function ensureBlob(
  item: { url?: string; payload: Buffer; kind: 'html' | 'network_json' },
  contentHash: string,
  nowTs?: Date,
): Promise<{ id: string; wasNew: boolean }> {
  const nowLocal = nowTs ?? new Date();
  const existing = await prisma.rawBlob.findFirst({ where: { content_hash: contentHash }, select: { id: true } });
  if (existing) {
    console.log('runScrape: duplicate content detected, using existing blob id=', existing.id);
    return { id: existing.id as string, wasNew: false };
  }
  const gz = await gzipBuffer(item.payload);
  const blob = await prisma.rawBlob.create({
    data: {
      captured_at: nowLocal,
      kind: item.kind,
      url: item.url,
      payload: gz,
      content_hash: contentHash,
      content_type: item.kind === 'html' ? 'text/csv' : 'application/json',
      schema_version: 'v1',
      metadata: {
        provenance: {
          method: 'http_csv',
          url: item.url ?? null,
          fetched_at: nowLocal.toISOString(),
          size_bytes: item.payload.length,
        },
      },
    },
    select: { id: true },
  });
  console.log('runScrape: saved raw blob, id=', blob.id, 'kind=', item.kind);
  return { id: blob.id as string, wasNew: true };
}

/**
 * Find latest existing capture timestamp for a billing period. Exported for testing.
 */
export async function findMaxExistingCapture(billingStart: Date | null, billingEnd: Date | null) {
  if (!billingStart || !billingEnd) return null;
  try {
    const latestSnapshot = await (prisma as any).snapshot.findFirst({
      where: { billing_period_start: billingStart, billing_period_end: billingEnd },
      orderBy: { captured_at: 'desc' },
      select: { captured_at: true },
    });
    if (latestSnapshot) return latestSnapshot.captured_at as Date;
  } catch (err) {
    try {
      const latest = await (prisma as any).usageEvent.findFirst({
        where: { billing_period_start: billingStart, billing_period_end: billingEnd },
        orderBy: { captured_at: 'desc' },
        select: { captured_at: true },
      });
      if (latest) return latest.captured_at as Date;
    } catch (err2) {
      console.warn('runScrape: failed to determine latest existing capture for billing period', err, err2);
      return null;
    }
  }
  return null;
}

async function persistCaptured(captured: Array<{ url?: string; payload: Buffer; kind: 'html' | 'network_json' }>, keepN: number) {
  let saved = 0;
  const now = new Date();
  console.log('runScrape: captured count=', captured.length);

  for (const item of captured) {
    const contentHash = createHash('sha256').update(item.payload).digest('hex');

    let payloadForNormalization: unknown = null;
    if (item.kind === 'network_json') {
      console.log('runScrape: parsing network json');
      try {
        payloadForNormalization = JSON.parse(item.payload.toString('utf8'));
      } catch (err) {
        console.warn('runScrape: network json parse failed', err);
      }
    } else {
      console.log('runScrape: parsing CSV');
      const parsedCsv = parseUsageCsv(item.payload);
      if (!parsedCsv) {
        console.warn('runScrape: CSV parse failed');
      } else {
        payloadForNormalization = fromCsvParseResult(parsedCsv);
      }
    }

    const blob = await ensureBlob(item, contentHash, now);
    if (blob.wasNew) saved += 1;

    if (!payloadForNormalization) continue;

    try {
      const normalizedEvents = normalizeNetworkPayload(payloadForNormalization, now, blob.id ?? null);
      const { tableHash, billingStart, billingEnd, totalRowsCount } = computeTableHash(normalizedEvents);
      const maxExisting = await findMaxExistingCapture(billingStart, billingEnd);
      const deltaEvents = computeDeltaEvents(normalizedEvents, maxExisting);

      const res = await createSnapshotWithDelta({
        billingPeriodStart: billingStart,
        billingPeriodEnd: billingEnd,
        tableHash,
        totalRowsCount,
        capturedAt: now,
        normalizedDeltaEvents: deltaEvents,
      });
      console.log('runScrape: snapshot result', res);
    } catch (e) {
      console.warn('runScrape: snapshot creation failed', e);
    }
  }
  await trimRawBlobs(keepN);
  return saved;
}

/**
 * Top-level scrape orchestration.
 *
 * Steps:
 * - Parse env and resolve the auth state directory
 * - Ensure authentication is valid
 * - Fetch the CSV export
 * - Package the CSV into a captured item and hand off to `persistCaptured`
 *
 * Returns:
 * - ScrapeResult containing the number of newly persisted raw blobs
 */
export async function runScrape(): Promise<ScrapeResult> {
  const env = parseEnv();
  console.log('runScrape: env', { CURSOR_AUTH_STATE_DIR: env.CURSOR_AUTH_STATE_DIR });

  const requestedStateDir = env.CURSOR_AUTH_STATE_DIR || './data';
  const chosenStateDir = resolveStateDir(requestedStateDir);
  console.log('runScrape: using auth state dir:', chosenStateDir);

  const authSession = await ensureAuth(chosenStateDir);

  const csvBuf = await fetchCsv(authSession);

  // Short-circuit: if this CSV payload is identical to a previously stored raw blob,
  // skip further processing to avoid duplicate snapshots and storage.
  try {
    const contentHash = createHash('sha256').update(csvBuf).digest('hex');
    const existing = await (prisma as any).rawBlob.findFirst({ where: { content_hash: contentHash }, select: { id: true } });
    if (existing) {
      console.log('runScrape: CSV identical to existing raw blob id=', existing.id, ' — skipping persist');
      return { savedCount: 0 };
    }
  } catch (err) {
    console.warn('runScrape: failed short-circuit check for identical CSV, proceeding with persist', err);
  }

  const captured: Array<{ url?: string; payload: Buffer; kind: 'html' | 'network_json' }> = [];
  captured.push({ url: 'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens', payload: csvBuf, kind: 'html' });

  const saved = await persistCaptured(captured, env.RAW_BLOB_KEEP_N);
  return { savedCount: saved };
}

/**
 * Test helper: ingest a list of fixtures as gzipped `raw_blob` records.
 *
 * Inputs:
 * - fixtures: array of { url?, json } payloads
 * - keepN: retention count to pass to `trimRawBlobs`
 *
 * Behavior:
 * - For each fixture JSON, stringify, gzip, and create a `raw_blob` with kind `network_json`.
 * - Calls `trimRawBlobs(keepN)` to enforce retention.
 *
 * Returns:
 * - ScrapeResult with the number of fixtures persisted.
 */
export async function ingestFixtures(fixtures: Array<{ url?: string; json: unknown }>, keepN = 20): Promise<ScrapeResult> {
  let saved = 0;
  const now = new Date();
  for (const f of fixtures) {
    const buf = Buffer.from(JSON.stringify(f.json));
    const contentHash = createHash('sha256').update(buf).digest('hex');
    const gz = await gzipBuffer(buf);
    await prisma.rawBlob.create({
      data: {
        captured_at: now,
        kind: 'network_json',
        url: f.url,
        payload: gz,
        content_hash: contentHash,
        content_type: 'application/json',
        schema_version: 'v1',
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


