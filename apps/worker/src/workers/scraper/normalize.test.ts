import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normalizeCapturedPayload } from './core/normalize';

describe('normalizeCapturedPayload', () => {
  it('normalizes fixture payload into usage events', () => {
    const payloadPath = resolve(process.cwd(), 'tests/fixtures/network/sample1.json');
    const expectedPath = resolve(process.cwd(), 'tests/fixtures/dom/sample1.normalized.json');
    const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
    const expectedRows = JSON.parse(readFileSync(expectedPath, 'utf8'));

    const capturedAt = new Date('2025-02-05T15:00:00Z');
    const events = normalizeCapturedPayload(payload, capturedAt, 'blob-123');

    expect(events).toHaveLength(expectedRows.length);
    expect(events.every((event) => event.raw_blob_id === 'blob-123')).toBe(true);
    expect(events.every((event) => event.captured_at.getTime() === capturedAt.getTime())).toBe(true);

    const projected = events.map((event) => ({
      model: event.model,
      input_with_cache_write_tokens: event.input_with_cache_write_tokens,
      input_without_cache_write_tokens: event.input_without_cache_write_tokens,
      cache_read_tokens: event.cache_read_tokens,
      output_tokens: event.output_tokens,
      total_tokens: event.total_tokens,
      api_cost_cents: event.api_cost_cents,
      cost_to_you_cents: event.cost_to_you_cents,
    }));

    expect(projected).toEqual(expectedRows);

    expect(events[0]?.billing_period_start?.toISOString()).toBe('2025-02-01T00:00:00.000Z');
    expect(events[0]?.billing_period_end?.toISOString()).toBe('2025-02-28T00:00:00.000Z');
  });
});
