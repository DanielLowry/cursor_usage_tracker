import { describe, it, expect } from 'vitest';
import { stableHash } from '@cursor-usage/hash';
import { mapNetworkJson } from '@cursor-usage/ingest';

describe('snapshot change detection (unit tests)', () => {
  it('same data produces same hash', () => {
    const payload1 = {
      billing_period: { start: '2025-02-01', end: '2025-02-28' },
      rows: [
        { model: 'gpt-4.1', input_with_cache_write_tokens: 100, input_without_cache_write_tokens: 200, cache_read_tokens: 50, output_tokens: 150, total_tokens: 500, api_cost: '$0.50', cost_to_you: '$0.40' },
      ],
    };

    const payload2 = {
      billing_period: { start: '2025-02-01', end: '2025-02-28' },
      rows: [
        { model: 'gpt-4.1', input_with_cache_write_tokens: 100, input_without_cache_write_tokens: 200, cache_read_tokens: 50, output_tokens: 150, total_tokens: 500, api_cost: '$0.50', cost_to_you: '$0.40' },
      ],
    };

    const capturedAt = new Date('2025-02-15T10:00:00Z');
    
    const events1 = mapNetworkJson(payload1, capturedAt, null);
    const events2 = mapNetworkJson(payload2, capturedAt, null);

    // Build stable views
    const stableView1 = buildStableView(events1);
    const stableView2 = buildStableView(events2);

    const hash1 = stableHash(stableView1);
    const hash2 = stableHash(stableView2);

    expect(hash1).toBe(hash2);
  });

  it('different data produces different hash', () => {
    const payload1 = {
      billing_period: { start: '2025-02-01', end: '2025-02-28' },
      rows: [
        { model: 'gpt-4.1', input_with_cache_write_tokens: 100, input_without_cache_write_tokens: 200, cache_read_tokens: 50, output_tokens: 150, total_tokens: 500, api_cost: '$0.50', cost_to_you: '$0.40' },
      ],
    };

    const payload2 = {
      billing_period: { start: '2025-02-01', end: '2025-02-28' },
      rows: [
        { model: 'gpt-4.1', input_with_cache_write_tokens: 150, input_without_cache_write_tokens: 250, cache_read_tokens: 60, output_tokens: 160, total_tokens: 620, api_cost: '$0.60', cost_to_you: '$0.50' },
      ],
    };

    const capturedAt = new Date('2025-02-15T10:00:00Z');
    
    const events1 = mapNetworkJson(payload1, capturedAt, null);
    const events2 = mapNetworkJson(payload2, capturedAt, null);

    // Build stable views
    const stableView1 = buildStableView(events1);
    const stableView2 = buildStableView(events2);

    const hash1 = stableHash(stableView1);
    const hash2 = stableHash(stableView2);

    expect(hash1).not.toBe(hash2);
  });

  it('different billing periods produce different hashes', () => {
    const payload1 = {
      billing_period: { start: '2025-02-01', end: '2025-02-28' },
      rows: [
        { model: 'gpt-4.1', input_with_cache_write_tokens: 100, input_without_cache_write_tokens: 200, cache_read_tokens: 50, output_tokens: 150, total_tokens: 500, api_cost: '$0.50', cost_to_you: '$0.40' },
      ],
    };

    const payload2 = {
      billing_period: { start: '2025-03-01', end: '2025-03-31' },
      rows: [
        { model: 'gpt-4.1', input_with_cache_write_tokens: 100, input_without_cache_write_tokens: 200, cache_read_tokens: 50, output_tokens: 150, total_tokens: 500, api_cost: '$0.50', cost_to_you: '$0.40' },
      ],
    };

    const capturedAt = new Date('2025-02-15T10:00:00Z');
    
    const events1 = mapNetworkJson(payload1, capturedAt, null);
    const events2 = mapNetworkJson(payload2, capturedAt, null);

    // Build stable views
    const stableView1 = buildStableView(events1);
    const stableView2 = buildStableView(events2);

    const hash1 = stableHash(stableView1);
    const hash2 = stableHash(stableView2);

    expect(hash1).not.toBe(hash2);
  });

  it('row order does not affect hash', () => {
    const payload1 = {
      billing_period: { start: '2025-02-01', end: '2025-02-28' },
      rows: [
        { model: 'gpt-4.1', input_with_cache_write_tokens: 100, input_without_cache_write_tokens: 200, cache_read_tokens: 50, output_tokens: 150, total_tokens: 500, api_cost: '$0.50', cost_to_you: '$0.40' },
        { model: 'gpt-4.1-mini', input_with_cache_write_tokens: 10, input_without_cache_write_tokens: 20, cache_read_tokens: 5, output_tokens: 15, total_tokens: 50, api_cost: '$0.05', cost_to_you: '$0.04' },
      ],
    };

    const payload2 = {
      billing_period: { start: '2025-02-01', end: '2025-02-28' },
      rows: [
        { model: 'gpt-4.1-mini', input_with_cache_write_tokens: 10, input_without_cache_write_tokens: 20, cache_read_tokens: 5, output_tokens: 15, total_tokens: 50, api_cost: '$0.05', cost_to_you: '$0.04' },
        { model: 'gpt-4.1', input_with_cache_write_tokens: 100, input_without_cache_write_tokens: 200, cache_read_tokens: 50, output_tokens: 150, total_tokens: 500, api_cost: '$0.50', cost_to_you: '$0.40' },
      ],
    };

    const capturedAt = new Date('2025-02-15T10:00:00Z');
    
    const events1 = mapNetworkJson(payload1, capturedAt, null);
    const events2 = mapNetworkJson(payload2, capturedAt, null);

    // Build stable views
    const stableView1 = buildStableView(events1);
    const stableView2 = buildStableView(events2);

    const hash1 = stableHash(stableView1);
    const hash2 = stableHash(stableView2);

    expect(hash1).toBe(hash2);
  });
});

/**
 * Build a stable, sorted JSON view for snapshotting.
 * Includes billing period bounds in the hash input for uniqueness.
 */
function buildStableView(events: Array<{
  model: string;
  total_tokens: number;
  billing_period_start: Date | null;
  billing_period_end: Date | null;
  input_with_cache_write_tokens: number;
  input_without_cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  api_cost_cents: number;
  cost_to_you_cents: number;
}>): unknown {
  if (events.length === 0) {
    return { rows: [], billing_period: null };
  }

  // Sort events by model, then by total_tokens for deterministic ordering
  const sortedEvents = [...events].sort((a, b) => {
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    return a.total_tokens - b.total_tokens;
  });

  // Extract billing period from first event (all should have same period)
  const firstEvent = sortedEvents[0];
  const billingPeriod = {
    start: firstEvent.billing_period_start?.toISOString().split('T')[0] || null,
    end: firstEvent.billing_period_end?.toISOString().split('T')[0] || null,
  };

  // Build normalized rows for hashing
  const rows = sortedEvents.map((e) => ({
    model: e.model,
    input_with_cache_write_tokens: e.input_with_cache_write_tokens,
    input_without_cache_write_tokens: e.input_without_cache_write_tokens,
    cache_read_tokens: e.cache_read_tokens,
    output_tokens: e.output_tokens,
    total_tokens: e.total_tokens,
    api_cost_cents: e.api_cost_cents,
    cost_to_you_cents: e.cost_to_you_cents,
  }));

  return {
    billing_period: billingPeriod,
    rows,
  };
}
