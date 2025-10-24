import { ingestUsagePayload } from './eventStore';

export async function insertUsageEventsFromNetworkJson(
  payload: unknown,
  capturedAt: Date,
  rawBlobId?: string | null,
) {
  const result = await ingestUsagePayload({ payload, capturedAt, rawBlobId: rawBlobId ?? null });
  return {
    inserted: result.insertedCount,
    updated: result.updatedCount,
    ingestionId: result.ingestionId,
    usageEventIds: result.usageEventIds,
  };
}


