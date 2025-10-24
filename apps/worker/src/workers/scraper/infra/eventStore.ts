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
};

function toJsonInput(value: Record<string, unknown> | null | undefined): JsonInput {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

async function ensureIngestion(
  tx: Prisma.TransactionClient,
  params: EnsureIngestionParams,
) {
  try {
    return await tx.ingestion.create({
      data: {
        source: params.source,
        ingested_at: params.ingestedAt,
        content_hash: params.contentHash,
        headers: params.headers,
        metadata: params.metadata,
        status: 'completed',
        raw_blob_id: params.rawBlobId,
      },
    });
  } catch (err) {
    if (
      params.contentHash &&
      err instanceof PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const existing = await tx.ingestion.findFirst({
        where: { content_hash: params.contentHash },
      });
      if (existing) return existing;
    }
    throw err;
  }
}

async function persistUsageEvent(
  tx: Prisma.TransactionClient,
  item: EventWithHash,
  ingestedAt: Date,
  logicVersion: number,
): Promise<boolean> {
  const existing = await tx.usageEvent.findUnique({
    where: { row_hash: item.rowHash },
    select: { row_hash: true },
  });

  if (existing) {
    await tx.usageEvent.update({
      where: { row_hash: item.rowHash },
      data: {
        last_seen_at: ingestedAt,
        logic_version: logicVersion,
      },
    });
    return false;
  }

  const event = item.event;
  await tx.usageEvent.create({
    data: {
      row_hash: item.rowHash,
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
    },
  });

  return true;
}

async function linkToIngestion(
  tx: Prisma.TransactionClient,
  rowHash: string,
  ingestionId: string,
): Promise<void> {
  await tx.eventIngestion.upsert({
    where: {
      row_hash_ingestion_id: {
        row_hash: rowHash,
        ingestion_id: ingestionId,
      },
    },
    update: {},
    create: {
      row_hash: rowHash,
      ingestion_id: ingestionId,
    },
  });
}

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
    });

    if (rows.length === 0) {
      return { ingestionId: ingestion.id, insertedCount: 0, updatedCount: 0, usageEventIds: [] };
    }

    let insertedCount = 0;
    let updatedCount = 0;
    const usageEventIds: string[] = [];

    for (const row of rows) {
      const created = await persistUsageEvent(tx, row, params.ingestedAt, logicVersion);
      usageEventIds.push(row.rowHash);
      if (created) insertedCount += 1;
      else updatedCount += 1;
      await linkToIngestion(tx, row.rowHash, ingestion.id);
    }

    return {
      ingestionId: ingestion.id,
      insertedCount,
      updatedCount,
      usageEventIds,
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