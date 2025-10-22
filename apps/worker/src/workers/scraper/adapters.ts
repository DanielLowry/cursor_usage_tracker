import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import * as zlib from 'zlib';

import prisma from '../../../../../packages/db/src/client';
import { trimRawBlobs } from '../../../../../packages/db/src/retention';
import { createSnapshotWithDelta } from '../../../../../packages/db/src/snapshots';
import type { SnapshotResult } from '../../../../../packages/db/src/snapshots';
import type { NormalizedUsageEvent } from '@cursor-usage/ingest';
import { getAuthHeaders, readRawCookies, validateRawCookies, verifyAuthState } from '../../../../../packages/shared/cursor-auth/src';
import { AuthSession } from '../../../../../packages/shared/cursor-auth/src/AuthSession';

import { computeDeltaEvents } from './delta';
import { normalizeCapturedPayload } from './normalize';
import { buildStableViewHash as buildStableViewHashCore } from './tableHash';
import { parseUsageCsv } from './csv';
import type {
  BlobSaveParams,
  BlobSaveResult,
  BlobStorePort,
  CapturedBlob,
  ClockPort,
  FetchPort,
  Logger,
  SnapshotStorePort,
} from './ports';
import { ScraperError } from './ports';

function gzipBuffer(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gzip(input, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function resolveStateDir(requestedStateDir: string): string {
  const requestedStatePath = path.join(path.resolve(requestedStateDir), 'cursor.state.json');
  if (fs.existsSync(requestedStatePath)) {
    return path.resolve(requestedStateDir);
  }

  let repoRoot = process.cwd();
  let foundRoot = false;
  for (let i = 0; i < 100; i += 1) {
    const marker1 = path.join(repoRoot, 'pnpm-workspace.yaml');
    const marker2 = path.join(repoRoot, 'turbo.json');
    const marker3 = path.join(repoRoot, '.git');
    if (fs.existsSync(marker1) || fs.existsSync(marker2) || fs.existsSync(marker3)) {
      foundRoot = true;
      break;
    }
    const parent = path.dirname(repoRoot);
    if (parent === repoRoot) break;
    repoRoot = parent;
  }

  if (!foundRoot) repoRoot = process.cwd();
  const alternative = path.join(repoRoot, 'apps', 'web', 'data');
  const altStatePath = path.join(alternative, 'cursor.state.json');
  if (fs.existsSync(altStatePath)) return alternative;
  return requestedStateDir;
}

export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}

export class ConsoleLogger implements Logger {
  constructor(private readonly clock: ClockPort = new SystemClock()) {}

  private emit(level: 'info' | 'warn' | 'error' | 'debug', event: string, meta?: Record<string, unknown>) {
    const payload = {
      level,
      event,
      ts: this.clock.now().toISOString(),
      ...meta,
    };
    if (level === 'error') {
      console.error(payload);
    } else if (level === 'warn') {
      console.warn(payload);
    } else {
      console.log(payload);
    }
  }

  info(event: string, meta?: Record<string, unknown>) {
    this.emit('info', event, meta);
  }

  warn(event: string, meta?: Record<string, unknown>) {
    this.emit('warn', event, meta);
  }

  error(event: string, meta?: Record<string, unknown>) {
    this.emit('error', event, meta);
  }

  debug(event: string, meta?: Record<string, unknown>) {
    this.emit('debug', event, meta);
  }
}

export class CursorFetchAdapter implements FetchPort {
  private authSession: AuthSession | null = null;
  private readonly stateDir: string;

  constructor(private readonly options: { requestedStateDir: string; logger: Logger; fetchImpl?: typeof fetch }) {
    this.stateDir = resolveStateDir(options.requestedStateDir);
  }

  private async ensureAuthSession(): Promise<AuthSession> {
    if (this.authSession) return this.authSession;

    this.options.logger.info('fetch.auth.bootstrap', { stateDir: this.stateDir });
    await getAuthHeaders(this.stateDir);

    const authSession = new AuthSession(this.stateDir);
    try {
      const preview = await authSession.preview();
      this.options.logger.info('fetch.auth.preview', { hash: preview.hash });
    } catch (error) {
      this.options.logger.warn('fetch.auth.preview_failed', { error: (error as Error)?.message });
    }

    try {
      const result = await verifyAuthState(this.stateDir);
      if (!result.proof?.ok) {
        const rawCookies = await readRawCookies(this.stateDir);
        const proof = await validateRawCookies(rawCookies);
        if (!proof.ok) {
          throw new ScraperError('VALIDATION_ERROR', 'Cursor auth validation failed', {
            context: { status: proof.status, reason: proof.reason },
          });
        }
      }
    } catch (error) {
      if (error instanceof ScraperError) throw error;
      throw new ScraperError('VALIDATION_ERROR', 'Failed to verify auth state', { cause: error });
    }

    this.authSession = authSession;
    return authSession;
  }

  async fetchUsageCsv(): Promise<Buffer> {
    const authSession = await this.ensureAuthSession();
    const url = 'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens';
    this.options.logger.info('fetch.csv.start', { url });
    let response: Response;
    try {
      const headers = await authSession.toHttpHeaders(url);
      const impl = this.options.fetchImpl ?? fetch;
      response = await impl(url, { method: 'GET', headers });
    } catch (error) {
      throw new ScraperError('FETCH_ERROR', 'Failed to fetch usage CSV', { cause: error });
    }

    if (!response.ok) {
      throw new ScraperError('FETCH_ERROR', 'Usage CSV fetch returned non-200 status', {
        context: { status: response.status },
      });
    }

    try {
      const buffer = Buffer.from(await response.arrayBuffer());
      this.options.logger.info('fetch.csv.success', { bytes: buffer.byteLength });
      return buffer;
    } catch (error) {
      throw new ScraperError('IO_ERROR', 'Failed to read CSV response body', { cause: error });
    }
  }
}

export class PrismaBlobStore implements BlobStorePort {
  constructor(private readonly logger: Logger) {}

  async saveIfNew(params: BlobSaveParams): Promise<BlobSaveResult> {
    const { capture, capturedAt, metadata } = params;
    const contentHash = createHash('sha256').update(capture.payload).digest('hex');

    try {
      const existing = await prisma.rawBlob.findFirst({
        where: { content_hash: contentHash },
        select: { id: true },
      });
      if (existing) {
        this.logger.info('blob.duplicate', { contentHash, blobId: existing.id });
        return { status: 'duplicate', blobId: existing.id, contentHash };
      }
    } catch (error) {
      throw new ScraperError('IO_ERROR', 'Failed to check for existing raw blob', { cause: error });
    }

    let gz: Buffer;
    try {
      gz = await gzipBuffer(capture.payload);
    } catch (error) {
      throw new ScraperError('IO_ERROR', 'Failed to gzip payload for raw blob', { cause: error });
    }

    try {
      const created = await prisma.rawBlob.create({
        data: {
          captured_at: capturedAt,
          kind: capture.kind,
          url: capture.url,
          payload: gz,
          content_hash: contentHash,
          content_type: capture.kind === 'html' ? 'text/csv' : 'application/json',
          schema_version: 'v1',
          metadata: metadata ?? undefined,
        },
        select: { id: true },
      });
      this.logger.info('blob.saved', { contentHash, blobId: created.id, kind: capture.kind });
      return { status: 'saved', blobId: created.id, contentHash };
    } catch (error: any) {
      if (error?.code === 'P2002') {
        const existing = await prisma.rawBlob.findFirst({
          where: { content_hash: contentHash },
          select: { id: true },
        });
        if (existing) {
          this.logger.warn('blob.duplicate_race', { contentHash, blobId: existing.id });
          return { status: 'duplicate', blobId: existing.id, contentHash };
        }
      }
      throw new ScraperError('DB_CONFLICT', 'Failed to persist raw blob', { cause: error, context: { contentHash } });
    }
  }

  async enforceRetention(limit: number): Promise<void> {
    try {
      await trimRawBlobs(limit);
      this.logger.info('blob.retention.enforced', { limit });
    } catch (error) {
      throw new ScraperError('IO_ERROR', 'Failed to enforce raw blob retention', { cause: error, context: { limit } });
    }
  }
}

export class PrismaSnapshotStore implements SnapshotStorePort {
  constructor(private readonly logger: Logger) {}

  async findLatestCapture(params: {
    billingPeriodStart: Date | null;
    billingPeriodEnd: Date | null;
  }): Promise<Date | null> {
    const { billingPeriodStart, billingPeriodEnd } = params;
    if (!billingPeriodStart || !billingPeriodEnd) return null;
    try {
      const latestSnapshot = await prisma.snapshot.findFirst({
        where: {
          billing_period_start: billingPeriodStart,
          billing_period_end: billingPeriodEnd,
        },
        orderBy: { created_at: 'desc' },
        select: { captured_at: true },
      });
      if (latestSnapshot) {
        return latestSnapshot.captured_at as Date;
      }
    } catch (error) {
      this.logger.warn('snapshot.lookup.failed', {
        error: (error as Error)?.message,
        billingPeriodStart,
        billingPeriodEnd,
      });
    }
    return null;
  }

  async persistDelta(params: {
    billingPeriodStart: Date | null;
    billingPeriodEnd: Date | null;
    tableHash: string;
    totalRowsCount: number;
    capturedAt: Date;
    normalizedDeltaEvents: NormalizedUsageEvent[];
  }): Promise<SnapshotResult> {
    try {
      const result = await createSnapshotWithDelta(params);
      this.logger.info('snapshot.persisted', {
        tableHash: params.tableHash,
        deltaCount: params.normalizedDeltaEvents.length,
        wasNew: result.wasNew,
      });
      return result;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ScraperError('DB_CONFLICT', 'Snapshot unique constraint violated', {
          cause: error,
          context: { tableHash: params.tableHash },
        });
      }
      throw new ScraperError('IO_ERROR', 'Failed to persist snapshot delta', {
        cause: error,
        context: { tableHash: params.tableHash },
      });
    }
  }
}

export async function parseCapturedPayload(capture: CapturedBlob): Promise<unknown> {
  if (capture.kind === 'network_json') {
    try {
      return JSON.parse(capture.payload.toString('utf8'));
    } catch (error) {
      throw new ScraperError('VALIDATION_ERROR', 'Failed to parse network_json payload', { cause: error });
    }
  }

  if (capture.kind === 'html') {
    const csvText = capture.payload.toString('utf8');
    const parsed = parseUsageCsv(csvText);
    if (!parsed) {
      throw new ScraperError('CSV_PARSE_ERROR', 'Failed to parse usage CSV payload');
    }
    return parsed;
  }

  throw new ScraperError('VALIDATION_ERROR', 'Unsupported capture kind encountered', {
    context: { kind: capture.kind },
  });
}

export async function normalizeCapture(
  capture: CapturedBlob,
  capturedAt: Date,
  blobId: string | null,
): Promise<NormalizedUsageEvent[]> {
  const payload = await parseCapturedPayload(capture);
  return normalizeCapturedPayload(payload, capturedAt, blobId);
}

export function buildStableViewHash(events: NormalizedUsageEvent[]) {
  return buildStableViewHashCore(events);
}

export function computeDelta(events: NormalizedUsageEvent[], latestCapture: Date | null) {
  return computeDeltaEvents(events, latestCapture);
}
