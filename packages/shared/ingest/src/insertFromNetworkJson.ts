import prisma from '../../../db/src/client';
import { mapNetworkJson } from './mapNetworkJson';

export async function insertUsageEventsFromNetworkJson(payload: unknown, capturedAt: Date, rawBlobId?: string | null) {
  const rows = mapNetworkJson(payload, capturedAt, rawBlobId);
  if (rows.length === 0) return { inserted: 0 };

  // Use transaction for atomic insert
  await prisma.$transaction(
    rows.map((r) =>
      prisma.usageEvent.create({
        data: {
          captured_at: r.captured_at,
          model: r.model,
          input_with_cache_write_tokens: r.input_with_cache_write_tokens,
          input_without_cache_write_tokens: r.input_without_cache_write_tokens,
          cache_read_tokens: r.cache_read_tokens,
          output_tokens: r.output_tokens,
          total_tokens: r.total_tokens,
          api_cost_cents: r.api_cost_cents,
          cost_to_you_cents: r.cost_to_you_cents,
          billing_period_start: r.billing_period_start,
          billing_period_end: r.billing_period_end,
          source: 'network_json',
          raw_blob_id: r.raw_blob_id ?? undefined,
        },
      })
    )
  );

  return { inserted: rows.length };
}


