import { describe, it, expect } from 'vitest';
import { ensureBlob } from './scraper';
import { createHash } from 'crypto';

describe('scraper ensureBlob', () => {
  it('ensureBlob reuses existing or creates new blob', async () => {
    // This is a lightweight smoke test calling ensureBlob with an in-memory buffer.
    const buf = Buffer.from(JSON.stringify({ a: 1 }));
    const h = createHash('sha256').update(buf).digest('hex');
    // Call ensureBlob twice; the second call should find existing by content_hash.
    const first = await ensureBlob({ payload: buf, kind: 'network_json' } as any, h, new Date('2025-02-05T00:00:00Z'));
    const second = await ensureBlob({ payload: buf, kind: 'network_json' } as any, h, new Date('2025-02-05T00:00:00Z'));
    expect(first.id).toBeDefined();
    expect(first.created).toBe(true);
    expect(second.id).toBe(first.id);
    expect(second.created).toBe(false);
  });
});


