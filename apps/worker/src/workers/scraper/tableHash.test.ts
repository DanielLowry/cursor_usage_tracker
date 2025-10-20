import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildStableViewHash } from './tableHash';
import { parseNetworkJsonPayload, toNormalizedEvents } from './normalize';

const fixturesDir = path.join(__dirname, '__fixtures__');
const jsonBuffer = fs.readFileSync(path.join(fixturesDir, 'payload.json'));

function loadEvents() {
  const payload = parseNetworkJsonPayload(jsonBuffer);
  if (!payload) throw new Error('fixture payload invalid');
  return toNormalizedEvents(payload, new Date('2025-01-20T00:00:00Z'), null);
}

describe('table hash', () => {
  it('produces stable hashes regardless of input order', () => {
    const events = loadEvents();
    const reversed = [...events].reverse();
    const first = buildStableViewHash(events);
    const second = buildStableViewHash(reversed);
    expect(second.tableHash).toBe(first.tableHash);
    expect(second.totalRowsCount).toBe(events.length);
  });

  it('projects billing period boundaries from first event', () => {
    const events = loadEvents();
    const result = buildStableViewHash(events);
    expect(result.billingPeriodStart?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(result.billingPeriodEnd?.toISOString()).toBe('2025-01-31T00:00:00.000Z');
  });
});
