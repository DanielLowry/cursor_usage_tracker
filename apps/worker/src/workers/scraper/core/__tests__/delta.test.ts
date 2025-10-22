import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { mapNetworkJson } from '@cursor-usage/ingest';

import { computeDeltaEvents } from '../delta';

describe('computeDeltaEvents', () => {
  const fixturePath = resolve(__dirname, '../../../../../../../tests/fixtures/network/sample1.json');
  const payload = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const capturedAt = new Date('2025-03-01T00:00:00Z');
  const normalized = mapNetworkJson(payload, capturedAt).map((event, index) => ({
    ...event,
    captured_at: new Date(capturedAt.getTime() + index * 60_000),
  }));

  it('returns all events when no previous capture exists', () => {
    const delta = computeDeltaEvents(normalized, null);

    expect(delta).toHaveLength(2);
    expect(delta).not.toBe(normalized);
  });

  it('filters events that are newer than the latest capture', () => {
    const latest = new Date(capturedAt.getTime() + 30_000);

    const delta = computeDeltaEvents(normalized, latest);

    expect(delta).toHaveLength(1);
    expect(delta[0].captured_at.toISOString()).toBe('2025-03-01T00:01:00.000Z');
  });

  it('returns empty when everything is older or equal to latest capture', () => {
    const latest = new Date(capturedAt.getTime() + 2 * 60_000);

    const delta = computeDeltaEvents(normalized, latest);

    expect(delta).toHaveLength(0);
  });
});
