import { mapNetworkJson, type NormalizedUsageEvent } from '@cursor-usage/ingest';
import type { CsvParseResult, CsvUsageRow } from './csv';

export type NetworkPayload = {
  billing_period?: { start: string; end: string } | null;
  rows: Array<
    Pick<
      CsvUsageRow,
      | 'model'
      | 'input_with_cache_write_tokens'
      | 'input_without_cache_write_tokens'
      | 'cache_read_tokens'
      | 'output_tokens'
      | 'total_tokens'
      | 'api_cost'
      | 'cost_to_you'
    > & { kind?: string; max_mode?: string }
  >;
};

export function fromCsvParseResult(parsed: CsvParseResult | null): NetworkPayload | null {
  if (!parsed) return null;
  return {
    billing_period: parsed.billingPeriod ?? undefined,
    rows: parsed.rows.map((row) => ({
      model: row.model,
      input_with_cache_write_tokens: row.input_with_cache_write_tokens,
      input_without_cache_write_tokens: row.input_without_cache_write_tokens,
      cache_read_tokens: row.cache_read_tokens,
      output_tokens: row.output_tokens,
      total_tokens: row.total_tokens,
      api_cost: row.api_cost ?? undefined,
      cost_to_you: row.cost_to_you ?? undefined,
    })),
  };
}

export function normalizeNetworkPayload(
  payload: NetworkPayload | unknown,
  capturedAt: Date,
  rawBlobId?: string | null,
): NormalizedUsageEvent[] {
  return mapNetworkJson(payload, capturedAt, rawBlobId ?? null);
}

export function normalizeCsv(
  parsed: CsvParseResult | null,
  capturedAt: Date,
  rawBlobId?: string | null,
): NormalizedUsageEvent[] {
  const payload = fromCsvParseResult(parsed);
  if (!payload) return [];
  return normalizeNetworkPayload(payload, capturedAt, rawBlobId);
}
