import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NormalizedUsageEvent } from '@cursor-usage/ingest';

import type { LoggerPort } from '../../ports';

type SnapshotRecord = {
  id: string;
  captured_at: Date;
  billing_period_start: Date | null;
  billing_period_end: Date | null;
  table_hash: string;
};

type UsageEventRecord = {
  id: string;
  captured_at: Date;
  billing_period_start: Date | null;
  billing_period_end: Date | null;
};

const snapshotRecords: SnapshotRecord[] = [];
const usageEventRecords: UsageEventRecord[] = [];

vi.mock('../../../../../packages/db/src/client', () => ({
  __esModule: true,
  default: {
    snapshot: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        const matches = snapshotRecords.filter((row) => {
          if (where?.billing_period_start && where?.billing_period_end) {
            return (
              row.billing_period_start?.getTime() === where.billing_period_start.getTime() &&
              row.billing_period_end?.getTime() === where.billing_period_end.getTime()
            );
          }
          if (where?.table_hash) {
            return row.table_hash === where.table_hash;
          }
          return true;
        });
        if (!matches.length) return null;
        if (orderBy?.captured_at === 'desc') {
          matches.sort((a, b) => b.captured_at.getTime() - a.captured_at.getTime());
        }
        const result = matches[0];
        return { captured_at: result.captured_at, id: result.id };
      }),
    },
    usageEvent: {
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        const matches = usageEventRecords.filter((row) => {
          if (where?.billing_period_start && where?.billing_period_end) {
            return (
              row.billing_period_start?.getTime() === where.billing_period_start.getTime() &&
              row.billing_period_end?.getTime() === where.billing_period_end.getTime()
            );
          }
          return true;
        });
        if (!matches.length) return null;
        if (orderBy?.captured_at === 'desc') {
          matches.sort((a, b) => b.captured_at.getTime() - a.captured_at.getTime());
        }
        const result = matches[0];
        return { captured_at: result.captured_at };
      }),
    },
  },
}));

vi.mock('../../../../../packages/db/src/snapshots', () => ({
  __esModule: true,
  createSnapshotWithDelta: vi.fn(async (input: any) => {
    const existing = snapshotRecords.find(
      (row) =>
        row.billing_period_start?.getTime() === input.billingPeriodStart?.getTime() &&
        row.billing_period_end?.getTime() === input.billingPeriodEnd?.getTime() &&
        row.table_hash === input.tableHash,
    );

    if (existing) {
      const usageIds = usageEventRecords
        .filter((row) => row.billing_period_start?.getTime() === input.billingPeriodStart?.getTime())
        .map((row) => row.id);
      return { snapshotId: existing.id, wasNew: false, usageEventIds: usageIds };
    }

    const id = `snap-${snapshotRecords.length + 1}`;
    snapshotRecords.push({
      id,
      captured_at: input.capturedAt,
      billing_period_start: input.billingPeriodStart,
      billing_period_end: input.billingPeriodEnd,
      table_hash: input.tableHash,
    });

    const usageEventIds: string[] = [];
    for (const event of input.normalizedDeltaEvents as NormalizedUsageEvent[]) {
      const usageId = `usage-${usageEventRecords.length + 1}`;
      usageEventRecords.push({
        id: usageId,
        captured_at: event.captured_at,
        billing_period_start: event.billing_period_start,
        billing_period_end: event.billing_period_end,
      });
      usageEventIds.push(usageId);
    }

    return { snapshotId: id, wasNew: true, usageEventIds };
  }),
}));

import { PrismaSnapshotStoreAdapter } from '../snapshotStore';

class TestLogger implements LoggerPort {
  info(): void {}
  warn(): void {}
  error(): void {}
}

describe('PrismaSnapshotStoreAdapter', () => {
  beforeEach(() => {
    snapshotRecords.length = 0;
    usageEventRecords.length = 0;
  });

  const baseEvent: NormalizedUsageEvent = {
    captured_at: new Date('2024-03-01T00:00:00Z'),
    kind: 'api',
    model: 'gpt-4',
    max_mode: null,
    input_with_cache_write_tokens: 10,
    input_without_cache_write_tokens: 5,
    cache_read_tokens: 0,
    output_tokens: 20,
    total_tokens: 35,
    api_cost_cents: 100,
    api_cost_raw: '1.00',
    cost_to_you_cents: 120,
    cost_to_you_raw: '1.20',
    billing_period_start: new Date('2024-03-01'),
    billing_period_end: new Date('2024-03-31'),
    source: 'network_json',
    raw_blob_id: null,
  };

  it('persists snapshot deltas and reports latest capture', async () => {
    const logger = new TestLogger();
    const adapter = new PrismaSnapshotStoreAdapter(logger);
    const capturedAt = new Date('2024-03-02T00:00:00Z');

    const result = await adapter.persistDelta({
      tableHash: 'hash-1',
      totalRowsCount: 1,
      billingPeriodStart: baseEvent.billing_period_start,
      billingPeriodEnd: baseEvent.billing_period_end,
      capturedAt,
      normalizedDeltaEvents: [baseEvent],
    });

    expect(result.wasNew).toBe(true);
    expect(result.usageEventIds.length).toBe(1);

    const latest = await adapter.findLatestCapture({
      start: baseEvent.billing_period_start,
      end: baseEvent.billing_period_end,
    });

    expect(latest?.toISOString()).toBe(capturedAt.toISOString());
  });

  it('returns wasNew=false when a matching snapshot already exists', async () => {
    const logger = new TestLogger();
    const adapter = new PrismaSnapshotStoreAdapter(logger);
    const capturedAt = new Date('2024-03-02T00:00:00Z');

    await adapter.persistDelta({
      tableHash: 'hash-1',
      totalRowsCount: 1,
      billingPeriodStart: baseEvent.billing_period_start,
      billingPeriodEnd: baseEvent.billing_period_end,
      capturedAt,
      normalizedDeltaEvents: [baseEvent],
    });

    const second = await adapter.persistDelta({
      tableHash: 'hash-1',
      totalRowsCount: 1,
      billingPeriodStart: baseEvent.billing_period_start,
      billingPeriodEnd: baseEvent.billing_period_end,
      capturedAt,
      normalizedDeltaEvents: [baseEvent],
    });

    expect(second.wasNew).toBe(false);
  });
});
