// Relative path: apps/worker/src/workers/scraper/core/csv.ts
// CSV parsing utilities for Cursor usage exports. Converts the raw CSV text
// into a minimal structured shape that downstream normalization can consume.
import { parse as parseCsv } from 'csv-parse/sync';
import { USAGE_CSV_PARSE_OPTIONS } from '../lib/csv';

export type UsageCsvRow = {
  captured_at: Date;
  model: string;
  input_with_cache_write_tokens: number;
  input_without_cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  total_tokens: number;
  api_cost: string;
  cost_to_you: string;
};

export type UsageCsvCapture = {
  billing_period?: { start: string; end: string };
  rows: UsageCsvRow[];
};

/**
 * Parses the Cursor usage CSV export into a structured capture object.
 * Returns `null` if the CSV cannot be parsed.
 */
export function parseUsageCsv(csvText: string): UsageCsvCapture | null {
  try {
    const records: Array<Record<string, string>> = parseCsv(csvText, USAGE_CSV_PARSE_OPTIONS);

    if (!Array.isArray(records) || records.length === 0) {
      return { rows: [] };
    }

    const firstDateIso = records[0]?.['Date'];
    const period = firstDateIso ? computeBillingPeriod(firstDateIso) : undefined;

    const rows = records.map((record) => ({
      captured_at: new Date(String(record['Date'] ?? '')),
      model: String(record['Model'] ?? '').trim(),
      input_with_cache_write_tokens: Number(record['Input (w/ Cache Write)'] ?? 0),
      input_without_cache_write_tokens: Number(record['Input (w/o Cache Write)'] ?? 0),
      cache_read_tokens: Number(record['Cache Read'] ?? 0),
      output_tokens: Number(record['Output Tokens'] ?? 0),
      total_tokens: Number(record['Total Tokens'] ?? 0),
      api_cost: (record['Cost'] ?? record['API Cost'] ?? record['Api Cost'] ?? '') as string,
      cost_to_you: (record['Cost to you'] ?? record['Cost to you (you)'] ?? record['cost_to_you'] ?? '') as string,
    }));

    const capture: UsageCsvCapture = { rows };
    if (period) capture.billing_period = period;
    return capture;
  } catch (error) {
    return null;
  }
}

/**
 * Computes the billing period (UTC month) from a representative ISO date string.
 */
function computeBillingPeriod(isoDate: string): { start: string; end: string } | undefined {
  const reference = new Date(isoDate);
  if (Number.isNaN(reference.getTime())) return undefined;

  const start = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const end = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);

  return { start, end };
}
