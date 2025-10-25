// Relative path: apps/worker/src/workers/scraper/ports.ts
// Ports define the narrow I/O boundary for the scraper orchestrator. These
// interfaces intentionally exclude persistence details so the worker can remain
// pure and testable.
import type { NormalizedUsageEvent } from './core/normalize';

export interface FetchPort {
  fetchCsvExport(): Promise<Buffer>;
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
      metadata: Record<string, unknown>;
      logicVersion: number;
      rawBlobId: string | null;
      size: number;
    },
  ): Promise<{
    ingestionId: string | null;
    insertedCount: number;
    duplicateCount: number;
  }>;
}

export interface ClockPort {
  now(): Date;
}

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface BlobStorePort {
  saveIfNew(input: {
    bytes: Buffer;
    kind: 'html' | 'network_json';
    url?: string;
    capturedAt: Date;
    metadata?: Record<string, unknown>;
  }): Promise<{
    outcome: 'saved' | 'duplicate';
    blobId: string;
    contentHash: string;
  }>;
}
