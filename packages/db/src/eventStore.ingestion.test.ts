/**
 * Relative path: packages/db/src/eventStore.ingestion.test.ts
 *
 * Test Purpose:
 * - Validates `ingestNormalizedUsageEvents` upserts the `ingestion` row by `content_hash` without
 *   tripping a transaction abort, and links events idempotently.
 *
 * Notes:
 * - Uses a real Postgres via Prisma; skipped if DATABASE_URL is not set (except in CI where the
 *   workflow brings up Postgres).
 */
import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import prisma from './client';
import { ingestNormalizedUsageEvents, type IngestNormalizedUsageEventsParams } from './eventStore';

function makeEvent(overrides: Partial<Record<string, unknown>> = {}): any {
  const base = {
    captured_at: new Date('2025-03-01T00:00:00Z'),
    kind: 'request',
    model: 'gpt-4.1-mini',
    max_mode: null,
    input_with_cache_write_tokens: 10,
    input_without_cache_write_tokens: 10,
    cache_read_tokens: 0,
    output_tokens: 5,
    total_tokens: 15,
    api_cost_cents: 1,
    api_cost_raw: null,
    cost_to_you_cents: 1,
    cost_to_you_raw: null,
    billing_period_start: null,
    billing_period_end: null,
    source: 'unit_test',
  };
  return { ...base, ...overrides };
}

async function resetTables() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE event_ingestion RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE usage_event RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE ingestion RESTART IDENTITY CASCADE');
}

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('ingestNormalizedUsageEvents (db)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('upserts ingestion by contentHash and remains idempotent', async () => {
    const ingestedAt = new Date('2025-03-01T00:00:00Z');
    const contentHash = 'test-hash-123';
    const headers1 = { 'content-type': 'text/csv', x: 1 } as Record<string, unknown>;
    const headers2 = { 'content-type': 'text/csv', x: 2 } as Record<string, unknown>;

    const paramsA: IngestNormalizedUsageEventsParams = {
      normalizedEvents: [makeEvent(), makeEvent({ output_tokens: 7 })],
      ingestedAt,
      rawBlobId: 'blob-1',
      contentHash,
      headers: headers1,
      metadata: { source_file: 'A.csv' },
      logicVersion: 1,
      source: 'cursor_csv',
    };

    const first = await ingestNormalizedUsageEvents(paramsA);
    expect(first.insertedCount).toBe(2);
    expect(first.updatedCount).toBe(0);
    expect(first.ingestionId).toBeTruthy();

    // Re-run with same contentHash but different headers/metadata/rawBlobId to force update path
    const paramsB: IngestNormalizedUsageEventsParams = {
      ...paramsA,
      rawBlobId: 'blob-2',
      headers: headers2,
      metadata: { source_file: 'A.csv', rerun: true },
    };
    const second = await ingestNormalizedUsageEvents(paramsB);
    expect(second.insertedCount).toBe(0);
    expect(second.updatedCount).toBe(2);
    expect(second.ingestionId).toBe(first.ingestionId);

    const ingestions = await prisma.ingestion.findMany({ orderBy: { ingested_at: 'asc' } });
    expect(ingestions.length).toBe(1);
    expect(ingestions[0]?.headers).toMatchObject(headers2);
    expect(ingestions[0]?.raw_blob_id).toBe('blob-2');

    const links = await prisma.eventIngestion.findMany();
    expect(links.length).toBe(2);
  });

  it('creates ingestion when contentHash is null', async () => {
    const result = await ingestNormalizedUsageEvents({
      normalizedEvents: [makeEvent()],
      ingestedAt: new Date('2025-03-01T00:00:00Z'),
      contentHash: null,
      headers: { foo: 'bar' },
      metadata: { m: 1 },
      rawBlobId: null,
      logicVersion: 1,
      source: 'unknown',
    });

    expect(result.insertedCount).toBe(1);
    const ingestions = await prisma.ingestion.findMany();
    expect(ingestions.length).toBe(1);
  });
});


