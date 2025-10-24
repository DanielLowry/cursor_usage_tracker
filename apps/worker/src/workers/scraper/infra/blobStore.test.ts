import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../../../../../packages/db/src/client';
import type { Logger } from '../ports';
import { PrismaBlobStore } from './blobStore';

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

async function reset() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE raw_blobs RESTART IDENTITY CASCADE');
}

const hasDatabase = !!process.env.DATABASE_URL;
const describeIfDb = hasDatabase ? describe : describe.skip;

describeIfDb('PrismaBlobStore', () => {
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

  it('deduplicates payloads by content hash', async () => {
    const store = new PrismaBlobStore({ logger: noopLogger });
    const payload = Buffer.from(JSON.stringify({ value: 1 }));
    const capturedAt = new Date('2025-02-05T00:00:00Z');

    const first = await store.saveIfNew({ payload, kind: 'network_json', capturedAt });
    const second = await store.saveIfNew({ payload, kind: 'network_json', capturedAt });

    expect(first.outcome).toBe('saved');
    expect(second.outcome).toBe('duplicate');
    expect(second.blobId).toBe(first.blobId);
  });

  it('trims to retention count keeping newest blobs', async () => {
    const store = new PrismaBlobStore({ logger: noopLogger });
    const base = Date.UTC(2025, 1, 5, 0, 0, 0);

    for (let i = 0; i < 4; i++) {
      const payload = Buffer.from(JSON.stringify({ index: i }));
      const capturedAt = new Date(base + i * 1000);
      const result = await store.saveIfNew({ payload, kind: 'network_json', capturedAt });
      expect(result.outcome).toBe('saved');
    }

    await store.trimRetention(2);

    const rows = await prisma.rawBlob.findMany({ orderBy: { captured_at: 'asc' } });
    expect(rows.length).toBe(2);
    const timestamps = rows.map((row) => row.captured_at.getTime());
    expect(Math.min(...timestamps)).toBe(base + 2 * 1000);
    expect(Math.max(...timestamps)).toBe(base + 3 * 1000);
  });
});
