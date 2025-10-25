/**
 * Relative path: apps/worker/src/workers/scrape.test.ts
 *
 * Test Purpose:
 * - Validates that the ingestion orchestrator normalizes CSV rows, computes row hashes,
 *   and delegates persistence to the usage event store in an idempotent way.
 *
 * Expected Outcome & Rationale:
 * - The first run inserts all rows while the second run only reports duplicates,
 *   demonstrating row-level dedupe without touching an actual database.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runIngestion, type RunIngestionResult } from './orchestrator';
import type {
  BlobStorePort,
  ClockPort,
  FetchPort,
  FetchResult,
  Logger,
  UsageEventStorePort,
  UsageEventWithRowHash,
} from './scraper/ports';
import { computeSha256 } from './scraper/lib/contentHash';

class TestClock implements ClockPort {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return new Date(this.fixed);
  }
}

class TestLogger implements Logger {
  public logs: Array<{ level: 'info' | 'error'; message: string; context?: Record<string, unknown> }> = [];
  info(message: string, context?: Record<string, unknown>): void {
    this.logs.push({ level: 'info', message, context });
  }
  error(message: string, context?: Record<string, unknown>): void {
    this.logs.push({ level: 'error', message, context });
  }
}

class FakeFetchPort implements FetchPort {
  constructor(private readonly payload: Buffer) {}
  async fetch(): Promise<FetchResult> {
    return {
      bytes: Buffer.from(this.payload),
      headers: { 'content-type': 'text/csv' },
      sourceUrl: 'https://example.com/usage.csv',
    } satisfies FetchResult;
  }
}

class FakeUsageEventStore implements UsageEventStorePort {
  public ingestions: Array<{ events: UsageEventWithRowHash[]; meta: { contentHash: string; source: string } }> = [];
  private seen = new Set<string>();
  private seq = 0;

  async ingest(
    events: UsageEventWithRowHash[],
    meta: { ingestedAt: Date; source: string; contentHash: string; headers: Record<string, unknown> },
  ): Promise<{ ingestionId: string; insertedCount: number; duplicateCount: number }> {
    this.ingestions.push({ events, meta: { contentHash: meta.contentHash, source: meta.source } });
    let inserted = 0;
    let duplicates = 0;
    for (const event of events) {
      if (this.seen.has(event.rowHash)) {
        duplicates += 1;
      } else {
        this.seen.add(event.rowHash);
        inserted += 1;
      }
    }
    this.seq += 1;
    return { ingestionId: `ingestion-${this.seq}`, insertedCount: inserted, duplicateCount: duplicates };
  }

  async recordFailure(_meta: {
    ingestedAt: Date;
    source: string;
    contentHash: string;
    headers: Record<string, unknown>;
    error: { code: string; message: string };
  }): Promise<{ ingestionId: string | null }> {
    this.seq += 1;
    return { ingestionId: `ingestion-${this.seq}` };
  }
}

class FakeBlobStore implements BlobStorePort {
  public saves: Array<{ contentHash: string; source: string }> = [];
  async saveIfNew(input: {
    bytes: Buffer;
    meta: { source: string; contentHash: string; ingestionId: string | null; headers: Record<string, unknown>; capturedAt: Date };
  }): Promise<{ kind: 'saved' | 'duplicate'; contentHash: string; blobId?: string }> {
    this.saves.push({ contentHash: input.meta.contentHash, source: input.meta.source });
    return { kind: 'duplicate', contentHash: input.meta.contentHash };
  }
}

describe('runIngestion (unit)', () => {
  const csvFixture = Buffer.from(
    [
      'Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost,Cost to you',
      '2025-02-01,gpt-4o,10,5,0,15,30,$0.10,$0.10',
      '2025-02-02,gpt-4o-mini,0,0,0,5,5,$0.05,$0.05',
    ].join('\n'),
    'utf8',
  );

  let store: FakeUsageEventStore;
  let blobStore: FakeBlobStore;
  let logger: TestLogger;

  beforeEach(() => {
    store = new FakeUsageEventStore();
    blobStore = new FakeBlobStore();
    logger = new TestLogger();
  });

  async function run(policyOverrides: Partial<{ lastSavedAt: Date | null; ingestionsSinceLastBlob: number }>): Promise<RunIngestionResult> {
    const fetcher = new FakeFetchPort(csvFixture);
    const clock = new TestClock(new Date('2025-03-01T00:00:00Z'));
    return runIngestion({
      fetcher,
      eventStore: store,
      blobStore,
      clock,
      logger,
      source: 'cursor_csv',
      blobPolicy: {
        mode: 'weekly',
        lastSavedAt: policyOverrides.lastSavedAt,
        ingestionsSinceLastBlob: policyOverrides.ingestionsSinceLastBlob,
      },
    });
  }

  it('ingests normalized events and reports dedupe stats across runs', async () => {
    const first = await run({ lastSavedAt: null, ingestionsSinceLastBlob: 0 });
    expect(first.insertedCount).toBe(2);
    expect(first.duplicateCount).toBe(0);
    expect(store.ingestions).toHaveLength(1);
    expect(store.ingestions[0]?.events.length).toBe(2);

    const second = await run({ lastSavedAt: new Date('2025-02-24T00:00:00Z'), ingestionsSinceLastBlob: 10 });
    expect(second.insertedCount).toBe(0);
    expect(second.duplicateCount).toBe(2);

    const eventUpsertLogs = logger.logs.filter((log) => log.message === 'events.upserted');
    expect(eventUpsertLogs.length).toBeGreaterThan(0);

    const blobSkips = logger.logs.filter((log) => log.message === 'blob.skipped');
    expect(blobSkips.length).toBeGreaterThan(0);
    expect(blobSkips[0]?.context?.reason).toBeTypeOf('string');

    const expectedHash = computeSha256(csvFixture);
    expect(blobStore.saves.at(0)?.contentHash).toBe(expectedHash);
  });
});
