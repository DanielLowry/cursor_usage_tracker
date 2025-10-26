/**
 * File: packages/db/src/eventStore.ts
 *
 * Purpose:
 * - Persist normalized usage events and their ingestion metadata using Prisma.
 * - Deduplicate events via a deterministic row hash, upserting as needed.
 * - Link usage events to the specific ingestion that produced them.
 * - Provide helpers to ingest raw payloads (e.g., network JSON) and to record failed ingestions.
 */
import { Prisma } from '@prisma/client';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import prisma from './client';
import {
  mapNetworkJson,
  type NormalizedUsageEvent,
  computeUsageEventRowHash,
} from '@cursor-usage/ingest';

type EventWithHash = {
  event: NormalizedUsageEvent;
  rowHash: string;
};

type JsonInput = Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;

type EnsureIngestionParams = {
  source: string;
  ingestedAt: Date;
  contentHash: string | null;
  headers: JsonInput;
  metadata: JsonInput;
  rawBlobId: string | null;
  status: 'completed' | 'failed';
};

/**
 * Convert a nullable object to a Prisma-compatible JSON input, preserving explicit nulls.
 */
function toJsonInput(value: Record<string, unknown> | null | undefined): JsonInput {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

/**
 * Create or update an `ingestion` record.
 * - Uses upsert to handle unique content hash conflicts atomically.
 */
async function ensureIngestion(
  tx: Prisma.TransactionClient,
  params: EnsureIngestionParams,
) {
  // Use upsert when we have a contentHash to handle conflicts atomically
  if (params.contentHash) {
    return await tx.ingestion.upsert({
      where: { content_hash: params.contentHash },
      create: {
        source: params.source,
        ingested_at: params.ingestedAt,
        content_hash: params.contentHash,
        headers: params.headers,
        metadata: params.metadata,
        status: params.status,
        raw_blob_id: params.rawBlobId,
      },
      update: {
        status: params.status,
        headers: params.headers,
        metadata: params.metadata,
        ingested_at: params.ingestedAt,
        raw_blob_id: params.rawBlobId,
      },
    });
  }
  
  // Fallback for cases without contentHash - just create
  return await tx.ingestion.create({
    data: {
      source: params.source,
      ingested_at: params.ingestedAt,
      content_hash: params.contentHash,
      headers: params.headers,
      metadata: params.metadata,
      status: params.status,
      raw_blob_id: params.rawBlobId,
    },
  });
}

/**
 * Build the data shape for inserting a `usageEvent` row from a normalized event.
 */
function buildUsageEventCreateData(
  event: NormalizedUsageEvent,
  rowHash: string,
  ingestedAt: Date,
  logicVersion: number,
) {
  return {
    row_hash: rowHash,
    captured_at: event.captured_at,
    kind: event.kind ?? null,
    model: event.model,
    max_mode: event.max_mode ?? null,
    input_with_cache_write_tokens: event.input_with_cache_write_tokens,
    input_without_cache_write_tokens: event.input_without_cache_write_tokens,
    cache_read_tokens: event.cache_read_tokens,
    output_tokens: event.output_tokens,
    total_tokens: event.total_tokens,
    api_cost_cents: event.api_cost_cents,
    api_cost_raw: event.api_cost_raw ?? null,
    cost_to_you_cents: event.cost_to_you_cents,
    cost_to_you_raw: event.cost_to_you_raw ?? null,
    billing_period_start: event.billing_period_start ?? null,
    billing_period_end: event.billing_period_end ?? null,
    source: event.source,
    first_seen_at: ingestedAt,
    last_seen_at: ingestedAt,
    logic_version: logicVersion,
  } satisfies Prisma.UsageEventCreateManyInput;
}

/**
 * Link a set of usage event row hashes to an ingestion via the join table.
 */
async function linkToIngestion(
  tx: Prisma.TransactionClient,
  rowHashes: string[],
  ingestionId: string,
): Promise<void> {
  if (rowHashes.length === 0) return;

  await tx.eventIngestion.createMany({
    data: rowHashes.map((rowHash) => ({
      row_hash: rowHash,
      ingestion_id: ingestionId,
    })),
    skipDuplicates: true,
  });
}

/**
 * Compose ingestion metadata including counts, row hashes and logic version.
 * Also carries forward optional billing period boundaries from the first event.
 */
function buildIngestionMetadata(
  base: Record<string, unknown> | null | undefined,
  rows: EventWithHash[],
  logicVersion: number,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...(base ?? {}),
    row_count: rows.length,
    row_hashes: rows.map((row) => row.rowHash),
    logic_version: logicVersion,
  };

  const first = rows[0]?.event;
  metadata.billing_period_start = first?.billing_period_start?.toISOString() ?? null;
  metadata.billing_period_end = first?.billing_period_end?.toISOString() ?? null;

  return metadata;
}

export type IngestNormalizedUsageEventsParams = {
  normalizedEvents: NormalizedUsageEvent[];
  ingestedAt: Date;
  rawBlobId?: string | null;
  contentHash?: string | null;
  headers?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  logicVersion?: number | null;
  source?: string | null;
};

export type IngestNormalizedUsageEventsResult = {
  ingestionId: string | null;
  insertedCount: number;
  updatedCount: number;
  usageEventIds: string[];
};

/**
 * Ingest a batch of already-normalized usage events.
 * - Computes deterministic row hashes to dedupe existing events.
 * - Inserts new events; updates `last_seen_at`/`logic_version` for duplicates.
 * - Records an `ingestion` and links events to it.
 */
export async function ingestNormalizedUsageEvents(
  params: IngestNormalizedUsageEventsParams,
): Promise<IngestNormalizedUsageEventsResult> {
  const logicVersion = params.logicVersion ?? 1;
  const rows: EventWithHash[] = params.normalizedEvents.map((event) => ({
    event,
    rowHash: computeUsageEventRowHash(event, logicVersion),
  }));

  const source = params.source ?? rows[0]?.event.source ?? 'unknown';
  const metadata = buildIngestionMetadata(params.metadata, rows, logicVersion);

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const ingestion = await ensureIngestion(tx, {
      source,
      ingestedAt: params.ingestedAt,
      contentHash: params.contentHash ?? null,
      headers: toJsonInput(params.headers ?? null),
      metadata: toJsonInput(metadata),
      rawBlobId: params.rawBlobId ?? null,
      status: 'completed',
    });

    if (rows.length === 0) {
      return { ingestionId: ingestion.id, insertedCount: 0, updatedCount: 0, usageEventIds: [] };
    }

    const rowHashes = rows.map((row) => row.rowHash);

    const existingRows = await tx.usageEvent.findMany({
      where: { row_hash: { in: rowHashes } },
      select: { row_hash: true },
    });
    const existingSet = new Set(existingRows.map((row: { row_hash: string }) => row.row_hash));

    const newRows = rows.filter((row) => !existingSet.has(row.rowHash));
    const duplicateRows = rows.filter((row) => existingSet.has(row.rowHash));

    if (newRows.length > 0) {
      await tx.usageEvent.createMany({
        data: newRows.map(({ event, rowHash }) =>
          buildUsageEventCreateData(event, rowHash, params.ingestedAt, logicVersion),
        ),
        skipDuplicates: true,
      });
    }

    if (duplicateRows.length > 0) {
      await tx.usageEvent.updateMany({
        where: { row_hash: { in: duplicateRows.map((row) => row.rowHash) } },
        data: {
          last_seen_at: params.ingestedAt,
          logic_version: logicVersion,
        },
      });
    }

    await linkToIngestion(tx, rowHashes, ingestion.id);

    return {
      ingestionId: ingestion.id,
      insertedCount: newRows.length,
      updatedCount: duplicateRows.length,
      usageEventIds: rowHashes,
    };
  });
}

export type IngestUsagePayloadParams = {
  payload: unknown;
  capturedAt: Date;
  rawBlobId?: string | null;
  contentHash?: string | null;
  headers?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  logicVersion?: number | null;
  source?: string | null;
};

/**
 * Ingest a raw provider/network payload by first normalizing it and then delegating
 * to `ingestNormalizedUsageEvents`.
 */
export async function ingestUsagePayload(
  params: IngestUsagePayloadParams,
): Promise<IngestNormalizedUsageEventsResult> {
  const normalizedEvents = mapNetworkJson(params.payload, params.capturedAt, params.rawBlobId ?? null);

  return ingestNormalizedUsageEvents({
    normalizedEvents,
    ingestedAt: params.capturedAt,
    rawBlobId: params.rawBlobId ?? null,
    contentHash: params.contentHash ?? null,
    headers: params.headers ?? null,
    metadata: params.metadata ?? null,
    logicVersion: params.logicVersion ?? null,
    source: params.source ?? normalizedEvents[0]?.source ?? 'network_json',
  });
}

export type RecordFailedIngestionParams = {
  source: string;
  ingestedAt: Date;
  contentHash?: string | null;
  headers?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  rawBlobId?: string | null;
  logicVersion?: number | null;
  size?: number | null;
  error: { code: string; message: string };
};

/**
 * Persist a failed ingestion attempt with error and optional size metadata.
 */
export async function recordFailedIngestion(params: RecordFailedIngestionParams): Promise<{ ingestionId: string | null }> {
  const metadata = {
    ...(params.metadata ?? {}),
    row_count: 0,
    row_hashes: [] as string[],
    logic_version: params.logicVersion ?? 1,
    bytes: params.size ?? null,
    error: params.error,
  } satisfies Record<string, unknown>;

  const ingestion = await prisma.ingestion.create({
    data: {
      source: params.source,
      ingested_at: params.ingestedAt,
      content_hash: params.contentHash ?? null,
      headers: toJsonInput(params.headers ?? null),
      metadata: toJsonInput(metadata),
      status: 'failed',
      raw_blob_id: params.rawBlobId ?? null,
    },
  });

  return { ingestionId: ingestion.id };
}
