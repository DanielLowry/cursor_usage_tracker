export type ScraperErrorCode =
  | 'FETCH_ERROR'
  | 'CSV_PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'DB_CONFLICT'
  | 'IO_ERROR';

export class ScraperError extends Error {
  readonly code: ScraperErrorCode;

  constructor(code: ScraperErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.code = code;
    this.name = 'ScraperError';
    if (options?.cause !== undefined) {
      // Attach cause in a backwards-compatible way for Node < 16.9 (optional chaining keeps TS satisfied).
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isScraperError(err: unknown): err is ScraperError {
  return err instanceof ScraperError;
}
