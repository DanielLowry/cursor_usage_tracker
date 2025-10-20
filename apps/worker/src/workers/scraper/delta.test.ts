import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { computeDeltaEvents } from './delta';
import { parseNetworkJsonPayload, toNormalizedEvents } from './normalize';

const fixturesDir = path.join(__dirname, '__fixtures__');
const jsonBuffer = fs.readFileSync(path.join(fixturesDir, 'payload.json'));

function buildEvents() {
  const payload = parseNetworkJsonPayload(jsonBuffer);
  if (!payload) throw new Error('fixture payload invalid');
  const capturedAt = new Date('2025-01-20T00:00:00Z');
  const events = toNormalizedEvents(payload, capturedAt, 'blob-xyz');
  events[1] = { ...events[1], captured_at: new Date('2025-01-21T00:00:00Z') };
  return events;
}

describe('delta computation', () => {
  it('returns all events when no cutoff is provided', () => {
    const events = buildEvents();
    const result = computeDeltaEvents(events, null);
    expect(result).toHaveLength(events.length);
    expect(result).not.toBe(events);
  });

  it('filters out events at or before the cutoff', () => {
    const events = buildEvents();
    const cutoff = new Date('2025-01-20T12:00:00Z');
    const delta = computeDeltaEvents(events, cutoff);
    expect(delta).toHaveLength(1);
    expect(delta[0].captured_at.toISOString()).toBe('2025-01-21T00:00:00.000Z');
  });
});
