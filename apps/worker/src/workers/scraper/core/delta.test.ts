import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { computeDeltaEvents } from './delta';
import { normalizeNetworkPayload } from './normalize';

function loadJsonFixture<T>(path: string): T {
  const url = new URL(`../../../../../../tests/fixtures/${path}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

describe('computeDeltaEvents', () => {
  it('returns all events when no baseline capture exists', () => {
    const payload = loadJsonFixture<Record<string, unknown>>('network/sample1.json');
    const events = normalizeNetworkPayload(payload, new Date('2025-02-20T00:00:00Z'), null);
    const delta = computeDeltaEvents(events, null);
    expect(delta).toHaveLength(events.length);
    expect(delta).not.toBe(events); // ensure copy semantics
  });

  it('filters events captured before or at latest capture', () => {
    const payload = loadJsonFixture<Record<string, unknown>>('network/sample1.json');
    const events = normalizeNetworkPayload(payload, new Date('2025-02-20T00:00:00Z'), null);
    const latest = new Date('2025-02-20T00:00:00Z');
    const delta = computeDeltaEvents(events, latest);
    expect(delta).toHaveLength(0);
  });
});
