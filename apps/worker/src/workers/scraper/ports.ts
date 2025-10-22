import type { NormalizedUsageEvent } from '@cursor-usage/ingest';
import type { SnapshotResult } from '../../../../packages/db/src/snapshots';

export type ScraperErrorCode =
  | 'FETCH_ERROR'
  | 'CSV_PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'DB_CONFLICT'
  | 'IO_ERROR';

export class ScraperError extends Error {
  readonly code: ScraperErrorCode;
  readonly cause?: unknown;
  readonly context?: Record<string, unknown>;

  constructor(
    code: ScraperErrorCode,
    message: string,
    options: { cause?: unknown; context?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'ScraperError';
    this.code = code;
    this.cause = options.cause;
    this.context = options.context;
  }
}

export type CapturedBlob = {
  url?: string;
  payload: Buffer;
  kind: 'html' | 'network_json';
};

export interface FetchPort {
  fetchUsageCsv(): Promise<Buffer>;
}

export type BlobSaveParams = {
  capture: CapturedBlob;
  capturedAt: Date;
  metadata?: Record<string, unknown> | null;
};

export type BlobSaveResult =
  | { status: 'saved'; blobId: string; contentHash: string }
  | { status: 'duplicate'; blobId: string; contentHash: string };

export interface BlobStorePort {
  saveIfNew(params: BlobSaveParams): Promise<BlobSaveResult>;
  enforceRetention(limit: number): Promise<void>;
}

export interface SnapshotStorePort {
  findLatestCapture(params: {
    billingPeriodStart: Date | null;
    billingPeriodEnd: Date | null;
  }): Promise<Date | null>;

  persistDelta(params: {
    billingPeriodStart: Date | null;
    billingPeriodEnd: Date | null;
    tableHash: string;
    totalRowsCount: number;
    capturedAt: Date;
    normalizedDeltaEvents: NormalizedUsageEvent[];
  }): Promise<SnapshotResult>;
}

export interface ClockPort {
  now(): Date;
}

export interface Logger {
  info(event: string, meta?: Record<string, unknown>): void;
  warn(event: string, meta?: Record<string, unknown>): void;
  error(event: string, meta?: Record<string, unknown>): void;
  debug?(event: string, meta?: Record<string, unknown>): void;
}

export type ScraperDependencies = {
  fetchPort: FetchPort;
  blobStore: BlobStorePort;
  snapshotStore: SnapshotStorePort;
  clock: ClockPort;
  logger: Logger;
  retentionLimit: number;
};
