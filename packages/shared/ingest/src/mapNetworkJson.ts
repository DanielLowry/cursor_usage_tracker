// Relative path: packages/shared/ingest/src/mapNetworkJson.ts

import { z } from 'zod';
import { parseCurrencyToCents, parseIntSafe, toUtcMidnight } from '@cursor-usage/normalize';

// Minimal schema for incoming network JSON rows; adapt as real payload evolves
const usageRowSchema = z.object({
  // CSV columns: Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
  model: z.string(),
  kind: z.string().optional(),
  max_mode: z.string().optional(),
  input_with_cache_write_tokens: z.number().int().nonnegative().optional(),
  input_without_cache_write_tokens: z.number().int().nonnegative().optional(),
  cache_read_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
  api_cost: z.union([z.string(), z.number()]).optional(),
  cost_to_you: z.union([z.string(), z.number()]).optional(),
});

const payloadSchema = z.object({
  rows: z.array(usageRowSchema),
  billing_period: z.object({ start: z.string(), end: z.string() }).optional(),
});

export type NormalizedUsageEvent = {
  captured_at: Date;
  kind: string | null;
  model: string;
  max_mode?: string | null;
  input_with_cache_write_tokens: number;
  input_without_cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  total_tokens: number;
  api_cost_cents: number;
  api_cost_raw?: string | null;
  cost_to_you_cents: number;
  cost_to_you_raw?: string | null;
  billing_period_start: Date | null;
  billing_period_end: Date | null;
  source: 'network_json';
  raw_blob_id?: string | null;
};

export function mapNetworkJson(raw: unknown, capturedAt: Date, rawBlobId?: string | null): NormalizedUsageEvent[] {
  const parsed = payloadSchema.parse(raw);
  const start = parsed.billing_period?.start ? toUtcMidnight(parsed.billing_period.start) : null;
  const end = parsed.billing_period?.end ? toUtcMidnight(parsed.billing_period.end) : null;

  return parsed.rows.map((r: z.infer<typeof usageRowSchema>) => {
    const inputWithCache = r.input_with_cache_write_tokens ?? 0;
    const inputWithoutCache = r.input_without_cache_write_tokens ?? 0;
    const cacheRead = r.cache_read_tokens ?? 0;
    const output = r.output_tokens ?? 0;
    const total = r.total_tokens ?? inputWithCache + inputWithoutCache + cacheRead + output;
    const apiRaw = r.api_cost ?? '';
    const apiCents = parseCurrencyToCents(apiRaw ?? 0);
    const costToYouRaw = (r as any).cost_to_you ?? (r as any).cost_to_you ?? '';
    const costToYouCents = parseCurrencyToCents(costToYouRaw ?? 0);

    return {
      captured_at: new Date(capturedAt),
      kind: (r as any).Kind || (r as any).kind || null,
      model: r.model,
      max_mode: (r as any)['Max Mode'] || (r as any).max_mode || null,
      input_with_cache_write_tokens: parseIntSafe(inputWithCache),
      input_without_cache_write_tokens: parseIntSafe(inputWithoutCache),
      cache_read_tokens: parseIntSafe(cacheRead),
      output_tokens: parseIntSafe(output),
      total_tokens: parseIntSafe(total),
      api_cost_cents: apiCents,
      api_cost_raw: String(apiRaw ?? '') || null,
      cost_to_you_cents: costToYouCents,
      cost_to_you_raw: String(costToYouRaw ?? '') || null,
      billing_period_start: start,
      billing_period_end: end,
      source: 'network_json',
      raw_blob_id: rawBlobId ?? null,
    };
  });
}


