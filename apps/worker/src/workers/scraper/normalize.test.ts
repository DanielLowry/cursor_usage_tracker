import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseCapturedItem, parseNetworkJsonPayload, toNormalizedEvents } from './normalize';

const fixturesDir = path.join(__dirname, '__fixtures__');
const csvBuffer = fs.readFileSync(path.join(fixturesDir, 'usage.csv'));
const jsonBuffer = fs.readFileSync(path.join(fixturesDir, 'payload.json'));

describe('normalize helpers', () => {
  it('parses csv captures into cursor payloads', () => {
    const payload = parseCapturedItem({ kind: 'html', payload: csvBuffer });
    expect(payload).toBeTruthy();
    expect(payload?.billing_period).toEqual({ start: '2025-01-01', end: '2025-01-31' });
    expect(payload?.rows[0].model).toBe('gpt-4.1');
  });

  it('parses network json captures directly', () => {
    const payload = parseNetworkJsonPayload(jsonBuffer);
    expect(payload?.rows).toHaveLength(2);
  });

  it('normalizes payloads deterministically', () => {
    const payload = parseNetworkJsonPayload(jsonBuffer);
    expect(payload).toBeTruthy();
    if (!payload) throw new Error('expected payload');
    const capturedAt = new Date('2025-01-20T00:00:00Z');
    const normalized = toNormalizedEvents(payload, capturedAt, 'blob-123');
    expect(normalized).toHaveLength(2);
    expect(normalized.every((row) => row.captured_at.getTime() === capturedAt.getTime())).toBe(true);
    expect(normalized[0].raw_blob_id).toBe('blob-123');
  });
});
