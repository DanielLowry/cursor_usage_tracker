/**
 * Relative path: apps/worker/src/workers/scrape.integration.test.ts
 *
 * Test Purpose:
 * - Exercises the scraper orchestrator against the real Prisma event store to
 *   ensure row-level dedupe and ingestion recording operate end-to-end.
 *
 * Assumptions:
 * - A PostgreSQL database is available via `DATABASE_URL` for the test run.
 * - Tables `usage_event` and `ingestion` can be truncated between runs.
 *
 * Expected Outcome & Rationale:
 * - The first run inserts all rows and creates one ingestion.
 * - The second run reuses the same data, resulting in zero new rows and a new
 *   ingestion that only updates `last_seen_at`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import prisma from '../../../../packages/db/src/client';
import { ScraperOrchestrator } from './scraper';
import { PrismaUsageEventStore } from './scraper/infra/eventStore';
import type { ClockPort, FetchPort, Logger } from './scraper/ports';

class TestClock implements ClockPort {
  constructor(private readonly fixedNow: Date) {}
  now(): Date {
    return new Date(this.fixedNow);
  }
}

class TestLogger implements Logger {
  info() {}
  debug() {}
  warn() {}
  error() {}
}

const FIXTURE_DIR = path.resolve(__dirname, '../../../../tests/fixtures/usage');

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, name));
}

class FixtureFetchPort implements FetchPort {
  constructor(private readonly fixtureName: string) {}
  async fetchCsvExport(): Promise<Buffer> {
    return loadFixture(this.fixtureName);
  }
}

async function resetTables() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE event_ingestion RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE usage_event RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE ingestion RESTART IDENTITY CASCADE');
}

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('ScraperOrchestrator integration', () => {
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
    const clock = new TestClock(new Date('2025-03-01T00:00:00Z'));

    async function runFixture(name: string) {
      const orchestrator = new ScraperOrchestrator({
        fetchPort: new FixtureFetchPort(name),
        eventStore,
        clock,
        logger,
        csvSourceUrl: 'https://example.com/usage.csv',
        ingestionSource: 'cursor_csv',
        logicVersion: 1,
      });

      return orchestrator.run();
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

    const metadataSamples = successfulIngestions.map((ingestion) => ingestion.metadata ?? {});
    expect(metadataSamples.some((metadata) => (metadata as any).row_count === 3)).toBe(true);
    expect(metadataSamples.some((metadata) => (metadata as any).bytes === loadFixture('A.csv').length)).toBe(true);
  });
});
