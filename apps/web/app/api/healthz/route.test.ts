import { describe, it, expect } from 'vitest';
import { GET } from './route';

describe('/api/healthz', () => {
  it('returns { ok: true }', async () => {
    const response = await GET();
    const data = await response.json();
    expect(data).toEqual({ ok: true });
  });
});
