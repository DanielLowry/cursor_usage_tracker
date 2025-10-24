import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseUsageCsv } from './core/csv';

describe('parseUsageCsv', () => {
  it('parses CSV fixtures into rows and billing period', () => {
    const csvPath = resolve(process.cwd(), 'tests/fixtures/dom/sample1.csv');
    const csvText = readFileSync(csvPath, 'utf8');

    const parsed = parseUsageCsv(csvText);

    expect(parsed).not.toBeNull();
    expect(parsed?.billing_period).toEqual({ start: '2025-02-01', end: '2025-02-28' });
    expect(parsed?.rows).toHaveLength(2);
    expect(parsed?.rows[0]).toMatchObject({
      model: 'gpt-4.1',
      total_tokens: 500,
      api_cost: '$0.50',
    });
  });
});
