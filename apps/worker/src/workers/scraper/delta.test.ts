import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normalizeCapturedPayload } from './normalize';
import { computeDeltaEvents } from './delta';

describe('computeDeltaEvents', () => {
  it('filters events newer than the last capture', () => {
    const payloadPath = resolve(process.cwd(), 'tests/fixtures/network/sample1.json');
    const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
    const baseEvents = normalizeCapturedPayload(payload, new Date('2025-02-05T15:00:00Z'), 'blob-123');

    const [first, second] = baseEvents;
    const stagedEvents = [
      { ...first, captured_at: new Date('2025-02-05T15:00:00Z') },
      { ...second, captured_at: new Date('2025-02-06T01:00:00Z') },
    ];

    const delta = computeDeltaEvents(stagedEvents, new Date('2025-02-05T20:00:00Z'));
    expect(delta).toHaveLength(1);
    expect(delta[0].model).toBe(second.model);
  });

  it('returns a shallow copy when there is no previous capture', () => {
    const payloadPath = resolve(process.cwd(), 'tests/fixtures/network/sample1.json');
    const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
    const events = normalizeCapturedPayload(payload, new Date('2025-02-05T15:00:00Z'), 'blob-123');

    const delta = computeDeltaEvents(events, null);
    expect(delta).toHaveLength(events.length);
    expect(delta).not.toBe(events);
  });
});
