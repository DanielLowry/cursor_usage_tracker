/**
 * Test Suite Overview:
 * - Validates snapshot deduplication: re-ingesting identical payloads within the same billing period
 *   should reuse the original snapshot rather than writing a duplicate record.
 * - Confirms change detection: when the payload changes, a new snapshot with a different hash and
 *   captured_at timestamp is created while both snapshots remain queryable.
 * - Enforces database uniqueness: attempts to manually insert duplicate snapshot metadata must be
 *   rejected by the database layer so callers cannot bypass change detection safeguards.
 * - Exercises realistic fixture processing: ensures data read from the network fixture generates a
 *   new snapshot that ties to the correct billing period and produces the expected number of usage events.
 *
 * Assumptions:
 * - The Prisma client can connect to the test database and the snapshot-related tables can be truncated
 *   between tests to guarantee isolation.
 * - `createSnapshotIfChanged` records usage events and snapshots transactionally and returns identifiers
 *   for any newly created rows.
 *
 * Expected Outcomes & Rationale:
 * - Replaying identical data returns `wasNew === false` on the second invocation because the table hash
 *   is unchanged, demonstrating idempotence for duplicate reports.
 * - Mutated payloads result in `wasNew === true` and produce two stored snapshots whose hashes differ,
 *   proving that change detection is sensitive to row-level mutations.
 * - Manually inserting a snapshot with matching unique fields throws, verifying that database constraints
 *   enforce invariants even if application logic is bypassed.
 * - The fixture-driven test expects two usage events and accurate billing-period metadata because the
 *   fixture includes two rows covering that period, confirming the parser populates snapshot metadata.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from './client';
import { createSnapshotIfChanged } from './snapshots';
import * as fs from 'fs';
import * as path from 'path';

async function reset() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE usage_events RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE snapshots RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE raw_blobs RESTART IDENTITY CASCADE');
}

describe('snapshotting with change detection', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('same data twice → one snapshot', async () => {
    await reset();
    const capturedAt = new Date('2025-02-15T10:00:00Z');
    const payload = {
      billing_period: { start: '2025-02-01', end: '2025-02-28' },
      rows: [
        { model: 'gpt-4.1', input_with_cache_write_tokens: 100, input_without_cache_write_tokens: 200, cache_read_tokens: 50, output_tokens: 150, total_tokens: 500, api_cost: '$0.50', cost_to_you: '$0.40' },
      ],
    };

    // First snapshot
    const result1 = await createSnapshotIfChanged({ payload, capturedAt, rawBlobId: null });
    expect(result1.wasNew).toBe(true);
    expect(result1.snapshotId).toBeTruthy();
    expect(result1.usageEventIds.length).toBe(1);

    // Same data again
    const result2 = await createSnapshotIfChanged({ payload, capturedAt: new Date('2025-02-15T11:00:00Z'), rawBlobId: null });
    expect(result2.wasNew).toBe(false);
    expect(result2.snapshotId).toBe(result1.snapshotId);

    // Should have only one snapshot for this billing period
    const snapshots = await prisma.snapshot.findMany({
      where: {
        billing_period_start: new Date('2025-02-01'),
        billing_period_end: new Date('2025-02-28'),
      },
    });
    expect(snapshots.length).toBe(1);
  });

  it('changed fixture → second snapshot written', async () => {
    await reset();
    const capturedAt1 = new Date('2025-02-15T10:00:00Z');
    const capturedAt2 = new Date('2025-02-15T11:00:00Z');
    
    const payload1 = {
      billing_period: { start: '2025-02-01', end: '2025-02-28' },
      rows: [
        { model: 'gpt-4.1', input_with_cache_write_tokens: 100, input_without_cache_write_tokens: 200, cache_read_tokens: 50, output_tokens: 150, total_tokens: 500, api_cost: '$0.50', cost_to_you: '$0.40' },
      ],
    };

    const payload2 = {
      billing_period: { start: '2025-02-01', end: '2025-02-28' },
      rows: [
        { model: 'gpt-4.1', input_with_cache_write_tokens: 150, input_without_cache_write_tokens: 250, cache_read_tokens: 60, output_tokens: 160, total_tokens: 620, api_cost: '$0.60', cost_to_you: '$0.50' },
      ],
    };

    // First snapshot
    const result1 = await createSnapshotIfChanged({ payload: payload1, capturedAt: capturedAt1, rawBlobId: null });
    expect(result1.wasNew).toBe(true);

    // Changed data
    const result2 = await createSnapshotIfChanged({ payload: payload2, capturedAt: capturedAt2, rawBlobId: null });
    expect(result2.wasNew).toBe(true);
    expect(result2.snapshotId).not.toBe(result1.snapshotId);

    // Should have two snapshots for this billing period
    const snapshots = await prisma.snapshot.findMany({
      where: {
        billing_period_start: new Date('2025-02-01'),
        billing_period_end: new Date('2025-02-28'),
      },
      orderBy: { captured_at: 'asc' },
    });
    expect(snapshots.length).toBe(2);
    expect(snapshots[0].rows_count).toBe(1);
    expect(snapshots[1].rows_count).toBe(1);
    expect(snapshots[0].table_hash).not.toBe(snapshots[1].table_hash);
  });

  it('assert unique constraint prevents duplicates', async () => {
    await reset();
    const capturedAt = new Date('2025-02-15T10:00:00Z');
    const payload = {
      billing_period: { start: '2025-02-01', end: '2025-02-28' },
      rows: [
        { model: 'gpt-4.1', input_with_cache_write_tokens: 100, input_without_cache_write_tokens: 200, cache_read_tokens: 50, output_tokens: 150, total_tokens: 500, api_cost: '$0.50', cost_to_you: '$0.40' },
      ],
    };

    // Create first snapshot
    const result = await createSnapshotIfChanged({ payload, capturedAt, rawBlobId: null });
    expect(result.snapshotId).toBeTruthy();
    const firstSnapshot = await prisma.snapshot.findUniqueOrThrow({ where: { id: result.snapshotId! } });

    // Try to manually insert duplicate (should fail)
    await expect(
      prisma.snapshot.create({
        data: {
          captured_at: new Date('2025-02-15T11:00:00Z'),
          billing_period_start: firstSnapshot.billing_period_start,
          billing_period_end: firstSnapshot.billing_period_end,
          table_hash: firstSnapshot.table_hash,
          rows_count: firstSnapshot.rows_count,
        },
      })
    ).rejects.toThrow();
  });

  it('uses fixture data for realistic testing', async () => {
    await reset();
    const jsonPath = path.join(process.cwd(), 'tests/fixtures/network/sample1.json');
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const capturedAt = new Date('2025-02-15T10:00:00Z');

    const result = await createSnapshotIfChanged({ payload, capturedAt, rawBlobId: null });
    expect(result.wasNew).toBe(true);
    expect(result.usageEventIds.length).toBe(2); // sample1.json has 2 rows

    const snapshot = await prisma.snapshot.findUnique({ where: { id: result.snapshotId! } });
    expect(snapshot).toBeTruthy();
    expect(snapshot!.rows_count).toBe(2);
    expect(snapshot!.billing_period_start?.toISOString()).toBe('2025-02-01T00:00:00.000Z');
    expect(snapshot!.billing_period_end?.toISOString()).toBe('2025-02-28T00:00:00.000Z');
  });
});
