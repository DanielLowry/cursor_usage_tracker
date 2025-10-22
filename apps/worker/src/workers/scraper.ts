import { Queue } from 'bullmq';
import { z } from 'zod';

import { getRedis } from '@cursor-usage/redis';

import {
  ConsoleLogger,
  CursorFetchAdapter,
  PrismaBlobStore,
  PrismaSnapshotStore,
  SystemClock,
  normalizeCapture,
  buildStableViewHash,
  computeDelta,
} from './scraper/adapters';
import type { CapturedBlob, ScraperDependencies } from './scraper/ports';
import { ScraperError } from './scraper/ports';

const USAGE_CSV_URL = 'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens';

const connection = getRedis();
export const scraperQueue = new Queue('scraper', { connection });

const envSchema = z.object({
  CURSOR_AUTH_STATE_DIR: z.string().min(1).default('./data'),
  RAW_BLOB_KEEP_N: z
    .string()
    .optional()
    .default('20')
    .transform((value) => parseInt(value, 10)),
});

type EnvConfig = z.infer<typeof envSchema>;

export type ScrapeResult = {
  savedCount: number;
};

function parseEnv(): EnvConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ScraperError('VALIDATION_ERROR', `Invalid scraper environment: ${parsed.error.message}`);
  }
  return parsed.data;
}

class ScraperOrchestrator {
  constructor(private readonly deps: ScraperDependencies) {}

  private buildCapture(buffer: Buffer): CapturedBlob {
    return { url: USAGE_CSV_URL, payload: buffer, kind: 'html' };
  }

  async run(): Promise<ScrapeResult> {
    const { fetchPort, blobStore, snapshotStore, clock, logger, retentionLimit } = this.deps;
    const capturedAt = clock.now();

    logger.info('scraper.run.start', { capturedAt: capturedAt.toISOString() });

    try {
      const csvBuffer = await fetchPort.fetchUsageCsv();
      const capture = this.buildCapture(csvBuffer);

      const blobResult = await blobStore.saveIfNew({ capture, capturedAt, metadata: null });
      if (blobResult.status === 'duplicate') {
        logger.info('scraper.short_circuit.duplicate_blob', {
          blobId: blobResult.blobId,
          contentHash: blobResult.contentHash,
        });
        await blobStore.enforceRetention(retentionLimit);
        return { savedCount: 0 };
      }

      const normalizedEvents = await normalizeCapture(capture, capturedAt, blobResult.blobId);
      logger.info('scraper.normalized', { rows: normalizedEvents.length });

      const { tableHash, billingPeriodStart, billingPeriodEnd, totalRowsCount } = buildStableViewHash(normalizedEvents);
      logger.info('scraper.table_hash', {
        tableHash,
        totalRowsCount,
        billingPeriodStart,
        billingPeriodEnd,
      });

      const latestCapture = await snapshotStore.findLatestCapture({
        billingPeriodStart,
        billingPeriodEnd,
      });
      const deltaEvents = computeDelta(normalizedEvents, latestCapture);
      logger.info('scraper.delta', {
        deltaCount: deltaEvents.length,
        latestCapture: latestCapture ? latestCapture.toISOString() : null,
      });

      await snapshotStore.persistDelta({
        billingPeriodStart,
        billingPeriodEnd,
        tableHash,
        totalRowsCount,
        capturedAt,
        normalizedDeltaEvents: deltaEvents,
      });

      await blobStore.enforceRetention(retentionLimit);

      logger.info('scraper.run.complete', {
        savedBlob: blobResult.status === 'saved',
        deltaCount: deltaEvents.length,
        tableHash,
      });

      return { savedCount: blobResult.status === 'saved' ? 1 : 0 };
    } catch (error) {
      if (error instanceof ScraperError) {
        logger.error('scraper.run.failed', {
          code: error.code,
          message: error.message,
          context: error.context,
        });
        throw error;
      }

      const fallbackMessage = (error as Error)?.message ?? 'Unknown error';
      logger.error('scraper.run.failed', { code: 'IO_ERROR', message: fallbackMessage });
      throw error;
    }
  }
}

function createDependencies(env: EnvConfig): ScraperDependencies {
  const clock = new SystemClock();
  const logger = new ConsoleLogger(clock);
  const fetchPort = new CursorFetchAdapter({ requestedStateDir: env.CURSOR_AUTH_STATE_DIR, logger });
  const blobStore = new PrismaBlobStore(logger);
  const snapshotStore = new PrismaSnapshotStore(logger);

  return {
    fetchPort,
    blobStore,
    snapshotStore,
    clock,
    logger,
    retentionLimit: env.RAW_BLOB_KEEP_N,
  };
}

export async function runScrape(): Promise<ScrapeResult> {
  const env = parseEnv();
  const deps = createDependencies(env);
  const orchestrator = new ScraperOrchestrator(deps);
  return orchestrator.run();
}

export async function ingestFixtures(fixtures: Array<{ url?: string; json: unknown }>, keepN = 20): Promise<ScrapeResult> {
  const clock = new SystemClock();
  const logger = new ConsoleLogger(clock);
  const blobStore = new PrismaBlobStore(logger);

  let saved = 0;
  for (const fixture of fixtures) {
    const payload = Buffer.from(JSON.stringify(fixture.json));
    const capture: CapturedBlob = { url: fixture.url, payload, kind: 'network_json' };
    const result = await blobStore.saveIfNew({ capture, capturedAt: clock.now(), metadata: null });
    if (result.status === 'saved') saved += 1;
  }

  await blobStore.enforceRetention(keepN);
  return { savedCount: saved };
}

export async function ensureBlob(
  item: { url?: string; payload: Buffer; kind: 'html' | 'network_json' },
  _contentHash: string,
  nowTs?: Date,
): Promise<{ id: string; created: boolean }> {
  const clock = new SystemClock();
  const logger = new ConsoleLogger(clock);
  const blobStore = new PrismaBlobStore(logger);
  const capturedAt = nowTs ?? clock.now();
  const result = await blobStore.saveIfNew({ capture: item, capturedAt, metadata: null });
  return { id: result.blobId, created: result.status === 'saved' };
}

async function _runCli() {
  try {
    console.log('scrape: starting');
    const result = await runScrape();
    console.log('scrape: finished', { result });
    process.exit(0);
  } catch (error) {
    console.error('scrape: error', error);
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
