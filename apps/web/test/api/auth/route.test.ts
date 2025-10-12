import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import { AuthSession, deriveRawCookiesFromSessionData, writeRawCookiesAtomic } from '../../../../../packages/shared/cursor-auth/src/AuthSession';
import { POST as uploadSessionPost } from '../../../app/api/auth/upload-session/route';
import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as pathModule from 'path';
import * as os from 'os';

vi.mock('fs');
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, join: vi.fn((...args) => args.join('/')) };
});
vi.mock('../../../../../packages/shared/cursor-auth/src/AuthSession', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    persistEncryptedSessionData: vi.fn(() => Promise.resolve('mock-filename.json')),
    validateRawCookies: vi.fn(() => Promise.resolve({ ok: true, status: 200, reason: 'api_ok', keys: ['billingCycleStart'] })),
    writeRawCookiesAtomic: vi.fn(() => Promise.resolve()), // Add this mock
  };
});

describe('API Route Tests', () => {
  let mockAgent: MockAgent;
  let dispatcher: any;
  let tmpDir: string;

  beforeEach(() => {
    dispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);

    tmpDir = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'api-route-test-'));
    // Mock fs.existsSync and fs.mkdirSync for AuthSession constructor
    (fs.existsSync as vi.Mock).mockReturnValue(true);
    (fs.mkdirSync as vi.Mock).mockReturnValue(undefined);
    (pathModule.join as vi.Mock).mockImplementation((...args) => args.join('/'));
  });

  afterEach(async () => {
    await mockAgent.close();
    setGlobalDispatcher(dispatcher);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe('/api/auth/upload-session POST', () => {
    test('should return 400 if no sessionData is provided', async () => {
      const mockRequest = new Request('https://example.com/api/auth/upload-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const response = await uploadSessionPost(mockRequest);
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe('No session data provided');
    });

    test('should successfully upload session data', async () => {
      const mockSessionData = { cookies: [{ name: 'test', value: '123' }] };
      const mockRequest = new Request('https://example.com/api/auth/upload-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionData: mockSessionData }),
      });

      const response = await uploadSessionPost(mockRequest);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.sessionFilename).toBe('mock-filename.json');
      expect(json.verification.ok).toBe(true);
      expect(json.verification.status).toBe(200);
      expect(json.verification.reason).toBe('api_ok');
      expect(vi.mocked(AuthSession.prototype.writeAtomically)).toHaveBeenCalledOnce();
    });

    test('should successfully upload session data and refresh canonical state', async () => {
      const mockSessionData = { cookies: [{ name: 'test', value: '123', domain: 'cursor.com', path: '/', expires: 2000000000 }] };
      const mockRequest = new Request('https://example.com/api/auth/upload-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionData: mockSessionData }),
      });

      const response = await uploadSessionPost(mockRequest);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.success).toBe(true);
      expect(json.sessionFilename).toBe('mock-filename.json');
      expect(json.verification.ok).toBe(true);
      expect(json.verification.status).toBe(200);
      expect(json.verification.reason).toBe('api_ok');
      
      // Assert that writeRawCookiesAtomic (which uses AuthSession.writeAtomically internally) was called with the derived cookies
      expect(vi.mocked(AuthSession.prototype.writeAtomically)).toHaveBeenCalledOnce();
      const expectedDerivedCookies = deriveRawCookiesFromSessionData(mockSessionData);
      expect(vi.mocked(AuthSession.prototype.writeAtomically)).toHaveBeenCalledWith(expectedDerivedCookies);
    });
  });
});
