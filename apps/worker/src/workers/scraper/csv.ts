import { parse as parseCsv } from 'csv-parse/sync';

export type CursorUsageCsvRow = {
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

export type CursorUsageCsv = {
  billingPeriod: { start: string; end: string } | null;
  rows: CursorUsageCsvRow[];
};

const CSV_PARSE_OPTIONS = { columns: true, skip_empty_lines: true, trim: true } as const;

function toBillingPeriod(date: Date): { start: string; end: string } {
  const utcYear = date.getUTCFullYear();
  const utcMonth = date.getUTCMonth();
  const start = new Date(Date.UTC(utcYear, utcMonth, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(utcYear, utcMonth + 1, 0)).toISOString().slice(0, 10);
  return { start, end };
}

function coerceDate(value: unknown): Date {
  return new Date(String(value ?? ''));
}

function coerceNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function coerceString(value: unknown): string {
  return String(value ?? '').trim();
}

export function parseCursorUsageCsv(csvText: string): CursorUsageCsv {
  const records = parseCsv(csvText, CSV_PARSE_OPTIONS) as Array<Record<string, unknown>>;
  const rows: CursorUsageCsvRow[] = records.map((record) => ({
    captured_at: coerceDate(record['Date']),
    model: coerceString(record['Model']),
    input_with_cache_write_tokens: coerceNumber(record['Input (w/ Cache Write)']),
    input_without_cache_write_tokens: coerceNumber(record['Input (w/o Cache Write)']),
    cache_read_tokens: coerceNumber(record['Cache Read']),
    output_tokens: coerceNumber(record['Output Tokens']),
    total_tokens: coerceNumber(record['Total Tokens']),
    api_cost: coerceString(record['Cost'] ?? record['API Cost'] ?? record['Api Cost'] ?? record['cost']),
    cost_to_you: coerceString(record['Cost to you'] ?? record['cost_to_you'] ?? record['Cost to you (you)']),
  }));

  const billingPeriod = rows.length > 0 ? toBillingPeriod(rows[0].captured_at) : null;

  return { billingPeriod, rows };
}

export function parseCursorUsageCsvBuffer(buffer: Buffer): CursorUsageCsv {
  return parseCursorUsageCsv(buffer.toString('utf8'));
}
