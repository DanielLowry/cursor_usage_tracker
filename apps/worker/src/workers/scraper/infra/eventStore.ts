// Relative path: apps/worker/src/workers/scraper/infra/eventStore.ts
// Adapter responsible for persisting normalized usage events plus ingestion metadata.
import {
  ingestNormalizedUsageEvents,
  recordFailedIngestion,
} from '../../../../../../packages/db/src/eventStore';
import type { Logger, UsageEventStorePort, UsageEventWithRowHash } from '../ports';
import { ScraperError, isScraperError } from '../errors';

export type PrismaUsageEventStoreOptions = {
  logger: Logger;
  defaultSource?: string;
};

/**
 * UsageEventStorePort backed by Prisma via the DB helpers. Performs an upsert
 * on `usage_event` keyed by row hash and records an ingestion row for the batch.
 */
export class PrismaUsageEventStore implements UsageEventStorePort {
  constructor(private readonly options: PrismaUsageEventStoreOptions) {}

  async ingest(
    events: UsageEventWithRowHash[],
    meta: {
      ingestedAt: Date;
      source: string;
      contentHash: string;
      headers: Record<string, unknown>;
    },
  ): Promise<{ ingestionId: string; insertedCount: number; duplicateCount: number }> {
    try {
      const normalized = events.map(({ rowHash: _rowHash, ...event }) => event);
      const result = await ingestNormalizedUsageEvents({
        normalizedEvents: normalized,
        ingestedAt: meta.ingestedAt,
        contentHash: meta.contentHash,
        headers: meta.headers,
        metadata: {
          row_count: events.length,
        },
        logicVersion: 1,
        source: meta.source ?? this.options.defaultSource ?? 'cursor_csv',
      });

      const duplicateCount = result.updatedCount;

      this.options.logger.info('ingestion.recorded', {
        ingestionId: result.ingestionId,
        insertedCount: result.insertedCount,
        duplicateCount,
      });

      return {
        ingestionId: result.ingestionId as string,
        insertedCount: result.insertedCount,
        duplicateCount,
      };
    } catch (err) {
      if (isScraperError(err)) throw err;
      throw new ScraperError('IO_ERROR', 'failed to persist usage events', { cause: err });
    }
  }

  async recordFailure(meta: {
    ingestedAt: Date;
    source: string;
    contentHash: string;
    headers: Record<string, unknown>;
    error: { code: string; message: string };
  }): Promise<{ ingestionId: string | null }> {
    try {
      const result = await recordFailedIngestion({
        ingestedAt: meta.ingestedAt,
        source: meta.source ?? this.options.defaultSource ?? 'cursor_csv',
        contentHash: meta.contentHash,
        headers: meta.headers,
        metadata: {
          error: meta.error,
        },
        error: meta.error,
      });

      this.options.logger.info('ingestion.recorded', {
        ingestionId: result.ingestionId,
        status: 'failed',
      });

      return result;
    } catch (err) {
      throw new ScraperError('IO_ERROR', 'failed to record ingestion failure', { cause: err });
    }
  }
}
