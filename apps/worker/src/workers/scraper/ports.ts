// Relative path: apps/worker/src/workers/scraper/ports.ts
// Port interfaces define the boundaries for fetch, blob storage, snapshot
// persistence, time source, and logging used by the orchestrator.
import type { NormalizedUsageEvent } from './core/normalize';

export interface FetchPort {
  fetchCsvExport(): Promise<Buffer>;
}

export type NormalizedUsageEventWithHash = NormalizedUsageEvent & { rowHash: string };

export type UsageEventIngestInput = {
  events: NormalizedUsageEventWithHash[];
  ingestedAt: Date;
  contentHash: string;
  size: number;
  headers: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  logicVersion?: number | null;
  rawBlobId?: string | null;
  source: string;
};

export type UsageEventIngestResult = {
  ingestionId: string | null;
  insertedCount: number;
  duplicateCount: number;
  rowHashes: string[];
};

export type UsageEventRecordFailureInput = {
  source: string;
  ingestedAt: Date;
  contentHash?: string | null;
  headers?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  logicVersion?: number | null;
  rawBlobId?: string | null;
  size?: number | null;
  error: { code: string; message: string };
};

export interface UsageEventStorePort {
  ingest(input: UsageEventIngestInput): Promise<UsageEventIngestResult>;
  recordFailure(input: UsageEventRecordFailureInput): Promise<{ ingestionId: string | null }>;
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

export type BlobSaveResult = {
  outcome: 'saved' | 'duplicate';
  blobId: string;
  contentHash: string;
};

export interface BlobStorePort {
  saveIfNew(input: { payload: Buffer; kind: 'html' | 'network_json'; url?: string; capturedAt: Date }): Promise<BlobSaveResult>;
  trimRetention(retain: number): Promise<void>;
}
