// Relative path: apps/worker/src/workers/scraper/ports.ts
// Port interfaces define the boundaries for fetch, blob storage, snapshot
// persistence, time source, and logging used by the orchestrator.
import type { NormalizedUsageEvent } from './normalize';

export interface FetchPort {
  fetchCsvExport(): Promise<Buffer>;
}

export type NormalizedUsageEventWithHash = NormalizedUsageEvent & { rowHash: string };

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
  contentHash?: string | null;
  ingestionHeaders?: Record<string, unknown> | null;
  ingestionMetadata?: Record<string, unknown> | null;
  logicVersion?: number | null;
};

export type SnapshotPersistResult = {
  snapshotId: string | null;
  wasNew: boolean;
  usageEventIds: string[];
};

export interface UsageEventStorePort {
  ingest(input: UsageEventIngestInput): Promise<UsageEventIngestResult>;
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
