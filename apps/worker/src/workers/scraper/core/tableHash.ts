import { stableHash } from '@cursor-usage/hash';
import type { NormalizedUsageEvent } from '@cursor-usage/ingest';

export type StableTableView = {
  billing_period: { start: string | null; end: string | null };
  rows: Array<{
    model: string;
    kind: string | null;
    max_mode: string | null | undefined;
    input_with_cache_write_tokens: number;
    input_without_cache_write_tokens: number;
    cache_read_tokens: number;
    output_tokens: number;
    total_tokens: number;
    api_cost_cents: number;
    api_cost_raw: string | null | undefined;
    cost_to_you_cents: number | null | undefined;
  }>;
};

export type TableHashResult = {
  tableHash: string;
  billingStart: Date | null;
  billingEnd: Date | null;
  totalRowsCount: number;
  stableView: StableTableView;
};

function toIsoDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().split('T')[0] ?? null;
}

export function buildStableTableView(events: NormalizedUsageEvent[]): StableTableView {
  if (events.length === 0) {
    return { billing_period: { start: null, end: null }, rows: [] };
  }

  const sorted = [...events].sort((a, b) => {
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    return a.total_tokens - b.total_tokens;
  });

  const first = sorted[0];
  return {
    billing_period: {
      start: toIsoDate(first.billing_period_start),
      end: toIsoDate(first.billing_period_end),
    },
    rows: sorted.map((event) => ({
      model: event.model,
      kind: event.kind ?? null,
      max_mode: event.max_mode ?? null,
      input_with_cache_write_tokens: event.input_with_cache_write_tokens,
      input_without_cache_write_tokens: event.input_without_cache_write_tokens,
      cache_read_tokens: event.cache_read_tokens,
      output_tokens: event.output_tokens,
      total_tokens: event.total_tokens,
      api_cost_cents: event.api_cost_cents,
      api_cost_raw: (event as any).api_cost_raw ?? null,
      cost_to_you_cents: (event as any).cost_to_you_cents ?? null,
    })),
  };
}

export function computeTableHash(events: NormalizedUsageEvent[]): TableHashResult {
  const view = buildStableTableView(events);
  const tableHash = stableHash(view);
  const first = events[0];
  return {
    tableHash,
    billingStart: first?.billing_period_start ?? null,
    billingEnd: first?.billing_period_end ?? null,
    totalRowsCount: events.length,
    stableView: view,
  };
}
