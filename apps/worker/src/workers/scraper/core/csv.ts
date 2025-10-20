import { parse as parseCsv } from 'csv-parse/sync';

export type UsageCsvRow = {
  model: string;
  kind: string | null;
  max_mode: string | null;
  input_with_cache_write_tokens: number;
  input_without_cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  total_tokens: number;
  api_cost: string | null;
  cost_to_you: string | null;
};

export type UsageCsvPayload = {
  billing_period?: { start: string; end: string };
  rows: UsageCsvRow[];
};

function coerceNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function coerceString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s.length === 0 ? null : s;
}

function extractBillingPeriod(firstIso: string | undefined): { start: string; end: string } | undefined {
  if (!firstIso) return undefined;
  const parsed = new Date(firstIso);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const start = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}

export function parseUsageCsv(csvText: string): UsageCsvPayload {
  const records: Array<Record<string, unknown>> = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (!records.length) {
    return { rows: [] };
  }

  const billingPeriod = extractBillingPeriod((records[0]['Date'] ?? records[0]['date']) as string | undefined);

  const rows = records.map((record) => ({
    model: coerceString(record['Model'] ?? record['model']) ?? '',
    kind: coerceString(record['Kind'] ?? record['kind']),
    max_mode: coerceString(record['Max Mode'] ?? record['max_mode']),
    input_with_cache_write_tokens: coerceNumber(record['Input (w/ Cache Write)'] ?? record['input_with_cache_write_tokens']),
    input_without_cache_write_tokens: coerceNumber(record['Input (w/o Cache Write)'] ?? record['input_without_cache_write_tokens']),
    cache_read_tokens: coerceNumber(record['Cache Read'] ?? record['cache_read_tokens']),
    output_tokens: coerceNumber(record['Output Tokens'] ?? record['output_tokens']),
    total_tokens: coerceNumber(record['Total Tokens'] ?? record['total_tokens']),
    api_cost: coerceString(
      record['Cost'] ?? record['cost'] ?? record['API Cost'] ?? record['Api Cost'] ?? record['api_cost'],
    ),
    cost_to_you: coerceString(
      (record['Cost to you'] ?? record['cost_to_you'] ?? record['Cost to you (you)'] ?? record['costToYou']) as string,
    ),
  }));

  return { billing_period: billingPeriod, rows };
}
