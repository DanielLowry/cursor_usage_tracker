import { mapNetworkJson, type NormalizedUsageEvent } from '@cursor-usage/ingest';

export type NormalizablePayload = unknown;

export function normalizeCapturedPayload(
  payload: NormalizablePayload,
  capturedAt: Date,
  rawBlobId: string | null,
): NormalizedUsageEvent[] {
  return mapNetworkJson(payload, capturedAt, rawBlobId ?? null);
}
