// Relative path: apps/worker/src/workers/scraper/errors.ts
// Domain error types for the scraper. Used across adapters and orchestrator
// to classify failures for logging and control flow.
export type ScraperErrorCode =
  | 'FETCH_ERROR'
  | 'CSV_PARSE_ERROR'
  | 'VALIDATION_ERROR'
  | 'NORMALIZE_ERROR'
  | 'DB_CONFLICT'
  | 'IO_ERROR';

export type ScraperErrorOptions = {
  cause?: unknown;
  details?: Record<string, unknown>;
};

/**
 * ScraperError enriches Error with a `code`, optional `cause`, and `details`
 * map so callers can reliably branch on error category and include context.
 */
export class ScraperError extends Error {
  readonly code: ScraperErrorCode;
  readonly cause?: unknown;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ScraperErrorCode, message: string, options: ScraperErrorOptions = {}) {
    super(message);
    this.name = 'ScraperError';
    this.code = code;
    this.cause = options.cause;
    this.details = options.details ?? undefined;
  }
}

/** Type guard for ScraperError */
export function isScraperError(err: unknown): err is ScraperError {
  return err instanceof ScraperError;
}
