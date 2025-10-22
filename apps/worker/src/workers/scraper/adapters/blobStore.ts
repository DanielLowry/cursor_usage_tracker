import { createHash } from 'crypto';
import { promisify } from 'util';
import * as zlib from 'zlib';
import prisma from '../../../../../../packages/db/src/client';
import { trimRawBlobs } from '../../../../../../packages/db/src/retention';
import { ScraperError } from '../errors';
import type { BlobSaveResult, BlobStorePort, Logger } from '../ports';

const gzipAsync = promisify(zlib.gzip);

export type PrismaBlobStoreOptions = {
  logger: Logger;
};

export class PrismaBlobStore implements BlobStorePort {
  constructor(private readonly options: PrismaBlobStoreOptions) {}

  async saveIfNew(input: {
    payload: Buffer;
    kind: 'html' | 'network_json';
    url?: string;
    capturedAt: Date;
  }): Promise<BlobSaveResult> {
    const { payload, kind, url, capturedAt } = input;
    const contentHash = createHash('sha256').update(payload).digest('hex');

    try {
      const existing = await prisma.rawBlob.findFirst({
        where: { content_hash: contentHash },
        select: { id: true },
      });
      if (existing) {
        this.options.logger.info('scraper.blob.duplicate', { blobId: existing.id, contentHash });
        return { outcome: 'duplicate', blobId: existing.id as string, contentHash };
      }

      const gzipped = await gzipAsync(payload);
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
              size_bytes: payload.length,
            },
          },
        },
        select: { id: true },
      });
      this.options.logger.info('scraper.blob.saved', { blobId: blob.id, contentHash });
      return { outcome: 'saved', blobId: blob.id, contentHash };
    } catch (err: any) {
      if (err?.code === 'P2002') {
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

  async trimRetention(retain: number): Promise<void> {
    try {
      await trimRawBlobs(retain);
      this.options.logger.debug('scraper.blob.trim_retention', { retain });
    } catch (err) {
      throw new ScraperError('IO_ERROR', 'failed trimming raw blob retention', { cause: err });
    }
  }
}
