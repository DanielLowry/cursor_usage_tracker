// Relative path: apps/worker/src/workers/scraper/tableHash.ts
// Builds a stable table hash from normalized events. The hash is insensitive
// to input ordering by sorting rows and hashing only relevant fields.
import { stableHash } from '@cursor-usage/hash';
import type { NormalizedUsageEvent } from '@cursor-usage/ingest';

export type TableHashResult = {
  tableHash: string;
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  totalRowsCount: number;
};

/**
 * Computes a deterministic hash representing the current usage table view and
 * extracts the billing period and counts for snapshot persistence.
 */
export function buildStableViewHash(normalizedEvents: NormalizedUsageEvent[]): TableHashResult {
  const sortedEvents = [...normalizedEvents].sort((a, b) => {
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    return a.total_tokens - b.total_tokens;
  });

  const firstEvent = sortedEvents[0];
  const billingPeriod = {
    start: firstEvent?.billing_period_start ? firstEvent.billing_period_start.toISOString().split('T')[0] : null,
    end: firstEvent?.billing_period_end ? firstEvent.billing_period_end.toISOString().split('T')[0] : null,
  };

  const rowsForHash = sortedEvents.map((event) => ({
    model: event.model,
    kind: event.kind,
    max_mode: event.max_mode ?? null,
    input_with_cache_write_tokens: event.input_with_cache_write_tokens,
    input_without_cache_write_tokens: event.input_without_cache_write_tokens,
    cache_read_tokens: event.cache_read_tokens,
    output_tokens: event.output_tokens,
    total_tokens: event.total_tokens,
    api_cost_cents: event.api_cost_cents,
    api_cost_raw: event.api_cost_raw ?? null,
    cost_to_you_cents: event.cost_to_you_cents ?? null,
  }));

  const stableView = { billing_period: billingPeriod, rows: rowsForHash };
  const tableHash = stableHash(stableView);

  return {
    tableHash,
    billingPeriodStart: firstEvent?.billing_period_start ?? null,
    billingPeriodEnd: firstEvent?.billing_period_end ?? null,
    totalRowsCount: normalizedEvents.length,
  };
}
