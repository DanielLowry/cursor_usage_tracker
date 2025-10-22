export type ScraperErrorCode =
  | 'FETCH_ERROR'
  | 'CSV_PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'DB_CONFLICT'
  | 'IO_ERROR';

export type ScraperErrorOptions = {
  cause?: unknown;
  details?: Record<string, unknown>;
};

export class ScraperError extends Error {
  readonly code: ScraperErrorCode;
  readonly cause?: unknown;
  readonly details?: Record<string, unknown>;

  constructor(code: ScraperErrorCode, message: string, options: ScraperErrorOptions = {}) {
    super(message);
    this.name = 'ScraperError';
    this.code = code;
    this.cause = options.cause;
    this.details = options.details;
  }
}

export function isScraperError(err: unknown): err is ScraperError {
  return err instanceof ScraperError;
}
