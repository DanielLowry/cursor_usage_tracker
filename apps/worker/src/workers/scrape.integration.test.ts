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
import { beforeAll, afterAll, afterEach, describe, it, expect } from 'vitest';
import prisma from '../../../../packages/db/src/client';
import { ScraperOrchestrator } from './scraper';
import { PrismaUsageEventStore } from './scraper/infra/eventStore';
import type { ClockPort, FetchPort, Logger } from './scraper/ports';
import { computeSha256 } from './scraper/lib/contentHash';

class TestClock implements ClockPort {
  constructor(private readonly fixedNow: Date) {}
  now(): Date {
    return new Date(this.fixedNow);
  }
}

class FakeFetchPort implements FetchPort {
  constructor(private readonly payload: Buffer) {}
  async fetchCsvExport(): Promise<Buffer> {
    return Buffer.from(this.payload);
  }
}

class TestLogger implements Logger {
  info() {}
  debug() {}
  warn() {}
  error() {}
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

  it('writes usage events on first run and dedupes on rerun', async () => {
    const csvFixture = Buffer.from(
      [
        'Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost,Cost to you',
        '2025-02-01,gpt-4o,10,5,0,15,30,$0.10,$0.10',
        '2025-02-02,gpt-4o-mini,0,0,0,5,5,$0.05,$0.05',
      ].join('\n'),
      'utf8',
    );
    const expectedHash = computeSha256(csvFixture);
    const fetchPort = new FakeFetchPort(csvFixture);
    const clock = new TestClock(new Date('2025-03-01T00:00:00Z'));
    const logger = new TestLogger();
    const eventStore = new PrismaUsageEventStore({ logger });

    const orchestrator = new ScraperOrchestrator({
      fetchPort,
      eventStore,
      clock,
      logger,
      csvSourceUrl: 'https://example.com/usage.csv',
      ingestionSource: 'cursor_csv',
      logicVersion: 1,
    });

    const first = await orchestrator.run();
    expect(first.contentHash).toBe(expectedHash);
    expect(first.insertedCount).toBe(2);
    expect(first.duplicateCount).toBe(0);

    const second = await orchestrator.run();
    expect(second.insertedCount).toBe(0);
    expect(second.duplicateCount).toBe(2);

    const ingestions = await prisma.ingestion.findMany({ orderBy: { ingested_at: 'asc' } });
    expect(ingestions.length).toBe(2);
    expect(ingestions[0]?.content_hash).toBe(expectedHash);
    expect(ingestions[1]?.content_hash).toBe(expectedHash);

    const events = await prisma.usageEvent.findMany();
    expect(events.length).toBe(2);
    expect(
      events.every((event) => {
        const firstSeen = event.first_seen_at?.getTime() ?? 0;
        const lastSeen = event.last_seen_at?.getTime() ?? 0;
        return firstSeen <= lastSeen;
      }),
    ).toBe(true);
  });
});
