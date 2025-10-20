import { mapNetworkJson, type NormalizedUsageEvent } from '@cursor-usage/ingest';
import { parseCursorUsageCsvBuffer, type CursorUsageCsv } from './csv';

export type CapturedItem = {
  url?: string;
  payload: Buffer;
  kind: 'html' | 'network_json';
};

export type CursorUsagePayload = {
  billing_period?: { start: string; end: string };
  rows: Array<{
    model: string;
    input_with_cache_write_tokens: number;
    input_without_cache_write_tokens: number;
    cache_read_tokens: number;
    output_tokens: number;
    total_tokens: number;
    api_cost: string;
    cost_to_you: string;
  }>;
};

export function fromCsv(parsed: CursorUsageCsv): CursorUsagePayload {
  const billing_period = parsed.billingPeriod ?? undefined;
  return {
    billing_period,
    rows: parsed.rows.map((row) => ({
      model: row.model,
      input_with_cache_write_tokens: row.input_with_cache_write_tokens,
      input_without_cache_write_tokens: row.input_without_cache_write_tokens,
      cache_read_tokens: row.cache_read_tokens,
      output_tokens: row.output_tokens,
      total_tokens: row.total_tokens,
      api_cost: row.api_cost,
      cost_to_you: row.cost_to_you,
    })),
  };
}

export function parseNetworkJsonPayload(buffer: Buffer): CursorUsagePayload | null {
  try {
    const text = buffer.toString('utf8');
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as CursorUsagePayload;
  } catch {
    return null;
  }
}

export function parseCapturedItem(item: CapturedItem): CursorUsagePayload | null {
  if (item.kind === 'network_json') {
    return parseNetworkJsonPayload(item.payload);
  }
  try {
    const parsedCsv = parseCursorUsageCsvBuffer(item.payload);
    return fromCsv(parsedCsv);
  } catch {
    return null;
  }
}

export function toNormalizedEvents(
  payload: CursorUsagePayload,
  capturedAt: Date,
  rawBlobId?: string | null,
): NormalizedUsageEvent[] {
  return mapNetworkJson(payload, capturedAt, rawBlobId ?? null);
}
