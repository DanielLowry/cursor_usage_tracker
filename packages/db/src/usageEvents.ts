import prisma from './client';
import { mapNetworkJson, type NormalizedUsageEvent } from '@cursor-usage/ingest';

export async function insertUsageEventsFromNetworkJson(payload: unknown, capturedAt: Date, rawBlobId?: string | null) {
  const rows = mapNetworkJson(payload, capturedAt, rawBlobId);
  if (rows.length === 0) return { inserted: 0 };

  const client: any = prisma as any;
  await prisma.$transaction(
    rows.map((r: NormalizedUsageEvent) =>
      client.usageEvent.create({
        data: {
          captured_at: r.captured_at,
          model: r.model,
          kind: r.kind ?? undefined,
          max_mode: (r as any).max_mode ?? undefined,
          input_with_cache_write_tokens: r.input_with_cache_write_tokens,
          input_without_cache_write_tokens: r.input_without_cache_write_tokens,
          cache_read_tokens: r.cache_read_tokens,
          output_tokens: r.output_tokens,
          total_tokens: r.total_tokens,
          api_cost_cents: r.api_cost_cents,
          api_cost_raw: (r as any).api_cost_raw ?? undefined,
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


