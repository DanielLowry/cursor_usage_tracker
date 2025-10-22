// Relative path: apps/worker/src/workers/scraper/ports.ts
// Port interfaces define the boundaries for fetch, blob storage, snapshot
// persistence, time source, and logging used by the orchestrator.
import type { NormalizedUsageEvent } from './normalize';

export interface FetchPort {
  fetchCsvExport(): Promise<Buffer>;
}

export type BlobSaveResult =
  | { outcome: 'saved'; blobId: string; contentHash: string }
  | { outcome: 'duplicate'; blobId: string; contentHash: string };

export interface BlobStorePort {
  saveIfNew(input: { payload: Buffer; kind: 'html' | 'network_json'; url?: string; capturedAt: Date }): Promise<BlobSaveResult>;
  trimRetention(retain: number): Promise<void>;
}

export type SnapshotPersistInput = {
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  tableHash: string;
  totalRowsCount: number;
  capturedAt: Date;
  deltaEvents: NormalizedUsageEvent[];
};

export type SnapshotPersistResult = {
  snapshotId: string | null;
  wasNew: boolean;
  usageEventIds: string[];
};

export interface SnapshotStorePort {
  findLatestCapture(period: { start: Date | null; end: Date | null }): Promise<Date | null>;
  persistSnapshot(input: SnapshotPersistInput): Promise<SnapshotPersistResult>;
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
