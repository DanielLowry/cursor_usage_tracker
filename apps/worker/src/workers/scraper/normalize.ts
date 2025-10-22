// Relative path: apps/worker/src/workers/scraper/normalize.ts
// Normalization entrypoints translate parsed payloads into a canonical
// `NormalizedUsageEvent[]` understood by hashing and delta logic.
import { mapNetworkJson, type NormalizedUsageEvent } from '../../../../../packages/shared/ingest/src';

export type { NormalizedUsageEvent } from '../../../../../packages/shared/ingest/src';

export type NormalizablePayload = unknown;

/**
 * Normalizes an already-parsed payload from the Cursor usage export into
 * `NormalizedUsageEvent[]` using the shared ingest mapper.
 */
export function normalizeCapturedPayload(
  payload: NormalizablePayload,
  capturedAt: Date,
  rawBlobId: string | null,
): NormalizedUsageEvent[] {
  return mapNetworkJson(payload, capturedAt, rawBlobId ?? null);
}
