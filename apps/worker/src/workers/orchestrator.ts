// Relative path: apps/worker/src/workers/orchestrator.ts
import { computeUsageEventRowHash } from './scraper/lib/rowHash';
import { computeSha256 } from './scraper/lib/contentHash';
import { parseUsageCsv } from './scraper/core/csv';
import { normalizeCapturedPayload } from './scraper/core/normalize';
import { ScraperError, isScraperError } from './scraper/errors';
import type {
  BlobStorePort,
  ClockPort,
  FetchPort,
  Logger,
  UsageEventStorePort,
  UsageEventWithRowHash,
} from './scraper/ports';

export type WeeklyBlobPolicyConfig = {
  mode: 'weekly';
  lastSavedAt?: Date | null;
  ingestionsSinceLastBlob?: number;
  maxIngestionsBeforeSave?: number;
};

export type AnomalyOnlyBlobPolicyConfig = {
  mode: 'anomaly_only';
};

export type BlobPolicyConfig = WeeklyBlobPolicyConfig | AnomalyOnlyBlobPolicyConfig;

export type RunIngestionOptions = {
  fetcher: FetchPort;
  eventStore: UsageEventStorePort;
  blobStore: BlobStorePort;
  clock: ClockPort;
  logger: Logger;
  source: string;
  blobPolicy: BlobPolicyConfig;
};

export type RunIngestionResult = {
  insertedCount: number;
  duplicateCount: number;
  savedBlob: boolean;
};

export type BlobDecision = {
  shouldSave: boolean;
  reason: string;
};

/**
 * Pure decision helper that determines whether to persist a blob given the
 * configured policy, current timestamp, and ingestion context.
 */
export function decideBlobSave(
  policy: BlobPolicyConfig,
  input: { now: Date; outcome: 'success' | 'failure'; },
): BlobDecision {
  if (policy.mode === 'anomaly_only') {
    if (input.outcome === 'failure') {
      return { shouldSave: true, reason: 'policy:anomaly:failure' };
    }
    return { shouldSave: false, reason: 'policy:anomaly:healthy' };
  }

  const lastSavedAt = policy.lastSavedAt ?? null;
  const ingestionsSinceLastBlob = policy.ingestionsSinceLastBlob ?? 0;
  const maxIngestions = policy.maxIngestionsBeforeSave ?? Number.POSITIVE_INFINITY;

  if (!lastSavedAt) {
    return { shouldSave: true, reason: 'policy:weekly:first_run' };
  }

  if (isoWeekKey(input.now) !== isoWeekKey(lastSavedAt)) {
    return { shouldSave: true, reason: 'policy:weekly:new_week' };
  }

  if (Number.isFinite(maxIngestions) && ingestionsSinceLastBlob >= maxIngestions) {
    return { shouldSave: true, reason: 'policy:weekly:interval' };
  }

  if (input.outcome === 'failure') {
    return { shouldSave: true, reason: 'policy:weekly:failure' };
  }

  return { shouldSave: false, reason: 'policy:weekly:skip' };
}

/**
 * Orchestrates a full ingestion pass using the provided ports. The function is
 * pure apart from the injected adapters and returns ingestion stats.
 */
export async function runIngestion(options: RunIngestionOptions): Promise<RunIngestionResult> {
  const { fetcher, eventStore, blobStore, clock, logger, source, blobPolicy } = options;
  const startedAt = Date.now();

  logger.info('scrape.start', { source, policy: blobPolicy.mode });

  try {
    const fetchResult = await fetcher.fetch();
    const headers = normalizeHeaders(fetchResult.headers);
    const bytes = fetchResult.bytes;
    const ingestedAt = clock.now();
    const contentHash = computeSha256(bytes);

    const csvText = bytes.toString('utf8');
    const parsed = parseUsageCsv(csvText);
    if (!parsed) {
      return await handleAnomaly({
        reason: new ScraperError('CSV_PARSE_ERROR', 'failed to parse usage csv'),
        context: {
          blobPolicy,
          blobStore,
          contentHash,
          eventStore,
          headers,
          logger,
          source,
          bytes,
          startedAt,
          ingestedAt,
          sourceUrl: fetchResult.sourceUrl ?? source,
        },
      });
    }

    let normalized;
    try {
      normalized = normalizeCapturedPayload(parsed, ingestedAt, null).map((event) => ({
        ...event,
        source,
      }));
    } catch (err) {
      const reason = err instanceof ScraperError
        ? err
        : new ScraperError('NORMALIZE_ERROR', 'failed to normalize usage payload', { cause: err });
      return await handleAnomaly({
        reason,
        context: {
          blobPolicy,
          blobStore,
          contentHash,
          eventStore,
          headers,
          logger,
          source,
          bytes,
          startedAt,
          ingestedAt,
          sourceUrl: fetchResult.sourceUrl ?? source,
        },
      });
    }

    const eventsWithHash: UsageEventWithRowHash[] = normalized.map((event) => ({
      ...event,
      rowHash: computeUsageEventRowHash(event),
    }));

    const ingestResult = await eventStore.ingest(eventsWithHash, {
      ingestedAt,
      source,
      contentHash,
      headers,
    });

    logger.info('events.upserted', {
      insertedCount: ingestResult.insertedCount,
      duplicateCount: ingestResult.duplicateCount,
    });

    let savedBlob = false;
    const blobDecision = decideBlobSave(blobPolicy, { now: ingestedAt, outcome: 'success' });
    if (blobDecision.shouldSave) {
      const blobResult = await blobStore.saveIfNew({
        bytes,
        meta: {
          source: fetchResult.sourceUrl ?? source,
          contentHash,
          ingestionId: ingestResult.ingestionId,
          headers,
          capturedAt: ingestedAt,
        },
      });
      savedBlob = blobResult.kind === 'saved';
    } else {
      logger.info('blob.skipped', { reason: blobDecision.reason, contentHash });
    }

    const durationMs = Date.now() - startedAt;
    logger.info('ingestion.done', {
      ingestionId: ingestResult.ingestionId,
      insertedCount: ingestResult.insertedCount,
      duplicateCount: ingestResult.duplicateCount,
      savedBlob,
      durationMs,
    });

    return {
      insertedCount: ingestResult.insertedCount,
      duplicateCount: ingestResult.duplicateCount,
      savedBlob,
    };
  } catch (err) {
    if (isScraperError(err)) {
      if (!(err as ScraperError & { __logged?: boolean }).__logged) {
        logger.error('scrape.error', { code: err.code, message: err.message, details: err.details });
      }
      throw err;
    }
    logger.error('scrape.error', { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

async function handleAnomaly(
  params: {
    reason: ScraperError;
    context: {
      blobPolicy: BlobPolicyConfig;
      blobStore: BlobStorePort;
      contentHash: string;
      eventStore: UsageEventStorePort;
      headers: Record<string, unknown>;
      logger: Logger;
      source: string;
      bytes: Buffer;
      startedAt: number;
      ingestedAt: Date;
      sourceUrl: string;
    };
  },
): Promise<never> {
  const { reason, context } = params;
  const { blobPolicy, blobStore, contentHash, eventStore, headers, logger, source, bytes, startedAt, ingestedAt, sourceUrl } =
    context;

  logger.error('scrape.error', { code: reason.code, message: reason.message, details: reason.details });
  (reason as ScraperError & { __logged?: boolean }).__logged = true;

  const failure = await eventStore.recordFailure({
    ingestedAt,
    source,
    contentHash,
    headers,
    error: { code: reason.code, message: reason.message },
  });

  let savedBlob = false;
  const blobDecision = decideBlobSave(blobPolicy, { now: ingestedAt, outcome: 'failure' });
  if (blobDecision.shouldSave) {
    const blobResult = await blobStore.saveIfNew({
      bytes,
      meta: {
        source: sourceUrl,
        contentHash,
        ingestionId: failure.ingestionId,
        headers,
        capturedAt: ingestedAt,
      },
    });
    savedBlob = blobResult.kind === 'saved';
  } else {
    logger.info('blob.skipped', { reason: blobDecision.reason, contentHash });
  }

  const durationMs = Date.now() - startedAt;
  logger.info('ingestion.done', {
    ingestionId: failure.ingestionId,
    insertedCount: 0,
    duplicateCount: 0,
    savedBlob,
    durationMs,
  });

  throw reason;
}

function normalizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    output[key.toLowerCase()] = value;
  }
  if (!output['content-type']) {
    output['content-type'] = 'text/csv';
  }
  return output;
}

function isoWeekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
