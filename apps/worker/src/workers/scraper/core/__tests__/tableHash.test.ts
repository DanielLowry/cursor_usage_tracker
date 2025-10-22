import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { stableHash } from '@cursor-usage/hash';
import { mapNetworkJson } from '@cursor-usage/ingest';

import { buildStableViewHash } from '../tableHash';

describe('buildStableViewHash', () => {
  const fixturePath = resolve(__dirname, '../../../../../../../tests/fixtures/network/sample1.json');
  const payload = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const capturedAt = new Date('2025-03-01T00:00:00Z');

  it('projects normalized events into a deterministic table hash', () => {
    const normalized = mapNetworkJson(payload, capturedAt);
    const summary = buildStableViewHash(normalized);

    expect(summary.billingStart?.toISOString()).toBe('2025-02-01T00:00:00.000Z');
    expect(summary.billingEnd?.toISOString()).toBe('2025-02-28T00:00:00.000Z');
    expect(summary.totalRowsCount).toBe(2);

    const expectedView = {
      billing_period: { start: '2025-02-01', end: '2025-02-28' },
      rows: [
        {
          model: 'gpt-4.1',
          kind: null,
          max_mode: null,
          input_with_cache_write_tokens: 100,
          input_without_cache_write_tokens: 200,
          cache_read_tokens: 50,
          output_tokens: 150,
          total_tokens: 500,
          api_cost_cents: 50,
          api_cost_raw: '$0.50',
          cost_to_you_cents: 40,
          cost_to_you_raw: '$0.40',
        },
        {
          model: 'gpt-4.1-mini',
          kind: null,
          max_mode: null,
          input_with_cache_write_tokens: 10,
          input_without_cache_write_tokens: 20,
          cache_read_tokens: 5,
          output_tokens: 15,
          total_tokens: 50,
          api_cost_cents: 5,
          api_cost_raw: '$0.05',
          cost_to_you_cents: 4,
          cost_to_you_raw: '$0.04',
        },
      ],
    };

    expect(summary.tableHash).toBe(stableHash(expectedView));
  });

  it('ignores input ordering when hashing', () => {
    const normalized = mapNetworkJson(payload, capturedAt);
    const reversed = [...normalized].reverse();

    expect(buildStableViewHash(normalized).tableHash).toBe(buildStableViewHash(reversed).tableHash);
  });
});
