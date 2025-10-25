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
    meta: {
      source: string;
      contentHash: string;
      ingestionId: string | null;
      headers: Record<string, unknown>;
      capturedAt: Date;
    };
  }): Promise<{ kind: 'saved' | 'duplicate'; contentHash: string; blobId?: string }> {
    const { bytes, meta } = input;
    const { capturedAt, contentHash, ingestionId, headers, source } = meta;
    const effectiveHash = createHash('sha256').update(bytes).digest('hex');
    if (effectiveHash !== contentHash) {
      this.options.logger.info('blob.hash_mismatch', {
        providedHash: contentHash,
        computedHash: effectiveHash,
      });
    }

    try {
      const existing = await prisma.rawBlob.findFirst({
        where: { content_hash: effectiveHash },
        select: { id: true },
      });
      if (existing) {
        this.options.logger.info('blob.skipped', { reason: 'duplicate', contentHash: effectiveHash });
        if (ingestionId) {
          await prisma.ingestion.updateMany({
            where: { id: ingestionId, raw_blob_id: null },
            data: { raw_blob_id: existing.id },
          });
        }
        return { kind: 'duplicate', contentHash: effectiveHash, blobId: existing.id };
      }

      const gzipped = await gzipAsync(bytes);
      const blob = await prisma.rawBlob.create({
        data: {
          captured_at: capturedAt,
          kind: 'html',
          url: source,
          payload: gzipped,
          content_hash: effectiveHash,
          content_type: 'text/csv',
          schema_version: 'v1',
          metadata: {
            headers,
            source,
            captured_at: capturedAt.toISOString(),
            ingestion_id: ingestionId,
          },
        },
        select: { id: true },
      });

      if (ingestionId) {
        await prisma.ingestion.updateMany({
          where: { id: ingestionId },
          data: { raw_blob_id: blob.id },
        });
      }

      this.options.logger.info('blob.saved', { blobId: blob.id, contentHash: effectiveHash });
      return { kind: 'saved', contentHash: effectiveHash, blobId: blob.id };
    } catch (err) {
      throw new ScraperError('IO_ERROR', 'failed to persist raw blob', { cause: err });
    }
  }
}
