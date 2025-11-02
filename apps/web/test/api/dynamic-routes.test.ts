import { describe, test, expect, afterEach, vi } from 'vitest';
import { GET as authStatusGet } from '../../app/api/auth/status/route';
import { GET as authDebugGet } from '../../app/api/auth/debug/route';
import { GET as rawCsvGet } from '../../app/api/explorer/raw-csv/route';
import * as cursorAuth from '../../../../packages/shared/cursor-auth/src';
import { AuthSession } from '../../../../packages/shared/cursor-auth/src/AuthSession';
import * as cursorClient from '../../app/api/_utils/cursorClient';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('server-side route freshness', () => {
  test('/api/auth/status reads live state each request', async () => {
    const readSpy = vi
      .spyOn(cursorAuth, 'readRawCookies')
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { name: 'session', value: 'abc', domain: 'cursor.com', path: '/' },
      ]);

    const validateSpy = vi
      .spyOn(cursorAuth, 'validateRawCookies')
      .mockResolvedValueOnce({
        ok: false,
        status: 0,
        reason: 'no_cookies',
        keys: [],
        contentType: '',
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        reason: 'api_ok',
        keys: ['billingCycleStart'],
        contentType: 'application/json',
        usageSummary: {
          membershipType: 'pro',
          billingCycleStart: '2025-01-01T00:00:00.000Z',
          billingCycleEnd: '2025-01-31T00:00:00.000Z',
        },
      });

    const first = await authStatusGet();
    expect(first.status).toBe(401);
    const firstJson = await first.json();
    expect(firstJson.isAuthenticated).toBe(false);
    expect(firstJson.verification.reason).toBe('no_cookies');

    const second = await authStatusGet();
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.isAuthenticated).toBe(true);
    expect(secondJson.usageSummary.membershipType).toBe('pro');

    expect(readSpy).toHaveBeenCalledTimes(2);
    expect(validateSpy).toHaveBeenCalledTimes(2);
  });

  test('/api/auth/debug re-computes preview per call', async () => {
    const previewSpy = vi
      .spyOn(AuthSession.prototype, 'preview')
      .mockResolvedValueOnce({
        cookieNames: [],
        hasCSRF: false,
        hash: 'hash-one',
      })
      .mockResolvedValueOnce({
        cookieNames: ['csrftoken'],
        hasCSRF: true,
        hash: 'hash-two',
      });

    const res1 = await authDebugGet();
    const json1 = await res1.json();
    expect(json1.hash).toBe('hash-one');

    const res2 = await authDebugGet();
    const json2 = await res2.json();
    expect(json2.hash).toBe('hash-two');

    expect(previewSpy).toHaveBeenCalledTimes(2);
  });

  test('/api/explorer/raw-csv refetches CSV data per request', async () => {
    const fetchSpy = vi
      .spyOn(cursorClient, 'fetchLiveCsv')
      .mockResolvedValueOnce('col1,col2\nalpha,beta\n')
      .mockResolvedValueOnce('col1,col2\ngamma,delta\n');

    const req = new Request('https://example.com/api/explorer/raw-csv');
    const res1 = await rawCsvGet(req);
    const data1 = await res1.json();
    expect(data1.rows[0][0]).toBe('alpha');

    const res2 = await rawCsvGet(req);
    const data2 = await res2.json();
    expect(data2.rows[0][0]).toBe('gamma');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
