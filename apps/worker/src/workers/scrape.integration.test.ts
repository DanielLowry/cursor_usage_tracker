/**
 * Relative path: apps/worker/src/workers/scrape.integration.test.ts
 *
 * Test Purpose:
 * - Exercises the ingestion orchestrator against the real Prisma event store to
 *   ensure row-level dedupe and ingestion recording operate end-to-end.
 *
 * Expected Outcome & Rationale:
 * - Re-ingesting identical CSV fixtures should not create new usage events.
 * - Corrupt payloads record a failed ingestion without inserting rows.
 */
import * as fs from 'fs';
import * as path from 'path';
import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import prisma from '../../../../packages/db/src/client';
import { runIngestion } from './orchestrator';
import { PrismaUsageEventStore } from './scraper/infra/eventStore';
import type { BlobStorePort, ClockPort, FetchPort, FetchResult, Logger } from './scraper/ports';

class TestClock implements ClockPort {
  constructor(private readonly fixedNow: Date) {}
  now(): Date {
    return new Date(this.fixedNow);
  }
}

class TestLogger implements Logger {
  info(): void {}
  error(): void {}
}

class FixtureFetchPort implements FetchPort {
  constructor(private readonly fixtureName: string) {}
  async fetch(): Promise<FetchResult> {
    return {
      bytes: loadFixture(this.fixtureName),
      headers: { 'content-type': 'text/csv' },
      sourceUrl: `fixture://${this.fixtureName}`,
    } satisfies FetchResult;
  }
}

class NoopBlobStore implements BlobStorePort {
  async saveIfNew(input: {
    bytes: Buffer;
    meta: { source: string; contentHash: string; ingestionId: string | null; headers: Record<string, unknown>; capturedAt: Date };
  }): Promise<{ kind: 'saved' | 'duplicate'; contentHash: string; blobId?: string }> {
    return { kind: 'duplicate', contentHash: input.meta.contentHash };
  }
}

const FIXTURE_DIR = path.resolve(__dirname, '../../../../tests/fixtures/usage');

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, name));
}

async function resetTables() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE event_ingestion RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE usage_event RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE ingestion RESTART IDENTITY CASCADE');
}

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('runIngestion integration', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterEach(async () => {
    await resetTables();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('ingests fixtures idempotently and records failures', async () => {
    const logger = new TestLogger();
    const eventStore = new PrismaUsageEventStore({ logger });
    const blobStore = new NoopBlobStore();
    const clock = new TestClock(new Date('2025-03-01T00:00:00Z'));

    async function runFixture(name: string) {
      return runIngestion({
        fetcher: new FixtureFetchPort(name),
        eventStore,
        blobStore,
        clock,
        logger,
        source: 'cursor_csv',
        blobPolicy: { mode: 'anomaly_only' },
      });
    }

    const baseline = await runFixture('A.csv');
    expect(baseline.insertedCount).toBe(3);
    expect(baseline.duplicateCount).toBe(0);

    const rerun = await runFixture('A.csv');
    expect(rerun.insertedCount).toBe(0);
    expect(rerun.duplicateCount).toBe(3);

    const reorder = await runFixture('A_reordered.csv');
    expect(reorder.insertedCount).toBe(0);
    expect(reorder.duplicateCount).toBe(3);

    const plusOne = await runFixture('A_plus1.csv');
    expect(plusOne.insertedCount).toBe(1);
    expect(plusOne.duplicateCount).toBe(3);

    await expect(runFixture('A_corrupt.csv')).rejects.toThrowError('failed to parse usage csv');

    const events = await prisma.usageEvent.findMany({ orderBy: { row_hash: 'asc' } });
    expect(events.length).toBe(4);

    const ingestions = await prisma.ingestion.findMany({ orderBy: { ingested_at: 'asc' } });
    expect(ingestions.at(-1)?.status).toBe('failed');
    expect(ingestions.at(-1)?.metadata).toMatchObject({ row_count: 0 });

    const successfulIngestions = ingestions.filter((ingestion) => ingestion.status === 'completed');
    expect(successfulIngestions.length).toBeGreaterThanOrEqual(1);
    for (const ingestion of successfulIngestions) {
      expect(ingestion.headers).toMatchObject({ 'content-type': 'text/csv' });
    }
  });
});
