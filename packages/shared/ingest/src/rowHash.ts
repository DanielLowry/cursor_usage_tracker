// Relative path: packages/shared/ingest/src/rowHash.ts
// Utilities for deriving deterministic row hashes from normalized usage events.
import { stableHash } from '../../hash/src';
import type { NormalizedUsageEvent } from './mapNetworkJson';

/**
 * Computes the deterministic `row_hash` for a normalized usage event.
 * The hash includes the logic version and all business-significant fields
 * to ensure idempotent upserts across ingestions.
 */
export function computeUsageEventRowHash(event: NormalizedUsageEvent, logicVersion: number): string {
  return stableHash({
    logic_version: logicVersion,
    captured_at: event.captured_at.toISOString(),
    model: event.model,
    kind: event.kind ?? null,
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
    billing_period_start: event.billing_period_start?.toISOString() ?? null,
    billing_period_end: event.billing_period_end?.toISOString() ?? null,
    source: event.source,
  });
}
