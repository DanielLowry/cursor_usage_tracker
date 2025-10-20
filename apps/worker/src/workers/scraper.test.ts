import { describe, it, expect } from 'vitest';
import { ensureBlob } from './scraper';
import { createHash } from 'crypto';

describe('ensureBlob', () => {
  it('creates a blob once and reuses it for duplicate content', async () => {
    const payload = Buffer.from(JSON.stringify({ a: 1 }));
    const hash = createHash('sha256').update(payload).digest('hex');
    const first = await ensureBlob({ payload, kind: 'network_json' } as any, hash, new Date('2024-01-01T00:00:00Z'));
    const second = await ensureBlob({ payload, kind: 'network_json' } as any, hash, new Date('2024-01-01T00:00:00Z'));
    expect(first.wasNew).toBe(true);
    expect(second.wasNew).toBe(false);
    expect(first.id).toBeDefined();
    expect(second.id).toBe(first.id);
  });
});


