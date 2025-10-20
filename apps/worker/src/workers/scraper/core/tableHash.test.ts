import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeTableHash, buildStableTableView } from './tableHash';
import { normalizeNetworkPayload } from './normalize';

function loadJsonFixture<T>(path: string): T {
  const url = new URL(`../../../../../../tests/fixtures/${path}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

describe('table hash', () => {
  it('builds a stable view with deterministic ordering', () => {
    const payload = loadJsonFixture<Record<string, unknown>>('network/sample1.json');
    const events = normalizeNetworkPayload(payload, new Date('2025-02-20T00:00:00Z'), null);
    const view = buildStableTableView(events);
    expect(view.billing_period).toEqual({ start: '2025-02-01', end: '2025-02-28' });
    expect(view.rows.map((r) => r.model)).toEqual(['gpt-4.1', 'gpt-4.1-mini']);
  });

  it('computes table hash and exposes period bounds', () => {
    const payload = loadJsonFixture<Record<string, unknown>>('network/sample1.json');
    const capturedAt = new Date('2025-02-20T00:00:00Z');
    const events = normalizeNetworkPayload(payload, capturedAt, null);
    const result = computeTableHash(events);
    expect(result.tableHash).toMatch(/[0-9a-f]{32,}/);
    expect(result.billingStart?.toISOString()).toBe('2025-02-01T00:00:00.000Z');
    expect(result.billingEnd?.toISOString()).toBe('2025-02-28T00:00:00.000Z');
    expect(result.totalRowsCount).toBe(2);
  });
});
