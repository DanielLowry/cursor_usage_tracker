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
import { ScraperError, isScraperError } from './scraper/errors';
import type { ClockPort, FetchPort, Logger, NormalizedUsageEventWithHash, UsageEventStorePort } from './scraper/ports';
import { CursorCsvFetchAdapter, DEFAULT_USAGE_EXPORT_URL } from './scraper/infra/fetch';
import { PrismaUsageEventStore } from './scraper/infra/eventStore';

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
  clock: ClockPort;
  logger: Logger;
  csvSourceUrl: string;
  ingestionSource?: string;
  logicVersion?: number;
};

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
    const { fetchPort, eventStore, clock, logger, csvSourceUrl, ingestionSource, logicVersion } = this.deps;

    logger.info('scrape.start', { csvSourceUrl });

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

    const csvText = csvBuffer.toString('utf8');
    const parsedCsv = parseUsageCsv(csvText);
    if (!parsedCsv) {
      logger.error('events.parse_failed', { reason: 'csv_parse_error' });
      throw new ScraperError('CSV_PARSE_ERROR', 'failed to parse usage csv');
    }

    logger.debug('events.parsed', { rowCount: parsedCsv.rows.length });

    const normalizedEvents = normalizeCapturedPayload(parsedCsv, ingestedAt, null).map((event) => ({
      ...event,
      source: ingestionSource ?? 'cursor_csv',
    }));

    const version = logicVersion ?? 1;
    const eventsWithHash: NormalizedUsageEventWithHash[] = normalizedEvents.map((event) => ({
      ...event,
      rowHash: computeUsageEventRowHash(event, version),
    }));

    const metadata = {
      row_count: eventsWithHash.length,
      billing_period_start: parsedCsv.billing_period?.start ?? null,
      billing_period_end: parsedCsv.billing_period?.end ?? null,
      parse_format: 'csv',
    } satisfies Record<string, unknown>;

    const headers = {
      'content-type': 'text/csv',
    } as Record<string, unknown>;

    const ingestResult = await eventStore.ingest({
      events: eventsWithHash,
      ingestedAt,
      contentHash,
      size: bytes,
      headers,
      metadata,
      logicVersion: version,
      source: ingestionSource ?? 'cursor_csv',
    });

    logger.info('events.upserted', {
      insertedCount: ingestResult.insertedCount,
    });
    logger.info('events.duplicate_count', {
      duplicateCount: ingestResult.duplicateCount,
    });

    logger.info('blob.skipped', { reason: 'policy:not_implemented', contentHash });

    logger.info('scrape.done', {
      ingestionId: ingestResult.ingestionId,
      insertedCount: ingestResult.insertedCount,
      duplicateCount: ingestResult.duplicateCount,
      rowCount: eventsWithHash.length,
      contentHash,
    });

    return {
      ingestionId: ingestResult.ingestionId,
      insertedCount: ingestResult.insertedCount,
      duplicateCount: ingestResult.duplicateCount,
      rowHashes: ingestResult.rowHashes,
      contentHash,
      bytes,
    };
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
  const clock = new SystemClock();

  const orchestrator = new ScraperOrchestrator({
    fetchPort,
    eventStore,
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
