import { stableHash } from '@cursor-usage/hash';
import type { NormalizedUsageEvent } from '@cursor-usage/ingest';

type RowProjection = Pick<
  NormalizedUsageEvent,
  |
    'model'
  |
    'kind'
  |
    'max_mode'
  |
    'input_with_cache_write_tokens'
  |
    'input_without_cache_write_tokens'
  |
    'cache_read_tokens'
  |
    'output_tokens'
  |
    'total_tokens'
  |
    'api_cost_cents'
  |
    'api_cost_raw'
  |
    'cost_to_you_cents'
> & { cost_to_you_raw?: string | null };

export type StableViewResult = {
  tableHash: string;
  billingPeriodStart: Date | null;
  billingPeriodEnd: Date | null;
  totalRowsCount: number;
};

function projectRow(event: NormalizedUsageEvent): RowProjection {
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

export function buildStableViewHash(events: NormalizedUsageEvent[]): StableViewResult {
  const sorted = [...events].sort((a, b) => {
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    if (a.total_tokens !== b.total_tokens) return a.total_tokens - b.total_tokens;
    return a.api_cost_cents - b.api_cost_cents;
  });

  const first = sorted[0];
  const stableView = {
    billing_period: {
      start: first?.billing_period_start ? first.billing_period_start.toISOString().slice(0, 10) : null,
      end: first?.billing_period_end ? first.billing_period_end.toISOString().slice(0, 10) : null,
    },
    rows: sorted.map(projectRow),
  };

  return {
    tableHash: stableHash(stableView),
    billingPeriodStart: first?.billing_period_start ?? null,
    billingPeriodEnd: first?.billing_period_end ?? null,
    totalRowsCount: events.length,
  };
}
