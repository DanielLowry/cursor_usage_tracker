// Relative path: apps/worker/src/workers/scraper.ts

// Scraper worker entrypoint: orchestrates fetching Cursor usage data, normalizing it,
// computing deterministic row hashes, and persisting the batch into the usage
// event store. The heavy-lifting is delegated to focused modules under
// `./scraper/*` and this file focuses on orchestration and environment wiring.
import { Queue } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { getRedis } from '@cursor-usage/redis';
import { computeUsageEventRowHash } from './scraper/lib/rowHash';
import { computeSha256 } from './scraper/lib/contentHash';
import { parseUsageCsv } from './scraper/core/csv';
import { normalizeCapturedPayload } from './scraper/core/normalize';
import type { NormalizedUsageEvent } from './scraper/core/normalize';
import { ScraperError, isScraperError } from './scraper/errors';
import type {
  BlobStorePort,
  ClockPort,
  FetchPort,
  Logger,
  NormalizedUsageEventWithHash,
  UsageEventStorePort,
} from './scraper/ports';
import { CursorCsvFetchAdapter, DEFAULT_USAGE_EXPORT_URL } from './scraper/infra/fetch';
import { PrismaUsageEventStore } from './scraper/infra/eventStore';
import { PrismaBlobStore } from './scraper/infra/blobStore';

// Exported BullMQ queue used by the worker process elsewhere to enqueue scraping jobs.
const connection = getRedis();
export const scraperQueue = new Queue('scraper', { connection });

// Environment variables required by the scraper with defaults and validation.
const envSchema = z.object({
  CURSOR_AUTH_STATE_DIR: z.string().min(1).default('./data'),
});

export type ScrapeResult = {
  ingestionId: string | null;
  insertedCount: number;
  duplicateCount: number;
  rowHashes: string[];
  contentHash: string;
  bytes: number;
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
  eventStore: UsageEventStorePort;
  blobStore: BlobStorePort;
  clock: ClockPort;
  logger: Logger;
  csvSourceUrl: string;
  ingestionSource?: string;
  logicVersion?: number;
};

type BlobPolicyDecision = { shouldStore: boolean; reason: string };

/**
 * ScraperOrchestrator coordinates the end-to-end scrape:
 * - Fetch CSV export from Cursor via `FetchPort`
 * - Normalize into deterministic usage events with row hashes
 * - Upsert rows into the usage event store and record ingestion metadata
 */
export class ScraperOrchestrator {
  constructor(private readonly deps: ScraperOrchestratorDependencies) {}

  /**
   * Runs a single scrape cycle and returns ingestion stats for observability.
   * Throws `ScraperError` on known failure categories.
   */
  async run(): Promise<ScrapeResult> {
    const { fetchPort, eventStore, blobStore, clock, logger, csvSourceUrl, ingestionSource, logicVersion } = this.deps;

    logger.info('scrape.start', { csvSourceUrl });
    const startedAtMs = Date.now();

    let csvBuffer: Buffer;
    try {
      csvBuffer = await fetchPort.fetchCsvExport();
    } catch (err) {
      if (isScraperError(err)) {
        logger.error('scrape.fetch_failed', { code: err.code, message: err.message, details: err.details });
        throw err;
      }
      logger.error('scrape.fetch_failed', { error: err });
      throw new ScraperError('FETCH_ERROR', 'failed to fetch usage csv', { cause: err });
    }

    const bytes = csvBuffer.length;
    logger.debug('scrape.fetch.completed', { bytes });

    const ingestedAt = clock.now();
    const contentHash = computeSha256(csvBuffer);
    const version = logicVersion ?? 1;

    const csvText = csvBuffer.toString('utf8');
    const headers = {
      'content-type': 'text/csv',
    } as Record<string, unknown>;
    const metadataBase = {
      parse_format: 'csv',
      bytes,
    } satisfies Record<string, unknown>;

    const parsedCsv = parseUsageCsv(csvText);
    if (!parsedCsv) {
      logger.error('events.parse_failed', { reason: 'csv_parse_error' });
      await eventStore.recordFailure({
        source: ingestionSource ?? 'cursor_csv',
        ingestedAt,
        contentHash,
        headers,
        metadata: metadataBase,
        logicVersion: version,
        size: bytes,
        error: { code: 'CSV_PARSE_ERROR', message: 'failed to parse usage csv' },
      });
      throw new ScraperError('CSV_PARSE_ERROR', 'failed to parse usage csv');
    }

    const rowCount = parsedCsv.rows.length;
    logger.debug('events.parsed', { rowCount });

    const blobDecision = this.evaluateBlobPolicy({ ingestedAt, rowCount });

    let rawBlobId: string | null = null;
    if (blobDecision.shouldStore) {
      try {
        const blobResult = await blobStore.saveIfNew({
          payload: csvBuffer,
          kind: 'html',
          url: csvSourceUrl,
          capturedAt: ingestedAt,
        });
        rawBlobId = blobResult.blobId;
        logger.info('blob.saved', {
          blobId: blobResult.blobId,
          contentHash: blobResult.contentHash,
          outcome: blobResult.outcome,
          reason: blobDecision.reason,
        });
      } catch (error) {
        logger.error('blob.save_failed', {
          reason: blobDecision.reason,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      logger.info('blob.skipped', { reason: blobDecision.reason, contentHash });
    }

    let normalizedEvents: NormalizedUsageEvent[];
    try {
      normalizedEvents = normalizeCapturedPayload(parsedCsv, ingestedAt, rawBlobId).map((event) => ({
        ...event,
        source: ingestionSource ?? 'cursor_csv',
      }));
    } catch (error) {
      logger.error('events.normalize_failed', { error });
      await eventStore.recordFailure({
        source: ingestionSource ?? 'cursor_csv',
        ingestedAt,
        contentHash,
        headers,
        metadata: { ...metadataBase, row_count: rowCount, blob_policy_reason: blobDecision.reason },
        logicVersion: version,
        rawBlobId,
        size: bytes,
        error: {
          code: 'NORMALIZE_ERROR',
          message: error instanceof Error ? error.message : 'failed to normalize usage payload',
        },
      });
      throw new ScraperError('NORMALIZE_ERROR', 'failed to normalize usage payload', { cause: error });
    }

    const eventsWithHash: NormalizedUsageEventWithHash[] = normalizedEvents.map((event) => ({
      ...event,
      rowHash: computeUsageEventRowHash(event, version),
    }));

    const metadata = {
      ...metadataBase,
      row_count: eventsWithHash.length,
      billing_period_start: parsedCsv.billing_period?.start ?? null,
      billing_period_end: parsedCsv.billing_period?.end ?? null,
      blob_policy_reason: blobDecision.reason,
    } satisfies Record<string, unknown>;

    const ingestResult = await eventStore.ingest({
      events: eventsWithHash,
      ingestedAt,
      contentHash,
      size: bytes,
      headers,
      metadata,
      logicVersion: version,
      rawBlobId,
      source: ingestionSource ?? 'cursor_csv',
    });

    logger.info('events.upserted', {
      insertedCount: ingestResult.insertedCount,
    });
    logger.info('events.duplicate_count', {
      duplicateCount: ingestResult.duplicateCount,
    });

    logger.info('metrics.ingestions_total', { count: 1 });
    logger.info('metrics.events_inserted_total', { count: ingestResult.insertedCount });
    logger.info('metrics.events_duplicates_total', { count: ingestResult.duplicateCount });
    logger.info('metrics.blobs_saved_total', { count: rawBlobId ? 1 : 0 });
    logger.info('metrics.blobs_skipped_total', { count: rawBlobId ? 0 : 1 });

    const durationMs = Date.now() - startedAtMs;
    logger.info('scrape.done', {
      ingestionId: ingestResult.ingestionId,
      insertedCount: ingestResult.insertedCount,
      duplicateCount: ingestResult.duplicateCount,
      rowCount: eventsWithHash.length,
      contentHash,
      durationMs,
    });
    logger.info('metrics.duration_ms', { value: durationMs });

    return {
      ingestionId: ingestResult.ingestionId,
      insertedCount: ingestResult.insertedCount,
      duplicateCount: ingestResult.duplicateCount,
      rowHashes: ingestResult.rowHashes,
      contentHash,
      bytes,
    };
  }

  private evaluateBlobPolicy(input: { ingestedAt: Date; rowCount: number }): BlobPolicyDecision {
    const { ingestedAt, rowCount } = input;
    if (rowCount === 0) {
      return { shouldStore: true, reason: 'policy:anomaly:no_rows' };
    }

    const isMonday = ingestedAt.getUTCDay() === 1;
    if (isMonday) {
      return { shouldStore: true, reason: 'policy:weekly:monday' };
    }

    return { shouldStore: false, reason: 'policy:default_skip' };
  }
}

/**
 * Parses and validates environment variables needed by the scraper.
 */
function parseEnv() {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) throw new ScraperError('VALIDATION_ERROR', `invalid env: ${parsed.error.message}`);
  return parsed.data as { CURSOR_AUTH_STATE_DIR: string };
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
 * TODO(snapshot-bookmarks): re-introduce snapshot bookmark persistence if needed
 * once the event-store-first flow has settled.
 */
export async function runScrape(): Promise<ScrapeResult> {
  const env = parseEnv();
  const logger = new ConsoleLogger();

  logger.info('scrape.env', { CURSOR_AUTH_STATE_DIR: env.CURSOR_AUTH_STATE_DIR });

  const requestedStateDir = env.CURSOR_AUTH_STATE_DIR || './data';
  const chosenStateDir = resolveStateDir(requestedStateDir);
  logger.info('scrape.auth_state_dir.resolved', { chosenStateDir });

  const fetchPort = new CursorCsvFetchAdapter({ stateDir: chosenStateDir, logger });
  const eventStore = new PrismaUsageEventStore({ logger });
  const blobStore = new PrismaBlobStore({ logger });
  const clock = new SystemClock();

  const orchestrator = new ScraperOrchestrator({
    fetchPort,
    eventStore,
    blobStore,
    clock,
    logger,
    csvSourceUrl: DEFAULT_USAGE_EXPORT_URL,
    ingestionSource: 'cursor_csv',
  });

  try {
    return await orchestrator.run();
  } catch (err) {
    if (isScraperError(err)) {
      logger.error('scrape.run_failed', { code: err.code, message: err.message, details: err.details });
    }
    throw err;
  }
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
