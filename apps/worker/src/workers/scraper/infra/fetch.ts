// Relative path: apps/worker/src/workers/scraper/infra/fetch.ts
// Adapter that fetches Cursor usage CSV using a local auth state.
import { AuthSession } from '../../../../../../packages/shared/cursor-auth/src/AuthSession';
import {
  getAuthHeaders,
  readRawCookies,
  validateRawCookies,
  verifyAuthState,
} from '../../../../../../packages/shared/cursor-auth/src';
import { ScraperError, isScraperError } from '../errors';
import type { FetchPort, FetchResult, Logger } from '../ports';

/** Default Cursor usage CSV endpoint used by the adapter. */
export const DEFAULT_USAGE_EXPORT_URL =
  'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens';

export type CursorCsvFetchAdapterOptions = {
  stateDir: string;
  logger: Logger;
  targetUrl?: string;
};

/**
 * FetchPort implementation backed by Cursor auth state on disk. It verifies
 * auth state and then performs an authenticated HTTP GET to download the CSV.
 */
export class CursorCsvFetchAdapter implements FetchPort {
  private authSession: AuthSession | null = null;
  private readonly targetUrl: string;

  constructor(private readonly options: CursorCsvFetchAdapterOptions) {
    this.targetUrl = options.targetUrl ?? DEFAULT_USAGE_EXPORT_URL;
  }

  /** Lazily initializes and verifies the `AuthSession`. */
  private async ensureAuthSession(): Promise<AuthSession> {
    const { stateDir, logger } = this.options;

    try {
      await getAuthHeaders(stateDir);
    } catch (err) {
      logger.info('scraper.fetch.auth_headers_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const session = new AuthSession(stateDir);
    try {
      const preview = await session.preview();
      logger.info('scraper.fetch.auth_preview', { hash: preview.hash });
    } catch (err) {
      logger.info('scraper.fetch.auth_preview_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      const probe = await verifyAuthState(stateDir);
      if (!probe.proof?.ok) {
        const rawCookies = await readRawCookies(stateDir);
        const validation = await validateRawCookies(rawCookies);
        if (!validation.ok) {
          throw new ScraperError('VALIDATION_ERROR', 'cursor auth validation failed', {
            details: { status: validation.status, reason: validation.reason },
          });
        }
      }
    } catch (err) {
      if (isScraperError(err)) throw err;
      throw new ScraperError('IO_ERROR', 'failed verifying cursor auth state', {
        cause: err,
      });
    }

    this.authSession = session;
    return session;
  }

  /** Returns a cached auth session or initializes a new one. */
  private async getSession(): Promise<AuthSession> {
    if (this.authSession) return this.authSession;
    return this.ensureAuthSession();
  }

  /** Fetches the usage CSV as a Buffer or throws a `ScraperError` on failure. */
  async fetch(): Promise<FetchResult> {
    const session = await this.getSession();
    try {
      const headers = await session.toHttpHeaders(this.targetUrl);
      const response = await fetch(this.targetUrl, { method: 'GET', headers });
      if (response.status !== 200) {
        throw new ScraperError('FETCH_ERROR', 'cursor usage export returned unexpected status', {
          details: { status: response.status },
        });
      }
      const arrayBuf = await response.arrayBuffer();
      const recordHeaders: Record<string, unknown> = {};
      response.headers.forEach((value, key) => {
        recordHeaders[key.toLowerCase()] = value;
      });
      if (!recordHeaders['content-type']) {
        recordHeaders['content-type'] = 'text/csv';
      }
      return {
        bytes: Buffer.from(arrayBuf),
        headers: recordHeaders,
        sourceUrl: this.targetUrl,
      } satisfies FetchResult;
    } catch (err) {
      if (isScraperError(err)) throw err;
      throw new ScraperError('FETCH_ERROR', 'failed fetching cursor usage export', { cause: err });
    }
  }
}
