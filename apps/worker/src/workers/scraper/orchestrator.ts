import { ZodError } from 'zod';

import { mapNetworkJson } from '@cursor-usage/ingest';

import { computeDeltaEvents } from './core/delta';
import { parseCapturedPayload, type CapturedPayload } from './core/normalize';
import { buildStableViewHash } from './core/tableHash';
import { ScraperError } from './errors';
import type {
  BlobStorePort,
  ClockPort,
  FetchPort,
  LoggerPort,
  SnapshotStorePort,
} from './ports';

export type ScraperResult = {
  savedBlob: boolean;
};

export type ScraperDependencies = {
  fetchPort: FetchPort;
  blobStore: BlobStorePort;
  snapshotStore: SnapshotStorePort;
  clock: ClockPort;
  logger: LoggerPort;
  retentionCount: number;
  usageCsvUrl: string;
};

export class ScraperOrchestrator {
  constructor(private readonly deps: ScraperDependencies) {}

  async run(): Promise<ScraperResult> {
    const { fetchPort, blobStore, snapshotStore, clock, logger, retentionCount, usageCsvUrl } = this.deps;
    const capturedAt = clock.now();

    const csvBuffer = await fetchPort.fetchUsageCsv();

    const blobResult = await blobStore.saveIfNew({
      payload: csvBuffer,
      kind: 'html',
      capturedAt,
      url: usageCsvUrl,
      retentionCount,
    });

    if (blobResult.status === 'duplicate') {
      logger.info('scraper.run.duplicate_blob', { blobId: blobResult.blobId });
      return { savedBlob: false };
    }

    const capturedPayload: CapturedPayload = { kind: 'html', payload: csvBuffer, url: usageCsvUrl };
    const parsed = parseCapturedPayload(capturedPayload);

    if (!parsed || typeof parsed !== 'object') {
      throw new ScraperError('CSV_PARSE_ERROR', 'failed to parse usage CSV payload');
    }

    let normalizedEvents;
    try {
      normalizedEvents = mapNetworkJson(parsed, capturedAt, blobResult.blobId);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ScraperError('VALIDATION_ERROR', 'usage payload failed validation', { cause: err });
      }
      throw new ScraperError('CSV_PARSE_ERROR', 'failed to normalize usage payload', { cause: err });
    }

    const summary = buildStableViewHash(normalizedEvents);

    const latestCapture = await snapshotStore.findLatestCapture({
      start: summary.billingStart,
      end: summary.billingEnd,
    });

    const deltaEvents = computeDeltaEvents(normalizedEvents, latestCapture);

    if (deltaEvents.length === 0) {
      logger.info('scraper.run.no_delta', {
        tableHash: summary.tableHash,
        billingStart: summary.billingStart?.toISOString() ?? null,
        billingEnd: summary.billingEnd?.toISOString() ?? null,
      });
      return { savedBlob: true };
    }

    await snapshotStore.persistDelta({
      tableHash: summary.tableHash,
      totalRowsCount: summary.totalRowsCount,
      billingPeriodStart: summary.billingStart,
      billingPeriodEnd: summary.billingEnd,
      capturedAt,
      normalizedDeltaEvents: deltaEvents,
    });

    logger.info('scraper.run.completed', {
      tableHash: summary.tableHash,
      deltaCount: deltaEvents.length,
    });

    return { savedBlob: true };
  }
}
