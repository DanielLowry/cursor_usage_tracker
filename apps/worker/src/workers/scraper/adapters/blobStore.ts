import { createHash } from 'crypto';
import * as zlib from 'zlib';

import prisma from '../../../../../packages/db/src/client';
import { trimRawBlobs } from '../../../../../packages/db/src/retention';

import { ScraperError } from '../errors';
import type { BlobSaveInput, BlobSaveResult, BlobStorePort, LoggerPort } from '../ports';

function gzipBuffer(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gzip(input, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

export class PrismaBlobStoreAdapter implements BlobStorePort {
  constructor(private readonly logger: LoggerPort) {}

  async saveIfNew(input: BlobSaveInput): Promise<BlobSaveResult> {
    const { payload, kind, capturedAt, url, retentionCount } = input;
    const contentHash = createHash('sha256').update(payload).digest('hex');

    try {
      const existing = await prisma.rawBlob.findFirst({
        where: { content_hash: contentHash },
        select: { id: true },
      });

      if (existing) {
        this.logger.info('scraper.blob.duplicate', { blobId: existing.id, kind, contentHash });
        return { status: 'duplicate', blobId: existing.id };
      }

      const gzipped = await gzipBuffer(payload);
      const created = await prisma.rawBlob.create({
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
              method: kind === 'html' ? 'http_csv' : 'network_json',
              url: url ?? null,
              fetched_at: capturedAt.toISOString(),
              size_bytes: payload.length,
            },
          },
        },
        select: { id: true },
      });

      if (typeof retentionCount === 'number') {
        try {
          await trimRawBlobs(retentionCount);
        } catch (trimErr) {
          this.logger.warn('scraper.blob.trim_failed', {
            error: trimErr instanceof Error ? trimErr.message : String(trimErr),
          });
        }
      }

      this.logger.info('scraper.blob.saved', { blobId: created.id, kind, contentHash });
      return { status: 'saved', blobId: created.id };
    } catch (err) {
      this.logger.error('scraper.blob.error', {
        message: err instanceof Error ? err.message : 'unknown',
        contentHash,
      });
      throw new ScraperError('IO_ERROR', 'failed to persist raw blob', { cause: err });
    }
  }
}
