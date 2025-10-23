import { Prisma } from '@prisma/client';
import prisma from './client';
import { stableHash } from '@cursor-usage/hash';
import {
  mapNetworkJson,
  type NormalizedUsageEvent,
  computeUsageEventRowHash,
} from '@cursor-usage/ingest';

export type SnapshotPersistParams = {
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  tableHash: string;
  totalRowsCount: number;
  capturedAt: Date;
  normalizedDeltaEvents: NormalizedUsageEvent[];
  rawBlobId?: string | null;
  contentHash?: string | null;
  headers?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  logicVersion?: number | null;
};

export type SnapshotResult = {
  snapshotId: string | null;
  wasNew: boolean;
  usageEventIds: string[];
  ingestionId: string | null;
  insertedCount: number;
  updatedCount: number;
};

type IngestNormalizedParams = {
  normalizedEvents: NormalizedUsageEvent[];
  capturedAt: Date;
  rawBlobId?: string | null;
  contentHash?: string | null;
  headers?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  logicVersion?: number | null;
  source?: string | null;
};

function jsonValue(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  if (value == null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

async function ensureIngestion(
  tx: Prisma.TransactionClient,
  params: {
    source: string;
    ingestedAt: Date;
    contentHash?: string | null;
    headers?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    status: string;
    rawBlobId?: string | null;
  },
) {
  try {
    return await tx.ingestion.create({
      data: {
        source: params.source,
        ingested_at: params.ingestedAt,
        content_hash: params.contentHash ?? null,
        headers: jsonValue(params.headers ?? null),
        metadata: jsonValue(params.metadata ?? null),
        status: params.status,
        raw_blob_id: params.rawBlobId ?? null,
      },
    });
  } catch (err) {
    if (
      params.contentHash &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
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

async function upsertUsageEvent(
  tx: Prisma.TransactionClient,
  event: NormalizedUsageEvent,
  rowHash: string,
  ingestedAt: Date,
  logicVersion: number,
): Promise<{ created: boolean }> {
  const existing = await tx.usageEvent.findUnique({ where: { row_hash: rowHash } });
  if (existing) {
    await tx.usageEvent.update({
      where: { row_hash: rowHash },
      data: {
        last_seen_at: ingestedAt,
      },
    });
    return { created: false };
  }

  await tx.usageEvent.create({
    data: {
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
    },
  });

  return { created: true };
}

async function linkEventToIngestion(
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

async function ingestNormalizedEventsInternal(
  params: IngestNormalizedParams,
): Promise<{ ingestionId: string | null; insertedCount: number; updatedCount: number; usageEventIds: string[] }> {
  const logicVersion = params.logicVersion ?? 1;
  const source = params.source ?? params.normalizedEvents[0]?.source ?? 'unknown';

  return prisma.$transaction(async (tx) => {
    const ingestion = await ensureIngestion(tx, {
      source,
      ingestedAt: params.capturedAt,
      contentHash: params.contentHash ?? null,
      headers: params.headers ?? null,
      metadata: params.metadata ?? null,
      status: 'completed',
      rawBlobId: params.rawBlobId ?? null,
    });

    if (params.normalizedEvents.length === 0) {
      return { ingestionId: ingestion.id, insertedCount: 0, updatedCount: 0, usageEventIds: [] };
    }

    const usageEventIds: string[] = [];
    let insertedCount = 0;
    let updatedCount = 0;

    for (const event of params.normalizedEvents) {
      const rowHash = computeUsageEventRowHash(event, logicVersion);
      const { created } = await upsertUsageEvent(tx, event, rowHash, params.capturedAt, logicVersion);
      if (created) insertedCount += 1;
      else updatedCount += 1;
      usageEventIds.push(rowHash);
      await linkEventToIngestion(tx, rowHash, ingestion.id);
    }

    return { ingestionId: ingestion.id, insertedCount, updatedCount, usageEventIds };
  });
}

export async function ingestUsagePayload(params: {
  payload: unknown;
  capturedAt: Date;
  rawBlobId?: string | null;
  contentHash?: string | null;
  headers?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  logicVersion?: number | null;
}) {
  const normalizedEvents = mapNetworkJson(params.payload, params.capturedAt, params.rawBlobId ?? null);
  const logicVersion = params.logicVersion ?? 1;

  const baseMetadata = {
    ...(params.metadata ?? {}),
    table_hash: stableHash(
      normalizedEvents.map((event) => computeUsageEventRowHash(event, logicVersion)),
    ),
    total_rows_count: normalizedEvents.length,
  } satisfies Record<string, unknown>;

  const result = await ingestNormalizedEventsInternal({
    normalizedEvents,
    capturedAt: params.capturedAt,
    rawBlobId: params.rawBlobId ?? null,
    contentHash: params.contentHash ?? null,
    headers: params.headers ?? null,
    metadata: baseMetadata,
    logicVersion,
    source: normalizedEvents[0]?.source ?? 'unknown',
  });

  return {
    ingestionId: result.ingestionId,
    insertedCount: result.insertedCount,
    updatedCount: result.updatedCount,
    usageEventIds: result.usageEventIds,
    wasNew: result.insertedCount > 0,
  };
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

export async function ingestNormalizedUsageEvents(
  params: IngestNormalizedUsageEventsParams,
): Promise<{
  ingestionId: string | null;
  insertedCount: number;
  updatedCount: number;
  usageEventIds: string[];
}> {
  const logicVersion = params.logicVersion ?? 1;
  const result = await ingestNormalizedEventsInternal({
    normalizedEvents: params.normalizedEvents,
    capturedAt: params.ingestedAt,
    rawBlobId: params.rawBlobId ?? null,
    contentHash: params.contentHash ?? null,
    headers: params.headers ?? null,
    metadata: params.metadata ?? null,
    logicVersion,
    source: params.source ?? params.normalizedEvents[0]?.source ?? 'unknown',
  });

  return {
    ingestionId: result.ingestionId,
    insertedCount: result.insertedCount,
    updatedCount: result.updatedCount,
    usageEventIds: result.usageEventIds,
  };
}

export async function createSnapshotWithDelta(params: SnapshotPersistParams): Promise<SnapshotResult> {
  if (params.normalizedDeltaEvents.length === 0) {
    const ingestion = await ingestNormalizedEventsInternal({
      normalizedEvents: [],
      capturedAt: params.capturedAt,
      rawBlobId: params.rawBlobId ?? null,
      contentHash: params.contentHash ?? null,
      headers: params.headers ?? null,
      metadata: {
        ...(params.metadata ?? {}),
        billing_period_start: params.billingPeriodStart?.toISOString() ?? null,
        billing_period_end: params.billingPeriodEnd?.toISOString() ?? null,
        table_hash: params.tableHash,
        total_rows_count: params.totalRowsCount,
        delta_rows_count: 0,
      },
      logicVersion: params.logicVersion ?? null,
      source: 'unknown',
    });

    return {
      snapshotId: null,
      wasNew: false,
      usageEventIds: [],
      ingestionId: ingestion.ingestionId,
      insertedCount: 0,
      updatedCount: 0,
    };
  }

  const metadata = {
    ...(params.metadata ?? {}),
    billing_period_start: params.billingPeriodStart?.toISOString() ?? null,
    billing_period_end: params.billingPeriodEnd?.toISOString() ?? null,
    table_hash: params.tableHash,
    total_rows_count: params.totalRowsCount,
    delta_rows_count: params.normalizedDeltaEvents.length,
  } satisfies Record<string, unknown>;

  const result = await ingestNormalizedEventsInternal({
    normalizedEvents: params.normalizedDeltaEvents,
    capturedAt: params.capturedAt,
    rawBlobId: params.rawBlobId ?? null,
    contentHash: params.contentHash ?? null,
    headers: params.headers ?? null,
    metadata,
    logicVersion: params.logicVersion ?? null,
    source: params.normalizedDeltaEvents[0]?.source ?? 'unknown',
  });

  return {
    snapshotId: null,
    wasNew: result.insertedCount > 0,
    usageEventIds: result.usageEventIds,
    ingestionId: result.ingestionId,
    insertedCount: result.insertedCount,
    updatedCount: result.updatedCount,
  };
}