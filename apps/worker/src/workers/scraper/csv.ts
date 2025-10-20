import { parse as parseCsv } from 'csv-parse/sync';

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

export function parseUsageCsv(csvText: string): UsageCsvCapture | null {
  try {
    const records: Array<Record<string, string>> = parseCsv(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (!Array.isArray(records) || records.length === 0) {
      return { billing_period: undefined, rows: [] };
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

    return { billing_period: period, rows };
  } catch (error) {
    return null;
  }
}

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
