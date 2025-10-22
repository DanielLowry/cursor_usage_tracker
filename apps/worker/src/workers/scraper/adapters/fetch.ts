import { AuthSession } from '../../../../../packages/shared/cursor-auth/src/AuthSession';
import {
  getAuthHeaders,
  readRawCookies,
  validateRawCookies,
  verifyAuthState,
} from '../../../../../packages/shared/cursor-auth/src';

import { ScraperError } from '../errors';
import type { FetchPort, LoggerPort } from '../ports';

type CursorFetchAdapterOptions = {
  stateDir: string;
  logger: LoggerPort;
  targetUrl?: string;
};

const DEFAULT_USAGE_CSV_URL = 'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens';

export class CursorFetchAdapter implements FetchPort {
  private authSession: AuthSession | null = null;

  constructor(private readonly options: CursorFetchAdapterOptions) {}

  private get logger() {
    return this.options.logger;
  }

  private async ensureAuthSession(): Promise<AuthSession> {
    if (this.authSession) {
      return this.authSession;
    }

    const { stateDir } = this.options;

    try {
      await getAuthHeaders(stateDir);
    } catch (err) {
      this.logger.warn('scraper.auth.headers_failed', {
        error: err instanceof Error ? err.message : 'unknown',
      });
    }

    const authSession = new AuthSession(stateDir);

    try {
      const preview = await authSession.preview();
      this.logger.info('scraper.auth.preview', { hash: preview.hash });
    } catch (err) {
      this.logger.warn('scraper.auth.preview_failed', {
        error: err instanceof Error ? err.message : 'unknown',
      });
    }

    try {
      const result = await verifyAuthState(stateDir);
      if (!result.proof?.ok) {
        const rawCookies = await readRawCookies(stateDir);
        const proof = await validateRawCookies(rawCookies);
        if (!proof.ok) {
          throw new ScraperError('VALIDATION_ERROR', `auth probe failed: status=${proof.status} reason=${proof.reason}`);
        }
      }
    } catch (err) {
      if (err instanceof ScraperError) {
        throw err;
      }

      throw new ScraperError('VALIDATION_ERROR', 'failed to verify auth state', { cause: err });
    }

    this.authSession = authSession;
    return authSession;
  }

  async fetchUsageCsv(): Promise<Buffer> {
    const session = await this.ensureAuthSession();
    const url = this.options.targetUrl ?? DEFAULT_USAGE_CSV_URL;

    try {
      const headers = await session.toHttpHeaders(url);
      const res = await fetch(url, { method: 'GET', headers });
      if (!res.ok) {
        this.logger.warn('scraper.fetch.non_200', { status: res.status, url });
        throw new ScraperError('FETCH_ERROR', `csv fetch failed: status=${res.status}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      this.logger.info('scraper.fetch.success', { url, byteLength: arrayBuffer.byteLength });
      return Buffer.from(arrayBuffer);
    } catch (err) {
      if (err instanceof ScraperError) {
        throw err;
      }

      this.logger.error('scraper.fetch.error', {
        error: err instanceof Error ? err.message : 'unknown',
        url,
      });
      throw new ScraperError('IO_ERROR', 'failed to fetch usage CSV', { cause: err });
    }
  }
}
