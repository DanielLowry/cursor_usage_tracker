// Relative path: apps/worker/src/workers/scraper/infra/blobStore.ts
// Adapter persisting raw blobs (CSV/JSON) to the database with dedup and retention.
import { createHash } from 'crypto';
import { promisify } from 'util';
import * as zlib from 'zlib';
import prisma from '../../../../../../packages/db/src/client';
import { ScraperError } from '../errors';
import type { BlobStorePort, Logger } from '../ports';

const gzipAsync = promisify(zlib.gzip);

export type PrismaBlobStoreOptions = {
  logger: Logger;
};

/**
 * BlobStorePort implementation backed by Prisma. Deduplicates by sha256 of the
 * raw payload and gzips before storing.
 */
export class PrismaBlobStore implements BlobStorePort {
  constructor(private readonly options: PrismaBlobStoreOptions) {}

  /**
   * Persists the blob if its content hash is new. Returns whether it was saved
   * or detected as a duplicate, along with ids and hash.
   */
  async saveIfNew(input: {
    bytes: Buffer;
    kind: 'html' | 'network_json';
    url?: string;
    capturedAt: Date;
    metadata?: Record<string, unknown>;
  }): Promise<{ outcome: 'saved' | 'duplicate'; blobId: string; contentHash: string }> {
    const { bytes, kind, url, capturedAt, metadata } = input;
    const contentHash = createHash('sha256').update(bytes).digest('hex');

    try {
      const existing = await prisma.rawBlob.findFirst({
        where: { content_hash: contentHash },
        select: { id: true },
      });
      if (existing) {
        this.options.logger.info('scraper.blob.duplicate', { blobId: existing.id, contentHash });
        return { outcome: 'duplicate', blobId: existing.id as string, contentHash };
      }

      const gzipped = await gzipAsync(bytes);
      const blob = await prisma.rawBlob.create({
        data: {
          captured_at: capturedAt,
          kind,
          url,
          payload: gzipped,
          content_hash: contentHash,
          content_type: kind === 'html' ? 'text/csv' : 'application/json',
          schema_version: 'v1',
          metadata: {
            provenance: {
              method: kind === 'html' ? 'http_csv' : 'fixture',
              url: url ?? null,
              fetched_at: capturedAt.toISOString(),
              size_bytes: bytes.length,
            },
            ...(metadata ?? {}),
          },
        },
        select: { id: true },
      });
      this.options.logger.info('scraper.blob.saved', { blobId: blob.id, contentHash });
      return { outcome: 'saved', blobId: blob.id, contentHash };
    } catch (err) {
      if (isUniqueConstraintViolation(err)) {
        const existing = await prisma.rawBlob.findFirst({
          where: { content_hash: contentHash },
          select: { id: true },
        });
        if (existing) {
          this.options.logger.warn('scraper.blob.duplicate_race', { blobId: existing.id, contentHash });
          return { outcome: 'duplicate', blobId: existing.id as string, contentHash };
        }
        throw new ScraperError('DB_CONFLICT', 'raw_blob unique constraint violated without existing record', { cause: err });
      }
      throw new ScraperError('IO_ERROR', 'failed to persist raw blob', { cause: err });
    }
  }
}

function isUniqueConstraintViolation(err: unknown): err is { code: string } {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === 'P2002';
}
