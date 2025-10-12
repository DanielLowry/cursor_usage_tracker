// Relative path: packages/shared/cursor-auth/src/index.ts

import * as fs from 'fs/promises';
import * as pathModule from 'path';
import { z } from 'zod';
import * as crypto from 'crypto';

// Schema for Cursor authentication state
const CursorAuthStateSchema = z.object({
  isAuthenticated: z.boolean(),
  lastChecked: z.string(),
  sessionCookies: z.array(z.object({
    name: z.string(),
    value: z.string(),
    domain: z.string(),
    path: z.string(),
    expires: z.number().optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
  })).optional(),
  userAgent: z.string().optional(),
  lastLogin: z.string().optional(),
  expiresAt: z.string().optional(),
  source: z.enum(['stored_state', 'live_check']).optional(),
  error: z.string().optional(),
});

export type CursorAuthState = z.infer<typeof CursorAuthStateSchema>;

/**
 * CursorAuthManager
 *
 * Responsibility:
 * - Owns the canonical auth state file (`cursor.state.json`)
 * - Persists minimal, reusable auth data (e.g. cookies, timestamps)
 * - Persists minimal cookie state suitable for HTTP requests (no Playwright coupling)
 *
 * This intentionally does not know about uploaded session artifacts. Those are
 * higher-level inputs; the API route should distill them down into this state.
 */
export class CursorAuthManager {
  private statePath: string;

  constructor(stateDir: string = './data') {
    this.statePath = pathModule.join(stateDir, 'cursor.state.json');
  }

  /**
   * Load the current authentication state
   */
  async loadState(): Promise<CursorAuthState | null> {
    try {
      if (!fs.existsSync(this.statePath)) {
        return null;
      }
      
      const content = await fs.promises.readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(content);
      return CursorAuthStateSchema.parse(parsed);
    } catch (error) {
      console.warn('Failed to load cursor auth state:', error);
      return null;
    }
  }

  /**
   * Save the authentication state
   */
  async saveState(state: CursorAuthState): Promise<void> {
    try {
      // Ensure directory exists
      const dir = pathModule.dirname(this.statePath);
      await fs.promises.mkdir(dir, { recursive: true });
      
      // Validate state before saving
      const validatedState = CursorAuthStateSchema.parse(state);
      
      await fs.promises.writeFile(
        this.statePath, 
        JSON.stringify(validatedState, null, 2)
      );
    } catch (error) {
      console.error('Failed to save cursor auth state:', error);
      throw error;
    }
  }

  /**
   * Update authentication status
   */
  async updateAuthStatus(isAuthenticated: boolean, error?: string): Promise<void> {
    const currentState = await this.loadState();
    const newState: CursorAuthState = {
      ...(currentState || {}),
      isAuthenticated,
      lastChecked: new Date().toISOString(),
      source: 'live_check',
      ...(error ? { error } : {}),
    };

    if (!error && 'error' in (newState as any)) {
      delete (newState as any).error;
    }

    await this.saveState(newState);
  }

  // Note: Playwright-specific cookie save/apply helpers have been removed.

  /**
   * Save session cookies provided directly (no Playwright dependency)
   */
  async saveSessionCookiesRaw(cookies: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
  }>): Promise<void> {
    try {
      const normalized = (cookies || [])
        .filter(Boolean)
        .map((c) => ({
          name: String(c.name),
          value: String(c.value ?? ''),
          domain: String(c.domain ?? ''),
          path: String(c.path ?? '/'),
          ...(typeof c.expires === 'number' ? { expires: c.expires } : {}),
          ...(typeof c.httpOnly === 'boolean' ? { httpOnly: c.httpOnly } : {}),
          ...(typeof c.secure === 'boolean' ? { secure: c.secure } : {}),
          ...(c.sameSite ? { sameSite: c.sameSite } : {}),
        }));

      const currentState = await this.loadState();
      const newState: CursorAuthState = {
        ...(currentState || {}),
        isAuthenticated: true,
        lastChecked: new Date().toISOString(),
        sessionCookies: normalized,
        lastLogin: new Date().toISOString(),
        source: 'live_check',
      };

      if ('error' in (newState as any)) {
        delete (newState as any).error;
      }

      await this.saveState(newState);
    } catch (error) {
      console.error('Failed to save raw session cookies:', error);
      throw error;
    }
  }

  // Note: Playwright-specific cookie application has been removed.

  /**
   * Check if session is likely expired
   */
  async isSessionExpired(): Promise<boolean> {
    const state = await this.loadState();
    if (!state?.expiresAt) {
      return false;
    }
    
    return new Date() > new Date(state.expiresAt);
  }

  /**
   * Clear authentication state
   */
  async clearState(): Promise<void> {
    try {
      if (fs.existsSync(this.statePath)) {
        await fs.promises.unlink(this.statePath);
      }
    } catch (error) {
      console.warn('Failed to clear auth state:', error);
    }
  }

  /**
   * Get state file path
   */
  getStatePath(): string {
    try {
      const dir = pathModule.dirname(this.statePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (e) {
      // best-effort; callers also ensure directory
    }
    return this.statePath;
  }
}

// --- Shared helper APIs ---------------------------------------------------

export type RawCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

export type SessionData = any;

function normalizeSameSite(val: any): 'Strict' | 'Lax' | 'None' | undefined {
  if (val == null) return undefined;
  const s = String(val).trim().toLowerCase();
  if (s === 'strict') return 'Strict';
  if (s === 'lax') return 'Lax';
  if (s === 'none') return 'None';
  return undefined;
}

/**
 * deriveRawCookiesFromSessionData
 *
 * Purpose:
 * - Extract minimal cookie objects from a heterogeneous uploaded SessionData structure.
 * - Reduce to only the fields required at runtime to build a Cookie header.
 * - Filter to domains relevant to Cursor (cursor.com and subdomains) and drop expired cookies.
 *
 * Inputs:
 * - session: SessionData (arbitrary JSON). May contain fields like `cookies`, `Cookies`, or `cookieStore` (array-like).
 *
 * Outputs:
 * - Array<RawCookie> where each cookie includes name, value, optional domain/path/expiry/flags.
 *   Cookies outside of Cursor domains or already expired are omitted.
 */
export function deriveRawCookiesFromSessionData(session: SessionData): RawCookie[] {
  if (!session) return [];
  const raw = (session as any).cookies || (session as any).Cookies || (session as any).cookieStore || (Array.isArray(session) ? session : []);
  if (!Array.isArray(raw)) return [];

  const now = Math.floor(Date.now() / 1000);
  return raw
    .filter(Boolean)
    .map((c: any) => {
      let domain = c.domain || c.Domain;
      if (domain && typeof domain === 'string' && domain.startsWith('.')) domain = domain.slice(1);
      return {
        name: String(c.name || c.key || ''),
        value: String(c.value || c.val || c.cookie || ''),
        domain: domain ? String(domain) : undefined,
        path: String(c.path || '/'),
        expires: typeof c.expires === 'number' ? c.expires : undefined,
        httpOnly: Boolean(c.httpOnly || c.httponly),
        secure: Boolean(c.secure),
        sameSite: normalizeSameSite(c.sameSite ?? c.same_site ?? c.sameSitePolicy),
      } as RawCookie;
    })
    .filter((c: RawCookie) => c.name && c.value)
    // Filter out expired cookies and non-cursor domains
    .filter((c: RawCookie) => {
      const notExpired = !c.expires || c.expires === 0 || c.expires > now;
      const domainOk = !c.domain || c.domain === 'cursor.com' || c.domain.endsWith('.cursor.com');
      return notExpired && domainOk;
    });
}

/**
 * buildCookieHeader
 *
 * Purpose:
 * - Convert a list of RawCookies into a single HTTP Cookie header string for runtime requests.
 *
 * Inputs:
 * - cookies: Array<RawCookie> (already pre-filtered for domain/expiry by caller).
 *
 * Outputs:
 * - string | null: e.g. "name1=value1; name2=value2" or null if no cookies are present.
 */
export function buildCookieHeader(cookies: RawCookie[] | undefined): string | null {
  if (!cookies || cookies.length === 0) return null;
  const pairs: string[] = [];
  for (const c of cookies) {
    if (!c || !c.name) continue;
    pairs.push(`${c.name}=${c.value}`);
  }
  return pairs.length > 0 ? pairs.join('; ') : null;
}

/**
 * validateRawCookies
 *
 * Purpose:
 * - Validate that a given set of RawCookies can authenticate against Cursor by calling
 *   https://cursor.com/api/usage-summary and verifying both HTTP status and required fields.
 *
 * Inputs:
 * - cookies: Array<RawCookie> used to construct the Cookie header (only header is sent).
 *
 * Outputs:
 * - Promise<{ ok, status, reason?, keys?, contentType?, usageSummary? }>
 *   ok=true when HTTP 200 and JSON contains membershipType, billingCycleStart, billingCycleEnd.
 */
export async function validateRawCookies(cookies: RawCookie[]) {
  const enableDebug = process.env.DEBUG_AUTH === '1';
  if (enableDebug) {
    console.log('cursor-auth: validateRawCookies starting with', cookies.length, 'cookies');
  }

  try {
    const cookieHeader = buildCookieHeader(cookies);
    const headers: Record<string, string> = { Accept: '*/*' };
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    if (enableDebug) {
      console.log('cursor-auth: validateRawCookies fetching https://cursor.com/api/usage-summary');
    }

    const res = await fetch('https://cursor.com/api/usage-summary', { method: 'GET', headers });
    const status = res.status;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    let json: any = null;
    let textSample = '';
    try {
      json = await res.json();
    } catch {
      try { textSample = (await res.text()).slice(0, 200); } catch {}
    }

    if (enableDebug) {
      console.log('cursor-auth: validateRawCookies status:', status, 'contentType:', contentType);
      console.log('cursor-auth: validateRawCookies keys:', json ? Object.keys(json) : 'no json');
      if (textSample) console.log('cursor-auth: validateRawCookies text sample:', textSample);
    }

    const isHtml = /text\/html/.test(contentType) || /<html|<body|<!doctype/i.test(textSample);
    if (isHtml) return { ok: false, status, reason: 'html_response', keys: [], contentType };
    if (status === 401 || status === 403) return { ok: false, status, reason: `status:${status}`, keys: [], contentType };
    if (status !== 200) return { ok: false, status, reason: `status:${status}`, keys: [], contentType };

    const isObject = json && typeof json === 'object' && !Array.isArray(json);
    if (!isObject) return { ok: false, status, reason: 'invalid_json', keys: [], contentType };

    const keys = Object.keys(json || {});
    const required = ['billingCycleStart', 'billingCycleEnd', 'membershipType'];
    const hasRequired = required.every(k => k in (json || {}));
    if (!hasRequired) return { ok: false, status, reason: 'missing_fields', keys, contentType };

    const usageSummary = {
      membershipType: (json as any).membershipType,
      billingCycleStart: (json as any).billingCycleStart,
      billingCycleEnd: (json as any).billingCycleEnd,
    };
    if (enableDebug) {
      console.log('cursor-auth: validateRawCookies success, hasRequired:', hasRequired);
    }
    return { ok: true, status, reason: 'api_ok', keys, contentType, usageSummary };
  } catch (e) {
    if (enableDebug) {
      console.log('cursor-auth: validateRawCookies fetch error:', e instanceof Error ? e.message : String(e));
    }
    return { ok: false, status: 0, reason: `fetch_error:${e instanceof Error ? e.message : String(e)}`, keys: [], contentType: '' };
  }
}

/**
 * readRawCookies
 *
 * Purpose:
 * - Load RawCookies from the canonical state file managed by CursorAuthManager.
 *
 * Inputs:
 * - stateDir?: string directory containing `cursor.state.json` (default: ./data)
 *
 * Outputs:
 * - Promise<Array<RawCookie>> possibly empty if state file missing or invalid.
 */
export async function readRawCookies(stateDir: string = './data'): Promise<RawCookie[]> {
  const enableDebug = process.env.DEBUG_AUTH === '1';
  if (enableDebug) {
    const resolvedDir = pathModule.resolve(stateDir);
    console.log('cursor-auth: readRawCookies resolved dir:', resolvedDir);
    const fullPath = pathModule.join(resolvedDir, 'cursor.state.json');
    console.log('cursor-auth: readRawCookies full path:', fullPath);
    const exists = await fs.access(fullPath).then(() => true).catch(() => false);
    console.log('cursor-auth: readRawCookies file exists:', exists);
  }

  try {
    const manager = new CursorAuthManager(stateDir);
    const state = await manager.loadState();
    const cookies = (state && state.sessionCookies) || [];
    if (enableDebug) {
      console.log('cursor-auth: readRawCookies cookie count:', cookies.length);
    }
    return cookies;
  } catch (e) {
    if (enableDebug) {
      console.log('cursor-auth: readRawCookies failed:', e.message);
    }
    return [];
  }
}

/**
 * writeRawCookiesAtomic
 *
 * Purpose:
 * - Persist RawCookies to the canonical state file using atomic temp-file + rename semantics.
 * - Mark state as authenticated and include timestamps for auditing.
 *
 * Inputs:
 * - cookies: Array<RawCookie> to be written as `sessionCookies` in the state file.
 * - stateDir?: string directory containing `cursor.state.json` (default: ./data)
 *
 * Outputs:
 * - Promise<void> (throws on failure).
 */
export async function writeRawCookiesAtomic(cookies: RawCookie[], stateDir: string = './data'): Promise<void> {
  try {
    const manager = new CursorAuthManager(stateDir);
    const dir = pathModule.dirname(manager.getStatePath());
    await fs.promises.mkdir(dir, { recursive: true });

    const tempPath = manager.getStatePath() + `.tmp-${crypto.randomBytes(8).toString('hex')}`;
    const stateToWrite = {
      isAuthenticated: true,
      lastChecked: new Date().toISOString(),
      sessionCookies: cookies,
      lastLogin: new Date().toISOString(),
      source: 'live_check'
    } as any;

    await fs.promises.writeFile(tempPath, JSON.stringify(stateToWrite, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(tempPath, manager.getStatePath());
  } catch (e) {
    throw e;
  }
}

/**
 * persistEncryptedSessionData
 *
 * Purpose:
 * - Persist an uploaded SessionData artifact for diagnostics only, using AES-256-GCM with the
 *   existing SESSION_ENCRYPTION_KEY environment variable. Not used at runtime for auth.
 *
 * Inputs:
 * - session: SessionData (arbitrary JSON). Stored encrypted to `./data/diagnostics/`.
 * - stateDir?: string (default: ./data) base directory for diagnostics folder.
 *
 * Outputs:
 * - Promise<string>: filename of the saved encrypted artifact.
 */
export async function persistEncryptedSessionData(session: SessionData, stateDir: string = './data'): Promise<string> {
  try {
    const dir = pathModule.join(stateDir, 'diagnostics');
    await fs.promises.mkdir(dir, { recursive: true });

    const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY;
    if (!ENCRYPTION_KEY) throw new Error('SESSION_ENCRYPTION_KEY not set');
    const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
    if (keyBuffer.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must be 32 bytes (hex-encoded)');

    const dataToEncrypt = JSON.stringify(session);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createSecretKey(keyBuffer), iv);
    const encrypted = Buffer.concat([cipher.update(dataToEncrypt, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const payload = {
      ciphertext: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      tag: authTag.toString('base64'),
      createdAt: new Date().toISOString(),
      isEncrypted: true
    };

    const filename = `session_diag_${Date.now()}.json`;
    const filePath = pathModule.join(dir, filename);
    await fs.promises.writeFile(filePath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    return filename;
  } catch (e) {
    throw e;
  }
}

/**
 * getAuthHeaders
 *
 * Purpose:
 * - Build runtime HTTP headers using only the canonical RawCookies read from state.
 * - Returns `{ Cookie: '...' }` when available; otherwise `{}`.
 *
 * Inputs:
 * - stateDir?: string directory containing `cursor.state.json` (default: ./data)
 *
 * Outputs:
 * - Promise<Record<string,string>> suitable for fetch() `headers`.
 */
export async function getAuthHeaders(stateDir: string = './data'): Promise<Record<string, string>> {
  const enableDebug = process.env.DEBUG_AUTH === '1';
  try {
    const cookies = await readRawCookies(stateDir);
    const header = buildCookieHeader(cookies);
    const result = header ? { Cookie: header } : {};
    if (enableDebug) {
      console.log('cursor-auth: getAuthHeaders length:', header ? header.length : 0);
      if (header) {
        console.log('cursor-auth: getAuthHeaders preview:', header.substring(0, 50) + '...');
      }
    }
    return result;
  } catch (e) {
    if (enableDebug) {
      console.log('cursor-auth: getAuthHeaders failed:', e.message);
    }
    return {};
  }
}

