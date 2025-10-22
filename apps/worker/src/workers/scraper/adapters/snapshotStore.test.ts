import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../../../../../packages/db/src/client';
import type { Logger } from '../ports';
import { PrismaSnapshotStore } from './snapshotStore';
import { buildStableViewHash as buildStableViewHashCore } from '../tableHash';
import type { NormalizedUsageEvent } from '@cursor-usage/ingest';

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

async function reset() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE usage_events RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE snapshots RESTART IDENTITY CASCADE');
}

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb('PrismaSnapshotStore', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await reset();
  });

  it('persists snapshots and reports latest capture', async () => {
    const store = new PrismaSnapshotStore({ logger: noopLogger });
    const capturedAt = new Date('2025-02-05T00:00:00Z');
    const billingStart = new Date('2025-02-01T00:00:00Z');
    const billingEnd = new Date('2025-02-28T00:00:00Z');

    const normalized: NormalizedUsageEvent[] = [
      {
        captured_at: capturedAt,
        kind: 'usage',
        model: 'gpt-4',
        max_mode: null,
        input_with_cache_write_tokens: 10,
        input_without_cache_write_tokens: 5,
        cache_read_tokens: 0,
        output_tokens: 5,
        total_tokens: 20,
        api_cost_cents: 123,
        api_cost_raw: '$1.23',
        cost_to_you_cents: 123,
        cost_to_you_raw: '$1.23',
        billing_period_start: billingStart,
        billing_period_end: billingEnd,
        source: 'network_json',
        raw_blob_id: null,
      },
    ];

    const view = buildStableViewHashCore(normalized);

    const first = await store.persistSnapshot({
      billingPeriodStart: view.billingPeriodStart,
      billingPeriodEnd: view.billingPeriodEnd,
      tableHash: view.tableHash,
      totalRowsCount: view.totalRowsCount,
      capturedAt,
      deltaEvents: normalized,
    });

    expect(first.wasNew).toBe(true);
    expect(first.snapshotId).toBeTruthy();

    const latest = await store.findLatestCapture({ start: billingStart, end: billingEnd });
    expect(latest?.toISOString()).toBe(capturedAt.toISOString());

    const second = await store.persistSnapshot({
      billingPeriodStart: view.billingPeriodStart,
      billingPeriodEnd: view.billingPeriodEnd,
      tableHash: view.tableHash,
      totalRowsCount: view.totalRowsCount,
      capturedAt,
      deltaEvents: [],
    });

    expect(second.wasNew).toBe(false);
    expect(second.snapshotId).toBe(first.snapshotId);
  });
});
