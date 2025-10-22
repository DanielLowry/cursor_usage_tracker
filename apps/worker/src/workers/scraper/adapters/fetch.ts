import { AuthSession } from '../../../../../../packages/shared/cursor-auth/src/AuthSession';
import {
  getAuthHeaders,
  readRawCookies,
  validateRawCookies,
  verifyAuthState,
} from '../../../../../../packages/shared/cursor-auth/src';
import { ScraperError, isScraperError } from '../errors';
import type { FetchPort, Logger } from '../ports';

export const DEFAULT_USAGE_EXPORT_URL =
  'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens';

export type CursorCsvFetchAdapterOptions = {
  stateDir: string;
  logger: Logger;
  targetUrl?: string;
};

export class CursorCsvFetchAdapter implements FetchPort {
  private authSession: AuthSession | null = null;
  private readonly targetUrl: string;

  constructor(private readonly options: CursorCsvFetchAdapterOptions) {
    this.targetUrl = options.targetUrl ?? DEFAULT_USAGE_EXPORT_URL;
  }

  private async ensureAuthSession(): Promise<AuthSession> {
    const { stateDir, logger } = this.options;

    try {
      await getAuthHeaders(stateDir);
    } catch (err) {
      logger.warn('scraper.fetch.auth_headers_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const session = new AuthSession(stateDir);
    try {
      const preview = await session.preview();
      logger.info('scraper.fetch.auth_preview', { hash: preview.hash });
    } catch (err) {
      logger.warn('scraper.fetch.auth_preview_failed', {
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

  private async getSession(): Promise<AuthSession> {
    if (this.authSession) return this.authSession;
    return this.ensureAuthSession();
  }

  async fetchCsvExport(): Promise<Buffer> {
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
      return Buffer.from(arrayBuf);
    } catch (err) {
      if (isScraperError(err)) throw err;
      throw new ScraperError('FETCH_ERROR', 'failed fetching cursor usage export', { cause: err });
    }
  }
}
