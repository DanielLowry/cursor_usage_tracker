import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { AuthSession, RawCookie, CursorAuthState, validateRawCookies } from './AuthSession';
import * as fs from 'fs';
import * as pathModule from 'path';
import * as os from 'os';

describe('AuthSession - HTTP Contract Tests (mocked server)', () => {
  let mockAgent: MockAgent;
  let dispatcher: any; // Keep track of the original dispatcher
  let authSession: AuthSession;
  let tmpDir: string;

  beforeEach(() => {
    dispatcher = getGlobalDispatcher(); // Store original dispatcher
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect(); // Ensure all network requests are mocked
    setGlobalDispatcher(mockAgent); // Set mock dispatcher

    tmpDir = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'authsession-http-test-'));
    authSession = new AuthSession(tmpDir);
  });

  afterEach(async () => {
    await mockAgent.close();
    setGlobalDispatcher(dispatcher); // Restore original dispatcher
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const setupMock = (statusCode: number, body: any, headers?: Record<string, string>) => {
    const mockPool = mockAgent.get('https://cursor.com');
    mockPool
      .intercept({ path: '/api/usage-summary' })
      .reply(statusCode, body, { headers });
  };

  test('validateRawCookies handles 200 JSON (usage) correctly', async () => {
    setupMock(200, { billingCycleStart: '2025-01-01', billingCycleEnd: '2025-01-31', membershipType: 'pro' }, { 'content-type': 'application/json' });
    const cookies: RawCookie[] = [{ name: 'session', value: 'valid', domain: 'cursor.com' }];
    const result = await validateRawCookies(cookies);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.reason).toBe('api_ok');
    expect(result.usageSummary).toEqual({
      billingCycleStart: '2025-01-01',
      billingCycleEnd: '2025-01-31',
      membershipType: 'pro',
    });
  });

  test('validateRawCookies handles 200 CSV correctly', async () => {
    setupMock(200, 'col1,col2\nval1,val2', { 'content-type': 'text/csv' });
    const cookies: RawCookie[] = [{ name: 'session', value: 'valid', domain: 'cursor.com' }];
    // validateRawCookies expects JSON for usage-summary, so it should fail for CSV
    const result = await validateRawCookies(cookies);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(200);
    expect(result.reason).toBe('invalid_json');
  });

  test('validateRawCookies handles 401/403: cookies expired/unauthorized', async () => {
    setupMock(401, { error: 'Unauthorized' }, { 'content-type': 'application/json' });
    const cookies: RawCookie[] = [{ name: 'session', value: 'invalid', domain: 'cursor.com' }];
    const result = await validateRawCookies(cookies);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.reason).toBe('status:401');
  });

  test('validateRawCookies handles 302 -> /login or HTML content as auth failure', async () => {
    setupMock(302, '<a href="/login">Redirect</a>', { 'content-type': 'text/html', 'Location': '/login' });
    const cookies: RawCookie[] = [{ name: 'session', value: 'invalid', domain: 'cursor.com' }];
    const result = await validateRawCookies(cookies);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(302);
    expect(result.reason).toBe('html_response');
  });

  test('validateRawCookies handles wrong content-type for expected JSON', async () => {
    setupMock(200, 'Not JSON', { 'content-type': 'text/plain' });
    const cookies: RawCookie[] = [{ name: 'session', value: 'valid', domain: 'cursor.com' }];
    const result = await validateRawCookies(cookies);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(200);
    expect(result.reason).toBe('invalid_json');
  });

  test('AuthSession.toHttpHeaders integrates with buildCookieHeader correctly', async () => {
    const state: CursorAuthState = {
      isAuthenticated: true,
      lastChecked: new Date().toISOString(),
      sessionCookies: [
        { name: 'mycookie', value: 'myvalue', domain: 'cursor.com', path: '/', expires: Date.now() / 1000 + 3600 },
      ],
      source: 'test',
    };
    await authSession.writeAtomically(state);

    const headers = await authSession.toHttpHeaders('https://cursor.com');
    expect(headers['Cookie']).toBe('mycookie=myvalue');
  });
});
