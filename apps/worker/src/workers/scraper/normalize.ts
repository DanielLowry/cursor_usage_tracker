import { mapNetworkJson, type NormalizedUsageEvent } from '../../../../../packages/shared/ingest/src';

export type { NormalizedUsageEvent } from '../../../../../packages/shared/ingest/src';

export type NormalizablePayload = unknown;

export function normalizeCapturedPayload(
  payload: NormalizablePayload,
  capturedAt: Date,
  rawBlobId: string | null,
): NormalizedUsageEvent[] {
  return mapNetworkJson(payload, capturedAt, rawBlobId ?? null);
}
