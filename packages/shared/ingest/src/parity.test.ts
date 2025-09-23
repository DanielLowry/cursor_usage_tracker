/**
 * Test Purpose:
 * - Performs a parity check between normalized rows generated from the network JSON payload and a canonical
 *   DOM-derived normalization fixture to ensure both ingestion paths stay aligned.
 *
 * Assumptions:
 * - Fixture files exist under `tests/fixtures` and represent equivalent source data captured at the same time.
 * - `mapNetworkJson` returns rows containing token counts and cost fields that can be compared directly to the
 *   DOM-normalized snapshot.
 *
 * Expected Outcome & Rationale:
 * - The mapped output strictly equals the DOM-normalized fixture, confirming that both ingestion pipelines
 *   produce identical normalized data to prevent downstream drift.
 */
import { describe, it, expect } from 'vitest';
import { mapNetworkJson } from './mapNetworkJson';
import * as fs from 'fs';
import * as path from 'path';

// Early parity test: compare mapped JSON vs pre-normalized DOM-equivalent JSON rows
describe('JSON vs DOM parity (early)', () => {
  it('produces the same normalized rows for equivalent data', () => {
    const capturedAt = new Date('2025-02-10T01:02:03Z');
    const jsonPath = path.join(process.cwd(), 'tests/fixtures/network/sample1.json');
    const domNormPath = path.join(process.cwd(), 'tests/fixtures/dom/sample1.normalized.json');
    const jsonPayload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const domNormalized = JSON.parse(fs.readFileSync(domNormPath, 'utf8'));

    const mapped = mapNetworkJson(jsonPayload, capturedAt, null).map((r) => ({
      model: r.model,
      input_with_cache_write_tokens: r.input_with_cache_write_tokens,
      input_without_cache_write_tokens: r.input_without_cache_write_tokens,
      cache_read_tokens: r.cache_read_tokens,
      output_tokens: r.output_tokens,
      total_tokens: r.total_tokens,
      api_cost_cents: r.api_cost_cents,
      cost_to_you_cents: r.cost_to_you_cents,
    }));

    expect(mapped).toStrictEqual(domNormalized);
  });
});



