import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import prisma from '../../../../../../packages/db/src/client';
import type { Logger } from '../ports';
import { PrismaBlobStore } from './blobStore';

const noopLogger: Logger = {
  info: () => {},
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

    const contentHash = createHash('sha256').update(payload).digest('hex');
    const meta = {
      source: 'https://example.com/data.json',
      contentHash,
      ingestionId: null,
      headers: {},
      capturedAt,
    } as const;

    const first = await store.saveIfNew({ bytes: payload, meta });
    const second = await store.saveIfNew({ bytes: payload, meta });

    expect(first.kind).toBe('saved');
    expect(second.kind).toBe('duplicate');
    expect(second.blobId).toBe(first.blobId);
  });

  it('stores metadata alongside provenance details', async () => {
    const store = new PrismaBlobStore({ logger: noopLogger });
    const payload = Buffer.from('csv-data');
    const capturedAt = new Date('2025-02-05T00:00:00Z');

    const contentHash = createHash('sha256').update(payload).digest('hex');
    const meta = {
      source: 'https://example.com/page.html',
      contentHash,
      ingestionId: null,
      headers: { 'x-test': 'yes' },
      capturedAt,
    } as const;

    const result = await store.saveIfNew({ bytes: payload, meta });

    expect(result.kind).toBe('saved');

    const row = await prisma.rawBlob.findFirstOrThrow({ where: { id: result.blobId! } });
    expect(row.metadata).toMatchObject({
      headers: { 'x-test': 'yes' },
      source: 'https://example.com/page.html',
      captured_at: capturedAt.toISOString(),
      ingestion_id: null,
    });
  });
});
