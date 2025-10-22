import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LoggerPort } from '../../ports';

type RawBlobRecord = {
  id: string;
  captured_at: Date;
  kind: string;
  url?: string | null;
  payload: Buffer;
  content_hash: string;
  content_type?: string | null;
  schema_version?: string | null;
  metadata?: unknown;
};

const rawBlobStore: RawBlobRecord[] = [];

vi.mock('../../../../../packages/db/src/client', () => ({
  __esModule: true,
  default: {
    rawBlob: {
      findFirst: vi.fn(async ({ where }: { where: { content_hash: string } }) => {
        return rawBlobStore.find((row) => row.content_hash === where.content_hash) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Omit<RawBlobRecord, 'id'> }) => {
        const id = `blob-${rawBlobStore.length + 1}`;
        rawBlobStore.push({ id, ...data });
        return { id };
      }),
    },
  },
}));

vi.mock('../../../../../packages/db/src/retention', () => ({
  __esModule: true,
  trimRawBlobs: vi.fn(async (keep: number) => {
    if (rawBlobStore.length <= keep) return;
    rawBlobStore.sort((a, b) => a.captured_at.getTime() - b.captured_at.getTime());
    while (rawBlobStore.length > keep) {
      rawBlobStore.shift();
    }
  }),
}));

import { PrismaBlobStoreAdapter } from '../blobStore';

class TestLogger implements LoggerPort {
  info(): void {}
  warn(): void {}
  error(): void {}
}

describe('PrismaBlobStoreAdapter', () => {
  beforeEach(() => {
    rawBlobStore.length = 0;
  });

  it('saves new payloads and deduplicates by content hash', async () => {
    const logger = new TestLogger();
    const adapter = new PrismaBlobStoreAdapter(logger);
    const payload = Buffer.from('hello world');
    const capturedAt = new Date('2024-02-01T00:00:00Z');

    const first = await adapter.saveIfNew({
      payload,
      kind: 'html',
      capturedAt,
      url: 'https://cursor.com/export.csv',
      retentionCount: 10,
    });

    expect(first.status).toBe('saved');
    expect(rawBlobStore.length).toBe(1);

    const second = await adapter.saveIfNew({
      payload,
      kind: 'html',
      capturedAt,
      url: 'https://cursor.com/export.csv',
      retentionCount: 10,
    });

    expect(second.status).toBe('duplicate');
    expect(second.blobId).toBe(first.blobId);
    expect(rawBlobStore.length).toBe(1);
  });

  it('enforces retention when keepN is lower than stored blobs', async () => {
    const logger = new TestLogger();
    const adapter = new PrismaBlobStoreAdapter(logger);
    const base = new Date('2024-02-01T00:00:00Z');

    for (let i = 0; i < 5; i++) {
      await adapter.saveIfNew({
        payload: Buffer.from(`payload-${i}`),
        kind: 'network_json',
        capturedAt: new Date(base.getTime() + i * 1000),
        url: `https://cursor.com/export-${i}.json`,
        retentionCount: 3,
      });
    }

    expect(rawBlobStore.length).toBe(3);
  });
});
