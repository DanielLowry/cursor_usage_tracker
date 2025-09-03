import { describe, it, expect } from 'vitest';
import { mapNetworkJson } from './mapNetworkJson';
import * as fs from 'fs';
import * as path from 'path';

describe('mapNetworkJson', () => {
  it('maps rows and normalizes numeric fields', () => {
    const capturedAt = new Date('2025-02-01T12:34:56Z');
    const jsonPath = path.join(process.cwd(), 'tests/fixtures/network/sample1.json');
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const result = mapNetworkJson(payload, capturedAt, 'blob-1');
    expect(result.length).toBe(2);
    const r = result[0];
    expect(r.model).toBeDefined();
    expect(r.total_tokens).toBeGreaterThan(0);
    expect(r.api_cost_cents).toBeGreaterThan(0);
    expect(r.billing_period_start?.toISOString()).toBe('2025-02-01T00:00:00.000Z');
    expect(r.billing_period_end?.toISOString()).toBe('2025-02-28T00:00:00.000Z');
    expect(r.source).toBe('network_json');
    expect(r.raw_blob_id).toBe('blob-1');
  });
});


