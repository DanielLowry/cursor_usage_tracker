// Relative path: apps/worker/src/workers/scraper.ts

// Scraper worker entrypoint: orchestrates fetching Cursor usage data, normalizing it,
// computing a stable table hash, deriving delta events, and persisting a snapshot.
// The heavy-lifting is delegated to focused modules under `./scraper/*` and this
// file focuses on orchestration and environment wiring.
import { Queue } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { getRedis } from '@cursor-usage/redis';
import { parseUsageCsv } from './scraper/csv';
import { normalizeCapturedPayload, type NormalizedUsageEvent } from './scraper/normalize';
import { buildStableViewHash as buildStableViewHashCore } from './scraper/tableHash';
import { computeDeltaEvents } from './scraper/delta';
import { ScraperError, isScraperError } from './scraper/errors';
import type { BlobStorePort, ClockPort, FetchPort, Logger, SnapshotStorePort } from './scraper/ports';
import { CursorCsvFetchAdapter, DEFAULT_USAGE_EXPORT_URL } from './scraper/adapters/fetch';
import { PrismaBlobStore } from './scraper/adapters/blobStore';
import { PrismaSnapshotStore } from './scraper/adapters/snapshotStore';

// Exported BullMQ queue used by the worker process elsewhere to enqueue scraping jobs.
const connection = getRedis();
export const scraperQueue = new Queue('scraper', { connection });

// Environment variables required by the scraper with defaults and validation.
const envSchema = z.object({
  CURSOR_AUTH_STATE_DIR: z.string().min(1).default('./data'),
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
 * SystemClock implements `ClockPort` using the host system time.
 */
class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}

/**
 * ConsoleLogger implements `Logger` by delegating to the process console.
 * Messages are structured and can carry optional context objects.
 */
class ConsoleLogger implements Logger {
  debug(message: string, context: Record<string, unknown> = {}): void {
    console.debug(message, context);
  }
  info(message: string, context: Record<string, unknown> = {}): void {
    console.info(message, context);
  }
  warn(message: string, context: Record<string, unknown> = {}): void {
    console.warn(message, context);
  }
  error(message: string, context: Record<string, unknown> = {}): void {
    console.error(message, context);
  }
}

export type ScraperOrchestratorDependencies = {
  fetchPort: FetchPort;
  blobStore: BlobStorePort;
  snapshotStore: SnapshotStorePort;
  clock: ClockPort;
  logger: Logger;
  retentionCount: number;
  csvSourceUrl: string;
};

/**
 * ScraperOrchestrator coordinates the end-to-end scrape:
 * - Fetch CSV export from Cursor via `FetchPort`
 * - Persist raw blob if new via `BlobStorePort` (dedup by content-hash)
 * - Parse CSV and normalize into `NormalizedUsageEvent[]`
 * - Compute a stable table hash and billing period from normalized events
 * - Compute delta events (new rows since last snapshot in the billing period)
 * - Persist snapshot with delta via `SnapshotStorePort`
 * - Trim raw blob retention to keep storage bounded
 */
export class ScraperOrchestrator {
  constructor(private readonly deps: ScraperOrchestratorDependencies) {}

  /**
   * Runs a single scrape cycle. Returns how many raw blobs were saved (0 if duplicate).
   * Throws `ScraperError` on known failure categories.
   */
  async run(): Promise<ScrapeResult> {
    const { fetchPort, blobStore, snapshotStore, clock, logger, retentionCount, csvSourceUrl } = this.deps;

    logger.info('scraper.run.start');

    let csvBuffer: Buffer;
    try {
      csvBuffer = await fetchPort.fetchCsvExport();
    } catch (err) {
      if (isScraperError(err)) {
        logger.error('scraper.fetch.failed', { code: err.code, message: err.message, details: err.details });
        throw err;
      }
      logger.error('scraper.fetch.failed', { error: err });
      throw new ScraperError('FETCH_ERROR', 'failed to fetch usage csv', { cause: err });
    }

    logger.debug('scraper.fetch.completed', { bytes: csvBuffer.length });

    const capturedAt = clock.now();

    const blobResult = await blobStore.saveIfNew({
      payload: csvBuffer,
      kind: 'html',
      url: csvSourceUrl,
      capturedAt,
    });

    if (blobResult.outcome === 'duplicate') {
      logger.info('scraper.run.duplicate_blob', {
        blobId: blobResult.blobId,
        contentHash: blobResult.contentHash,
      });
      return { savedCount: 0 };
    }

    const csvText = csvBuffer.toString('utf8');
    const parsedCsv = parseUsageCsv(csvText);
    if (!parsedCsv) {
      logger.error('scraper.csv.parse_failed');
      throw new ScraperError('CSV_PARSE_ERROR', 'failed to parse usage csv');
    }

    logger.debug('scraper.csv.parsed', { rows: parsedCsv.rows.length });

    let normalizedEvents: NormalizedUsageEvent[];
    try {
      normalizedEvents = normalizeCapturedPayload(parsedCsv, capturedAt, blobResult.blobId);
    } catch (err) {
      logger.error('scraper.normalize.failed', { error: err instanceof Error ? err.message : String(err) });
      throw new ScraperError('VALIDATION_ERROR', 'failed to normalize captured payload', { cause: err });
    }

    const { tableHash, billingPeriodStart, billingPeriodEnd, totalRowsCount } =
      buildStableViewHashCore(normalizedEvents);
    logger.info('scraper.table_hash.computed', {
      tableHash,
      totalRowsCount,
      billingPeriodStart: billingPeriodStart?.toISOString() ?? null,
      billingPeriodEnd: billingPeriodEnd?.toISOString() ?? null,
    });

    const latestCapture = await snapshotStore.findLatestCapture({ start: billingPeriodStart, end: billingPeriodEnd });
    logger.debug('scraper.snapshot.latest_capture', {
      latestCapture: latestCapture ? latestCapture.toISOString() : null,
    });

    const deltaEvents = computeDeltaEvents(normalizedEvents, latestCapture);
    logger.info('scraper.delta.ready', { deltaCount: deltaEvents.length });

    await snapshotStore.persistSnapshot({
      billingPeriodStart,
      billingPeriodEnd,
      tableHash,
      totalRowsCount,
      capturedAt,
      deltaEvents,
    });

    await blobStore.trimRetention(retentionCount);

    const savedCount = blobResult.outcome === 'saved' ? 1 : 0;
    logger.info('scraper.run.complete', { savedCount, blobId: blobResult.blobId });
    return { savedCount };
  }
}

/**
 * Parses and validates environment variables needed by the scraper.
 */
function parseEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) throw new ScraperError('VALIDATION_ERROR', `invalid env: ${parsed.error.message}`);
  return parsed.data as { CURSOR_AUTH_STATE_DIR: string; RAW_BLOB_KEEP_N: number };
}

/**
 * Resolves the directory containing Cursor auth state. If the requested directory
 * does not contain `cursor.state.json`, attempts to locate a plausible
 * alternative within the repository (e.g., `apps/web/data`).
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
    if (fs.existsSync(marker1) || fs.existsSync(marker2) || fs.existsSync(marker3)) {
      foundRoot = true;
      break;
    }
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
 * CLI-friendly wrapper that wires concrete adapters and runs a single scrape.
 */
export async function runScrape(): Promise<ScrapeResult> {
  const env = parseEnv();
  const logger = new ConsoleLogger();

  logger.info('scraper.env', { CURSOR_AUTH_STATE_DIR: env.CURSOR_AUTH_STATE_DIR });

  const requestedStateDir = env.CURSOR_AUTH_STATE_DIR || './data';
  const chosenStateDir = resolveStateDir(requestedStateDir);
  logger.info('scraper.auth_state_dir.resolved', { chosenStateDir });

  const fetchPort = new CursorCsvFetchAdapter({ stateDir: chosenStateDir, logger });
  const blobStore = new PrismaBlobStore({ logger });
  const snapshotStore = new PrismaSnapshotStore({ logger });
  const clock = new SystemClock();

  const orchestrator = new ScraperOrchestrator({
    fetchPort,
    blobStore,
    snapshotStore,
    clock,
    logger,
    retentionCount: env.RAW_BLOB_KEEP_N,
    csvSourceUrl: DEFAULT_USAGE_EXPORT_URL,
  });

  try {
    return await orchestrator.run();
  } catch (err) {
    if (isScraperError(err)) {
      logger.error('scraper.run.failed', { code: err.code, message: err.message, details: err.details });
    }
    throw err;
  }
}

/**
 * Test/fixture helper: ingests provided network JSON rows as raw blobs and
 * enforces retention. Does not create snapshots.
 */
export async function ingestFixtures(
  fixtures: Array<{ url?: string; json: unknown }>,
  keepN = 20,
): Promise<ScrapeResult> {
  const logger = new ConsoleLogger();
  const blobStore = new PrismaBlobStore({ logger });
  const clock = new SystemClock();

  let saved = 0;
  for (const fixture of fixtures) {
    const payload = Buffer.from(JSON.stringify(fixture.json));
    const capturedAt = clock.now();
    const result = await blobStore.saveIfNew({
      payload,
      kind: 'network_json',
      url: fixture.url,
      capturedAt,
    });
    if (result.outcome === 'saved') saved += 1;
  }

  await blobStore.trimRetention(keepN);
  return { savedCount: saved };
}

/**
 * When invoked directly via `tsx`/`node`, execute a single scrape and exit.
 */
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

const _invokedDirectly = (() => {
  const entry = process.argv[1] || '';
  const parts = entry.split(/[\\/]/);
  const name = parts[parts.length - 1] || '';
  return name === 'scrape.ts' || name === 'scrape.js';
})();

if (_invokedDirectly) {
  void _runCli();
}
