import prisma from '../../../../../packages/db/src/client';
import { createSnapshotWithDelta } from '../../../../../packages/db/src/snapshots';

import { ScraperError } from '../errors';
import type {
  LoggerPort,
  SnapshotPersistInput,
  SnapshotPersistResult,
  SnapshotPeriod,
  SnapshotStorePort,
} from '../ports';

export class PrismaSnapshotStoreAdapter implements SnapshotStorePort {
  constructor(private readonly logger: LoggerPort) {}

  async findLatestCapture(period: SnapshotPeriod): Promise<Date | null> {
    const { start, end } = period;
    if (!start || !end) return null;

    try {
      const latestSnapshot = await prisma.snapshot.findFirst({
        where: { billing_period_start: start, billing_period_end: end },
        orderBy: { captured_at: 'desc' },
        select: { captured_at: true },
      });

      if (latestSnapshot?.captured_at) {
        return latestSnapshot.captured_at as Date;
      }
    } catch (snapshotErr) {
      this.logger.warn('scraper.snapshot.latest_lookup_failed', {
        error: snapshotErr instanceof Error ? snapshotErr.message : String(snapshotErr),
      });
      try {
        const latestUsageEvent = await prisma.usageEvent.findFirst({
          where: { billing_period_start: start, billing_period_end: end },
          orderBy: { captured_at: 'desc' },
          select: { captured_at: true },
        });
        if (latestUsageEvent?.captured_at) {
          return latestUsageEvent.captured_at as Date;
        }
      } catch (usageErr) {
        this.logger.warn('scraper.snapshot.latest_usage_fallback_failed', {
          error: usageErr instanceof Error ? usageErr.message : String(usageErr),
        });
      }
    }

    return null;
  }

  async persistDelta(input: SnapshotPersistInput): Promise<SnapshotPersistResult> {
    try {
      const result = await createSnapshotWithDelta(input);
      this.logger.info('scraper.snapshot.persisted', {
        tableHash: input.tableHash,
        wasNew: result.wasNew,
        usageEventCount: result.usageEventIds.length,
      });
      return result;
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ScraperError('DB_CONFLICT', 'snapshot uniqueness conflict detected', { cause: err });
      }

      this.logger.error('scraper.snapshot.error', {
        message: err instanceof Error ? err.message : 'unknown',
        tableHash: input.tableHash,
      });
      throw new ScraperError('IO_ERROR', 'failed to persist snapshot', { cause: err });
    }
  }
}
