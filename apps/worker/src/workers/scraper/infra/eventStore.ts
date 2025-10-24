// Relative path: apps/worker/src/workers/scraper/infra/eventStore.ts
// Adapter responsible for persisting normalized usage events plus ingestion metadata.
import { ingestNormalizedUsageEvents } from '../../../../../../packages/db/src/eventStore';
import type {
  Logger,
  UsageEventIngestInput,
  UsageEventIngestResult,
  UsageEventStorePort,
} from '../ports';
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

  async ingest(input: UsageEventIngestInput): Promise<UsageEventIngestResult> {
    const logicVersion = input.logicVersion ?? this.options.defaultLogicVersion ?? 1;

    try {
      const result = await ingestNormalizedUsageEvents({
        normalizedEvents: input.events,
        ingestedAt: input.ingestedAt,
        rawBlobId: input.rawBlobId ?? null,
        contentHash: input.contentHash,
        headers: input.headers,
        metadata: {
          ...(input.metadata ?? {}),
          bytes: input.size,
        },
        logicVersion,
        source: input.source,
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
        rowHashes: result.usageEventIds,
      };
    } catch (err) {
      if (isScraperError(err)) throw err;
      throw new ScraperError('IO_ERROR', 'failed to persist usage events', { cause: err });
    }
  }
}