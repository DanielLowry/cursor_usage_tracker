import type { NormalizedUsageEvent } from '@cursor-usage/ingest';

import type { CapturedKind } from './core/normalize';

export type BlobSaveInput = {
  payload: Buffer;
  kind: CapturedKind;
  capturedAt: Date;
  url?: string;
  retentionCount?: number;
};

export type BlobSaveResult =
  | { status: 'saved'; blobId: string }
  | { status: 'duplicate'; blobId: string };

export interface FetchPort {
  fetchUsageCsv(): Promise<Buffer>;
}

export interface BlobStorePort {
  saveIfNew(input: BlobSaveInput): Promise<BlobSaveResult>;
}

export type SnapshotPeriod = {
  start: Date | null;
  end: Date | null;
};

export type SnapshotPersistInput = {
  tableHash: string;
  totalRowsCount: number;
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  capturedAt: Date;
  normalizedDeltaEvents: NormalizedUsageEvent[];
};

export type SnapshotPersistResult = {
  snapshotId: string | null;
  wasNew: boolean;
  usageEventIds: string[];
};

export interface SnapshotStorePort {
  findLatestCapture(period: SnapshotPeriod): Promise<Date | null>;
  persistDelta(input: SnapshotPersistInput): Promise<SnapshotPersistResult>;
}

export interface ClockPort {
  now(): Date;
}

export interface LoggerPort {
  info(event: string, payload?: Record<string, unknown>): void;
  warn(event: string, payload?: Record<string, unknown>): void;
  error(event: string, payload?: Record<string, unknown>): void;
}
