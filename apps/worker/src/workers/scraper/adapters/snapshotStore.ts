// Relative path: apps/worker/src/workers/scraper/adapters/snapshotStore.ts
// Adapter persisting snapshots and delta events using the DB package.
import prisma from '../../../../../../packages/db/src/client';
import { createSnapshotWithDelta } from '../../../../../../packages/db/src/snapshots';
import { ScraperError, isScraperError } from '../errors';
import type { Logger, SnapshotPersistInput, SnapshotPersistResult, SnapshotStorePort } from '../ports';

export type PrismaSnapshotStoreOptions = {
  logger: Logger;
};

/**
 * SnapshotStorePort implementation backed by Prisma. Fetches latest capture
 * times for billing periods and persists snapshots via a helper in DB pkg.
 */
export class PrismaSnapshotStore implements SnapshotStorePort {
  constructor(private readonly options: PrismaSnapshotStoreOptions) {}

  /** Returns the latest `captured_at` for the given billing period, if any. */
  async findLatestCapture(period: { start: Date | null; end: Date | null }): Promise<Date | null> {
    if (!period.start || !period.end) return null;
    try {
      const latest = await prisma.usageEvent.findFirst({
        where: { billing_period_start: period.start, billing_period_end: period.end },
        orderBy: { last_seen_at: 'desc' },
        select: { last_seen_at: true },
      });
      return latest?.last_seen_at ?? null;
    } catch (err) {
      throw new ScraperError('IO_ERROR', 'failed reading latest snapshot for billing period', { cause: err });
    }
  }

  /** Persists a snapshot with the provided delta events, returning the outcome. */
  async persistSnapshot(input: SnapshotPersistInput): Promise<SnapshotPersistResult> {
    try {
      const result = await createSnapshotWithDelta({
        billingPeriodStart: input.billingPeriodStart,
        billingPeriodEnd: input.billingPeriodEnd,
        tableHash: input.tableHash,
        totalRowsCount: input.totalRowsCount,
        capturedAt: input.capturedAt,
        normalizedDeltaEvents: input.deltaEvents,
        rawBlobId: input.deltaEvents[0]?.raw_blob_id ?? null,
        contentHash: input.contentHash ?? null,
        headers: input.ingestionHeaders ?? null,
        metadata: input.ingestionMetadata ?? null,
        logicVersion: input.logicVersion ?? null,
      });
      this.options.logger.info('scraper.snapshot.persisted', {
        snapshotId: result.snapshotId,
        wasNew: result.wasNew,
        deltaCount: input.deltaEvents.length,
        ingestionId: result.ingestionId,
        insertedCount: result.insertedCount,
        updatedCount: result.updatedCount,
      });
      return result;
    } catch (err) {
      if (isScraperError(err)) throw err;
      const code = (err as any)?.code === 'P2002' ? 'DB_CONFLICT' : 'IO_ERROR';
      throw new ScraperError(code, 'failed persisting snapshot', { cause: err });
    }
  }
}
