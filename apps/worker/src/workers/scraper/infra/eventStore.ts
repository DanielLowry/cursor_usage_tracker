// Relative path: apps/worker/src/workers/scraper/infra/eventStore.ts
// Adapter responsible for persisting normalized usage events plus ingestion metadata.
import { ingestNormalizedUsageEvents } from '../../../../../../packages/db/src/eventStore';
import type { Logger, UsageEventStorePort, UsageEventWithRowHash } from '../ports';
import { ScraperError, isScraperError } from '../errors';

export type PrismaUsageEventStoreOptions = {
  logger: Logger;
  defaultLogicVersion?: number;
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
      metadata: Record<string, unknown>;
      logicVersion: number;
      rawBlobId: string | null;
      size: number;
    },
  ): Promise<{ ingestionId: string | null; insertedCount: number; duplicateCount: number }> {
    const logicVersion = meta.logicVersion ?? this.options.defaultLogicVersion ?? 1;

    try {
      const result = await ingestNormalizedUsageEvents({
        normalizedEvents: events.map(({ rowHash: _rowHash, ...event }) => event),
        ingestedAt: meta.ingestedAt,
        rawBlobId: meta.rawBlobId ?? null,
        contentHash: meta.contentHash,
        headers: meta.headers,
        metadata: {
          ...meta.metadata,
          bytes: meta.size,
        },
        logicVersion,
        source: meta.source,
      });

      const duplicateCount = result.updatedCount;

      this.options.logger.info('ingestion.recorded', {
        ingestionId: result.ingestionId,
        insertedCount: result.insertedCount,
        duplicateCount,
      });

      return {
        ingestionId: result.ingestionId,
        insertedCount: result.insertedCount,
        duplicateCount,
      };
    } catch (err) {
      if (isScraperError(err)) throw err;
      throw new ScraperError('IO_ERROR', 'failed to persist usage events', { cause: err });
    }
  }
}
