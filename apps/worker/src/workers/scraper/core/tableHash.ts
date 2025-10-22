import { stableHash } from '@cursor-usage/hash';
import type { NormalizedUsageEvent } from '@cursor-usage/ingest';

export type StableViewSummary = {
  tableHash: string;
  billingStart: Date | null;
  billingEnd: Date | null;
  totalRowsCount: number;
};

function projectRow(event: NormalizedUsageEvent) {
  return {
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
    cost_to_you_cents: event.cost_to_you_cents,
    cost_to_you_raw: event.cost_to_you_raw ?? null,
  };
}

export function buildStableViewHash(normalizedEvents: NormalizedUsageEvent[]): StableViewSummary {
  const sortedEvents = [...normalizedEvents].sort((a, b) => {
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    return a.total_tokens - b.total_tokens;
  });

  const firstEvent = sortedEvents[0];
  const billingStart = firstEvent?.billing_period_start ?? null;
  const billingEnd = firstEvent?.billing_period_end ?? null;

  const billingPeriod = {
    start: billingStart ? billingStart.toISOString().split('T')[0] : null,
    end: billingEnd ? billingEnd.toISOString().split('T')[0] : null,
  };

  const rowsForHash = sortedEvents.map(projectRow);
  const tableHash = stableHash({ billing_period: billingPeriod, rows: rowsForHash });

  return {
    tableHash,
    billingStart,
    billingEnd,
    totalRowsCount: normalizedEvents.length,
  };
}
