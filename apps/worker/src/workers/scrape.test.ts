/**
 * Relative path: apps/worker/src/workers/scrape.test.ts
 *
 * Test Purpose:
 * - Validates that the scraper orchestrator normalizes CSV rows, computes row hashes,
 *   and delegates persistence to the usage event store in an idempotent way.
 * - Validates that the scraper orchestrator normalizes CSV rows, computes row hashes,
 *   and delegates persistence to the usage event store in an idempotent way.
 *
 * Assumptions:
 * - The in-memory fake usage event store mimics `row_hash` uniqueness semantics.
 * - The CSV fixture matches the minimal header set expected by the parser.
 * - The in-memory fake usage event store mimics `row_hash` uniqueness semantics.
 * - The CSV fixture matches the minimal header set expected by the parser.
 *
 * Expected Outcome & Rationale:
 * - The first run inserts all rows, while the second run reports duplicates only,
 *   demonstrating end-to-end dedupe without touching an actual database.
 */
import { describe, it, expect } from 'vitest';
import { ScraperOrchestrator, type ScrapeResult } from './scraper';
import type {
  ClockPort,
  FetchPort,
  Logger,
  UsageEventIngestInput,
  UsageEventIngestResult,
  UsageEventStorePort,
} from './scraper/ports';
import { computeSha256 } from './scraper/lib/contentHash';

class TestClock implements ClockPort {
  constructor(private readonly fixedNow: Date) {}
  now(): Date {
    return new Date(this.fixedNow);
  }
}

class TestLogger implements Logger {
  public logs: Array<{ level: string; message: string; context?: Record<string, unknown> }> = [];
  private push(level: string, message: string, context?: Record<string, unknown>) {
    const entry: { level: string; message: string; context?: Record<string, unknown> } = {
      level,
      message,
    };
    if (context !== undefined) {
      entry.context = context;
    }
    this.logs.push(entry);
  }
  debug(message: string, context?: Record<string, unknown>) {
    this.push('debug', message, context);
  }
  info(message: string, context?: Record<string, unknown>) {
    this.push('info', message, context);
  }
  warn(message: string, context?: Record<string, unknown>) {
    this.push('warn', message, context);
  }
  error(message: string, context?: Record<string, unknown>) {
    this.push('error', message, context);
  }
}

class FakeFetchPort implements FetchPort {
  constructor(private readonly payload: Buffer) {}
  async fetchCsvExport(): Promise<Buffer> {
    return Buffer.from(this.payload);
  }
}

class FakeUsageEventStore implements UsageEventStorePort {
  public ingestions: UsageEventIngestInput[] = [];
  private seen = new Set<string>();
  private seq = 0;

  async ingest(input: UsageEventIngestInput): Promise<UsageEventIngestResult> {
    this.ingestions.push(input);
    let insertedCount = 0;
    let duplicateCount = 0;
    for (const event of input.events) {
      if (this.seen.has(event.rowHash)) {
        duplicateCount += 1;
      } else {
        this.seen.add(event.rowHash);
        insertedCount += 1;
      }
    }
    this.seq += 1;
    return {
      ingestionId: `ingestion-${this.seq}`,
      insertedCount,
      duplicateCount,
      rowHashes: input.events.map((event) => event.rowHash),
    };
  }
}

describe('ScraperOrchestrator (unit)', () => {
  const csvFixture = Buffer.from(
    [
      'Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost,Cost to you',
      '2025-02-01,gpt-4o,10,5,0,15,30,$0.10,$0.10',
      '2025-02-02,gpt-4o-mini,0,0,0,5,5,$0.05,$0.05',
    ].join('\n'),
    'utf8',
  );
  const expectedHash = computeSha256(csvFixture);

  function buildOrchestrator(store: FakeUsageEventStore, logger: TestLogger) {
    const fetchPort = new FakeFetchPort(csvFixture);
    const clock = new TestClock(new Date('2025-03-01T00:00:00Z'));
    return new ScraperOrchestrator({
      fetchPort,
      eventStore: store,
      clock,
      logger,
      csvSourceUrl: 'https://example.com/usage.csv',
      ingestionSource: 'cursor_csv',
      logicVersion: 1,
    });
  }

  async function run(orchestrator: ScraperOrchestrator): Promise<ScrapeResult> {
    return orchestrator.run();
  }

  it('ingests normalized events and reports dedupe stats across runs', async () => {
    const store = new FakeUsageEventStore();
    const logger = new TestLogger();
    const orchestrator = buildOrchestrator(store, logger);

    const first = await run(orchestrator);
    expect(first.contentHash).toBe(expectedHash);
    expect(first.insertedCount).toBe(2);
    expect(first.duplicateCount).toBe(0);
    expect(first.rowHashes.length).toBe(2);

    expect(store.ingestions).toHaveLength(1);
    const ingestInput = store.ingestions.at(0);
    expect(ingestInput).toBeDefined();
    if (!ingestInput) throw new Error('expected ingestion input');
    expect(ingestInput.events.length).toBe(2);
    expect(ingestInput.metadata?.row_count).toBe(2);
    expect(ingestInput.headers['content-type']).toBe('text/csv');

    const second = await run(orchestrator);
    expect(second.insertedCount).toBe(0);
    expect(second.duplicateCount).toBe(2);
    expect(second.rowHashes).toHaveLength(2);

    const eventUpsertLogs = logger.logs.filter((log) => log.message === 'events.upserted');
    expect(eventUpsertLogs.length).toBeGreaterThanOrEqual(2);
  });
});
