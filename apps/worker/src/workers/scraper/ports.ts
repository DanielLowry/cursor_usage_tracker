// Relative path: apps/worker/src/workers/scraper/ports.ts
// Ports define the narrow I/O boundary for the ingestion orchestrator.
// The interfaces here intentionally avoid persistence details so the
// orchestrator can remain pure, deterministic, and easy to test.
import type { NormalizedUsageEvent } from './core/normalize';

export interface FetchResult {
  bytes: Buffer;
  headers: Record<string, unknown>;
  sourceUrl?: string;
}

export interface FetchPort {
  fetch(): Promise<FetchResult>;
}

export type UsageEventWithRowHash = NormalizedUsageEvent & { rowHash: string };

export interface UsageEventStorePort {
  ingest(
    events: UsageEventWithRowHash[],
    meta: {
      ingestedAt: Date;
      source: string;
      contentHash: string;
      headers: Record<string, unknown>;
    },
  ): Promise<{
    ingestionId: string;
    insertedCount: number;
    duplicateCount: number;
  }>;

  recordFailure(
    meta: {
      ingestedAt: Date;
      source: string;
      contentHash: string;
      headers: Record<string, unknown>;
      error: { code: string; message: string };
    },
  ): Promise<{ ingestionId: string | null }>;
}

export interface BlobStorePort {
  saveIfNew(input: {
    bytes: Buffer;
    meta: {
      source: string;
      contentHash: string;
      ingestionId: string | null;
      headers: Record<string, unknown>;
      capturedAt: Date;
    };
  }): Promise<{ kind: 'saved' | 'duplicate'; contentHash: string; blobId?: string }>;
}

export interface ClockPort {
  now(): Date;
}

export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}
