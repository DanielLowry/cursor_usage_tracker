import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseUsageCsv } from './csv';

function loadFixture(name: string): string {
  const url = new URL(`../../../../../../tests/fixtures/csv/${name}`, import.meta.url);
  return readFileSync(url, 'utf8');
}

describe('parseUsageCsv', () => {
  it('parses csv fixture into normalized rows and billing period', () => {
    const csvText = loadFixture('sample1.csv');
    const parsed = parseUsageCsv(csvText);
    expect(parsed).not.toBeNull();
    expect(parsed?.billingPeriod).toEqual({ start: '2025-02-01', end: '2025-02-28' });
    expect(parsed?.rows.length).toBe(2);
    expect(parsed?.rows[0]).toMatchObject({
      model: 'gpt-4.1',
      input_with_cache_write_tokens: 100,
      output_tokens: 150,
      api_cost: '$0.50',
    });
  });

  it('returns empty result for blank csv payloads', () => {
    const parsed = parseUsageCsv('');
    expect(parsed).toEqual({ billingPeriod: null, rows: [] });
  });
});
