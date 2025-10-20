import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseUsageCsv } from './csv';
import { fromCsvParseResult, normalizeCsv, normalizeNetworkPayload } from './normalize';

function loadTextFixture(path: string): string {
  const url = new URL(`../../../../../../tests/fixtures/${path}`, import.meta.url);
  return readFileSync(url, 'utf8');
}

function loadJsonFixture<T>(path: string): T {
  return JSON.parse(loadTextFixture(path)) as T;
}

describe('normalize helpers', () => {
  it('converts parsed csv into network payload shape', () => {
    const csvText = loadTextFixture('csv/sample1.csv');
    const parsed = parseUsageCsv(csvText);
    const payload = fromCsvParseResult(parsed);
    expect(payload?.billing_period).toEqual({ start: '2025-02-01', end: '2025-02-28' });
    expect(payload?.rows[0]).toMatchObject({
      model: 'gpt-4.1',
      input_with_cache_write_tokens: 100,
      cost_to_you: '$0.40',
    });
  });

  it('normalizes network fixture payload into usage events', () => {
    const networkPayload = loadJsonFixture<Record<string, unknown>>('network/sample1.json');
    const capturedAt = new Date('2025-02-28T00:00:00Z');
    const events = normalizeNetworkPayload(networkPayload, capturedAt, 'blob-123');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      model: 'gpt-4.1',
      api_cost_cents: 50,
      cost_to_you_cents: 40,
      raw_blob_id: 'blob-123',
      captured_at: capturedAt,
    });
  });

  it('normalizes csv fixture via mapNetworkJson', () => {
    const csvText = loadTextFixture('csv/sample1.csv');
    const parsed = parseUsageCsv(csvText);
    const capturedAt = new Date('2025-02-20T00:00:00Z');
    const events = normalizeCsv(parsed, capturedAt, null);
    expect(events).toHaveLength(2);
    expect(
      events.map((e) => ({
        model: e.model,
        input_with_cache_write_tokens: e.input_with_cache_write_tokens,
        input_without_cache_write_tokens: e.input_without_cache_write_tokens,
        cache_read_tokens: e.cache_read_tokens,
        output_tokens: e.output_tokens,
        total_tokens: e.total_tokens,
        api_cost_cents: e.api_cost_cents,
        cost_to_you_cents: e.cost_to_you_cents,
      })),
    ).toEqual(
      loadJsonFixture<
        Array<{
          model: string;
          input_with_cache_write_tokens: number;
          input_without_cache_write_tokens: number;
          cache_read_tokens: number;
          output_tokens: number;
          total_tokens: number;
          api_cost_cents: number;
          cost_to_you_cents: number;
        }>
      >('dom/sample1.normalized.json'),
    );
  });
});
