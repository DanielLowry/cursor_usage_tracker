import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseUsageCsv } from '../csv';

describe('parseUsageCsv', () => {
  const fixturePath = resolve(__dirname, '../../../../../../../tests/fixtures/csv/sample1.csv');
  const csvText = readFileSync(fixturePath, 'utf8');

  it('parses csv rows and derives billing period bounds', () => {
    const parsed = parseUsageCsv(csvText);

    expect(parsed.billing_period).toEqual({ start: '2025-02-01', end: '2025-02-28' });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      model: 'gpt-4.1',
      kind: 'chat',
      max_mode: 'default',
      input_with_cache_write_tokens: 100,
      input_without_cache_write_tokens: 200,
      cache_read_tokens: 50,
      output_tokens: 150,
      total_tokens: 500,
      api_cost: '$0.50',
      cost_to_you: '$0.40',
    });
  });

  it('returns empty rows when csv has no records', () => {
    const parsed = parseUsageCsv('Date,Model\n');

    expect(parsed.rows).toEqual([]);
    expect(parsed.billing_period).toBeUndefined();
  });
});
