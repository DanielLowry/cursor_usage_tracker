import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseCursorUsageCsv, parseCursorUsageCsvBuffer } from './csv';

const fixturePath = path.join(__dirname, '__fixtures__', 'usage.csv');
const csvText = fs.readFileSync(fixturePath, 'utf8');

describe('csv parser', () => {
  it('parses csv text into rows and billing period', () => {
    const parsed = parseCursorUsageCsv(csvText);
    expect(parsed.billingPeriod).toEqual({ start: '2025-01-01', end: '2025-01-31' });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].model).toBe('gpt-4.1');
    expect(parsed.rows[0].total_tokens).toBe(270);
  });

  it('parses buffer form equivalently', () => {
    const parsed = parseCursorUsageCsvBuffer(Buffer.from(csvText, 'utf8'));
    expect(parsed.rows.map((row) => row.total_tokens)).toEqual([270, 260]);
  });
});
