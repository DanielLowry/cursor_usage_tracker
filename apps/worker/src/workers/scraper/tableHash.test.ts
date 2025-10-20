import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { normalizeCapturedPayload } from './normalize';
import { buildStableViewHash } from './tableHash';

describe('buildStableViewHash', () => {
  it('produces a deterministic hash and billing period', () => {
    const payloadPath = resolve(process.cwd(), 'tests/fixtures/network/sample1.json');
    const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
    const capturedAt = new Date('2025-02-05T15:00:00Z');
    const events = normalizeCapturedPayload(payload, capturedAt, 'blob-123').reverse();

    const { tableHash, billingPeriodStart, billingPeriodEnd, totalRowsCount } = buildStableViewHash(events);

    expect(tableHash).toBe('f6a30a3c525bd3a5e83ac9a6ffabb7e51f54a27e0340488c61fa655f907c3084');
    expect(billingPeriodStart?.toISOString()).toBe('2025-02-01T00:00:00.000Z');
    expect(billingPeriodEnd?.toISOString()).toBe('2025-02-28T00:00:00.000Z');
    expect(totalRowsCount).toBe(events.length);
  });
});
