import { describe, it, expect } from 'vitest';
import { parseCapturedPayload, buildStableViewHash, ensureBlob } from './scraper';
import { createHash } from 'crypto';

describe('scraper helpers', () => {
  it('parses CSV payload into rows and billing period', () => {
    const csv = `Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n2025-09-01T12:00:00Z,gpt,10,5,0,20,35,0.10`;
    const buf = Buffer.from(csv, 'utf8');
    const parsed = parseCapturedPayload({ payload: buf, kind: 'html' });
    expect(parsed).toBeDefined();
    // @ts-ignore
    expect(parsed.rows.length).toBe(1);
    // @ts-ignore
    expect(parsed.billing_period.start).toBe('2025-09-01');
  });

  it('computes stable view hash and billing bounds', () => {
    const events = [
      { model: 'a', total_tokens: 10, kind: 'x', billing_period_start: new Date('2025-09-01T00:00:00Z'), billing_period_end: new Date('2025-09-30T00:00:00Z') },
      { model: 'b', total_tokens: 5, kind: 'x', billing_period_start: new Date('2025-09-01T00:00:00Z'), billing_period_end: new Date('2025-09-30T00:00:00Z') },
    ];
    const res = buildStableViewHash(events as any);
    expect(res.tableHash).toBeDefined();
    expect(res.billingStart).toBeInstanceOf(Date);
    expect(res.billingEnd).toBeInstanceOf(Date);
  });

  it('ensureBlob reuses existing or creates new blob', async () => {
    // This is a lightweight smoke test calling ensureBlob with an in-memory buffer.
    const buf = Buffer.from(JSON.stringify({ a: 1 }));
    const h = createHash('sha256').update(buf).digest('hex');
    // Call ensureBlob twice; the second call should find existing by content_hash.
    const id1 = await ensureBlob({ payload: buf, kind: 'network_json' } as any, h);
    const id2 = await ensureBlob({ payload: buf, kind: 'network_json' } as any, h);
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).toBe(id2);
  });
});


