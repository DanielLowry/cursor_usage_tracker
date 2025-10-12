import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  deriveRawCookiesFromSessionData,
  buildCookieHeader,
  writeRawCookiesAtomic,
  readRawCookies,
} from '../src';

describe('cursor-auth shared helpers', () => {
  it('derives and filters cookies (domain and expiry)', () => {
    const session = {
      cookies: [
        { name: 'a', value: '1', domain: 'cursor.com', path: '/', expires: Math.floor(Date.now() / 1000) + 3600 },
        { name: 'b', value: '2', domain: 'example.com', path: '/' },
        { name: 'c', value: '3', domain: 'sub.cursor.com', path: '/', expires: 0 },
        { name: 'd', value: '4', domain: 'cursor.com', path: '/', expires: Math.floor(Date.now() / 1000) - 10 },
      ],
    };
    const derived = deriveRawCookiesFromSessionData(session);
    const names = derived.map((c) => c.name).sort();
    expect(names).toEqual(['a', 'c']);
  });

  it('builds cookie header', () => {
    const header = buildCookieHeader([
      { name: 'x', value: '1' },
      { name: 'y', value: '2' },
    ] as any);
    expect(header).toBe('x=1; y=2');
  });

  it('writes state atomically and can be read back', async () => {
    const tmpDir = path.join(process.cwd(), '.tmp-test-auth');
    try { await fs.promises.rm(tmpDir, { recursive: true, force: true }); } catch {}
    await writeRawCookiesAtomic([
      { name: 'sid', value: 'abc', domain: 'cursor.com', path: '/' },
    ] as any, tmpDir);
    const cookies = await readRawCookies(tmpDir);
    expect(cookies.length).toBe(1);
    expect(cookies[0].name).toBe('sid');
  });
});


