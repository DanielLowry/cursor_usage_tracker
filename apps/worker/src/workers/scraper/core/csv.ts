import { parse as parseCsv } from 'csv-parse/sync';

export type CsvUsageRow = {
  captured_at: Date;
  model: string;
  input_with_cache_write_tokens: number;
  input_without_cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  total_tokens: number;
  api_cost: string | null;
  cost_to_you: string | null;
};

export type CsvParseResult = {
  billingPeriod: { start: string; end: string } | null;
  rows: CsvUsageRow[];
};

function parseDate(value: string | undefined): Date {
  const d = value ? new Date(String(value)) : new Date(NaN);
  return d;
}

function coerceNumber(value: string | number | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.replace(/[,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeCurrency(value: unknown): string | null {
  if (value == null) return null;
  const str = String(value).trim();
  return str.length === 0 ? null : str;
}

function inferBillingPeriod(rows: Array<Record<string, string>>): { start: string; end: string } | null {
  if (rows.length === 0) return null;
  const iso = rows[0]['Date'];
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
  return { start, end };
}

export function parseUsageCsv(input: string | Buffer): CsvParseResult | null {
  const csvText = typeof input === 'string' ? input : input.toString('utf8');
  if (csvText.trim().length === 0) {
    return { billingPeriod: null, rows: [] };
  }

  try {
    const records: Array<Record<string, string>> = parseCsv(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    const billingPeriod = inferBillingPeriod(records);
    const rows: CsvUsageRow[] = records.map((row) => ({
      captured_at: parseDate(row['Date']),
      model: String(row['Model'] || row['model'] || '').trim(),
      input_with_cache_write_tokens: coerceNumber(row['Input (w/ Cache Write)'] ?? row['input_with_cache_write_tokens']),
      input_without_cache_write_tokens: coerceNumber(row['Input (w/o Cache Write)'] ?? row['input_without_cache_write_tokens']),
      cache_read_tokens: coerceNumber(row['Cache Read'] ?? row['cache_read_tokens']),
      output_tokens: coerceNumber(row['Output Tokens'] ?? row['output_tokens']),
      total_tokens: coerceNumber(row['Total Tokens'] ?? row['total_tokens']),
      api_cost: normalizeCurrency(
        row['Cost'] ?? row['cost'] ?? row['API Cost'] ?? row['Api Cost'] ?? row['api_cost'] ?? row['api_cost_raw'],
      ),
      cost_to_you: normalizeCurrency(row['Cost to you'] ?? row['cost_to_you'] ?? row['Cost to you (you)'] ?? row['cost_to_you_raw']),
    }));

    return { billingPeriod, rows };
  } catch (err) {
    return null;
  }
}
