import prisma from '../../../../../../packages/db/src/client';
import { createSnapshotWithDelta } from '../../../../../../packages/db/src/snapshots';
import { ScraperError, isScraperError } from '../errors';
import type { Logger, SnapshotPersistInput, SnapshotPersistResult, SnapshotStorePort } from '../ports';

export type PrismaSnapshotStoreOptions = {
  logger: Logger;
};

export class PrismaSnapshotStore implements SnapshotStorePort {
  constructor(private readonly options: PrismaSnapshotStoreOptions) {}

  async findLatestCapture(period: { start: Date | null; end: Date | null }): Promise<Date | null> {
    if (!period.start || !period.end) return null;
    try {
      const latest = await prisma.snapshot.findFirst({
        where: { billing_period_start: period.start, billing_period_end: period.end },
        orderBy: { captured_at: 'desc' },
        select: { captured_at: true },
      });
      return latest?.captured_at ?? null;
    } catch (err) {
      throw new ScraperError('IO_ERROR', 'failed reading latest snapshot for billing period', { cause: err });
    }
  }

  async persistSnapshot(input: SnapshotPersistInput): Promise<SnapshotPersistResult> {
    try {
      const result = await createSnapshotWithDelta({
        billingPeriodStart: input.billingPeriodStart,
        billingPeriodEnd: input.billingPeriodEnd,
        tableHash: input.tableHash,
        totalRowsCount: input.totalRowsCount,
        capturedAt: input.capturedAt,
        normalizedDeltaEvents: input.deltaEvents,
      });
      this.options.logger.info('scraper.snapshot.persisted', {
        snapshotId: result.snapshotId,
        wasNew: result.wasNew,
        deltaCount: input.deltaEvents.length,
      });
      return result;
    } catch (err) {
      if (isScraperError(err)) throw err;
      const code = (err as any)?.code === 'P2002' ? 'DB_CONFLICT' : 'IO_ERROR';
      throw new ScraperError(code, 'failed persisting snapshot', { cause: err });
    }
  }
}
