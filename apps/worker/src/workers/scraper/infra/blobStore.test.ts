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

    const first = await store.saveIfNew({ bytes: payload, kind: 'network_json', capturedAt });
    const second = await store.saveIfNew({ bytes: payload, kind: 'network_json', capturedAt });

    expect(first.outcome).toBe('saved');
    expect(second.outcome).toBe('duplicate');
    expect(second.blobId).toBe(first.blobId);
  });

  it('stores metadata alongside provenance details', async () => {
    const store = new PrismaBlobStore({ logger: noopLogger });
    const payload = Buffer.from('csv-data');
    const capturedAt = new Date('2025-02-05T00:00:00Z');

    const result = await store.saveIfNew({
      bytes: payload,
      kind: 'html',
      capturedAt,
      metadata: { reason: 'test' },
    });

    expect(result.outcome).toBe('saved');

    const row = await prisma.rawBlob.findUniqueOrThrow({ where: { id: result.blobId } });
    expect(row.metadata).toMatchObject({
      provenance: {
        fetched_at: capturedAt.toISOString(),
        size_bytes: payload.length,
      },
      reason: 'test',
    });
  });
});
