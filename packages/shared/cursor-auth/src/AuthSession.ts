import * as fs from 'fs';
import * as pathModule from 'path';
import * as crypto from 'crypto';
import { z } from 'zod'; // Assuming zod is available in shared package

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

export type SessionData = any; // Represents the full browser state from extension upload

// Schema for Cursor authentication state - moved from index.ts
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
  source: z.enum(['stored_state', 'live_check', 'test']).optional(),
  error: z.string().optional(),
});

export type CursorAuthState = z.infer<typeof CursorAuthStateSchema>;

function normalizeSameSite(val: any): 'Strict' | 'Lax' | 'None' | undefined {
  if (val == null) return undefined;
  const s = String(val).trim().toLowerCase();
  if (s === 'strict') return 'Strict';
  if (s === 'lax') return 'Lax';
  if (s === 'none') return 'None';
  return undefined;
}

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
      // Standardize target host decision: Use either https://cursor.com or https://www.cursor.com everywhere
      const domainOk = !c.domain || c.domain === 'cursor.com' || c.domain.endsWith('.cursor.com') || c.domain === 'www.cursor.com' || c.domain.endsWith('.www.cursor.com');
      return notExpired && domainOk;
    });
}

export function buildCookieHeader(cookies: RawCookie[] | undefined): string | null {
  if (!cookies || cookies.length === 0) return null;
  const pairs: string[] = [];
  for (const c of cookies) {
    if (!c || !c.name) continue;
    pairs.push(`${c.name}=${c.value}`);
  }
  return pairs.length > 0 ? pairs.join('; ') : null;
}

export async function validateRawCookies(cookies: RawCookie[]) {
  console.log('cursor-auth: validateRawCookies starting with', cookies.length, 'cookies');

  try {
    const cookieHeader = buildCookieHeader(cookies);
    const headers: Record<string, string> = { Accept: '*/*' };
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    // Standardize target host decision: Use either https://cursor.com or https://www.cursor.com everywhere
    const targetUrl = 'https://cursor.com/api/usage-summary';
    console.log(`cursor-auth: validateRawCookies fetching ${targetUrl}`);

    // Use manual redirect handling so we can detect 3xx redirects (e.g. to /login)
    const res = await fetch(targetUrl, { method: 'GET', headers, redirect: 'manual' });
    const status = res.status;
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    let json: any = null;
    let textSample = '';
    try {
      json = await res.json();
    } catch (e) {
      try { textSample = (await res.text()).slice(0, 200); } catch (innerErr) { if (process.env.DEBUG_AUTH === '1') console.warn('cursor-auth: reading response text failed', innerErr); }
    }

    console.log('cursor-auth: validateRawCookies status:', status, 'contentType:', contentType);
    console.log('cursor-auth: validateRawCookies keys:', json ? Object.keys(json) : 'no json');
    if (textSample) console.log('cursor-auth: validateRawCookies text sample:', textSample);

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
    console.log('cursor-auth: validateRawCookies success, hasRequired:', hasRequired);
    return { ok: true, status, reason: 'api_ok', keys, contentType, usageSummary };
  } catch (e) {
    console.log('cursor-auth: validateRawCookies fetch error:', e instanceof Error ? e.message : String(e));
    return { ok: false, status: 0, reason: `fetch_error:${e instanceof Error ? e.message : String(e)}`, keys: [], contentType: '' };
  }
}

export class AuthSession {
  private statePath: string;

  constructor(stateDir: string = './data') {
    this.statePath = pathModule.join(stateDir, 'cursor.state.json');
  }

  async load(): Promise<CursorAuthState | null> {
    const enableDebug = process.env.DEBUG_AUTH === '1';
    try {
      const resolvedDir = pathModule.resolve(pathModule.dirname(this.statePath));
      const fullPath = this.statePath;
      if (enableDebug) {
        console.log('cursor-auth: loadState resolvedDir=', resolvedDir);
        console.log('cursor-auth: loadState fullPath=', fullPath);
      }

      if (!fs.existsSync(fullPath)) {
        if (enableDebug) console.log('cursor-auth: loadState file does not exist');
        return null;
      }

      const content = await fs.promises.readFile(fullPath, 'utf-8');
      if (enableDebug) {
        try {
          const stat = fs.statSync(fullPath);
          console.log('cursor-auth: loadState fileSize=', stat.size, 'modified=', stat.mtime.toISOString());
        } catch (e) { console.warn('cursor-auth: loadState stat failed', e); }
      }
      const parsed = JSON.parse(content);
      const state = CursorAuthStateSchema.parse(parsed);
      if (enableDebug) {
        console.log('cursor-auth: loadState parsed sessionCookies count=', (state.sessionCookies || []).length);
      }
      return state;
    } catch (error) {
      if (process.env.DEBUG_AUTH === '1') console.warn('cursor-auth: Failed to load cursor auth state:', error);
      return null;
    }
  }

  async toHttpHeaders(targetUrl: string): Promise<Record<string, string>> {
    const state = await this.load();
    if (!state || !state.sessionCookies || state.sessionCookies.length === 0) {
      return {};
    }

    const header = buildCookieHeader(state.sessionCookies);
    return header ? { Cookie: header } : {};
  }

  async preview(): Promise<{
    cookieNames: string[];
    hasCSRF: boolean;
    hash: string;
  }> {
    const state = await this.load();
    const cookieNames = (state?.sessionCookies || []).map(c => c.name);
    const hasCSRF = (state?.sessionCookies || []).some(c => c.name === 'csrftoken'); // Common CSRF cookie name
    const hash = crypto.createHash('sha256').update(JSON.stringify(state?.sessionCookies || [])).digest('hex');

    return { cookieNames, hasCSRF, hash };
  }

  async writeAtomically(state: CursorAuthState): Promise<void> {
    try {
      // Ensure directory exists
      const dir = pathModule.dirname(this.statePath);
      await fs.promises.mkdir(dir, { recursive: true });
      
      // Validate state before saving
      const validatedState = CursorAuthStateSchema.parse(state);
      // Atomic write: write to a temp file then rename
      const tempPath = this.statePath + `.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const payload = JSON.stringify(validatedState, null, 2);
      console.log('cursor-auth: saveState writing temp file:', tempPath);
      await fs.promises.writeFile(tempPath, payload, { encoding: 'utf8', mode: 0o600 });
      await fs.promises.rename(tempPath, this.statePath);
      console.log('cursor-auth: saveState replaced state file:', this.statePath);
    } catch (error) {
      console.error('Failed to save cursor auth state:', error);
      throw error;
    }
  }

  async clearState(): Promise<void> {
    try {
      if (fs.existsSync(this.statePath)) {
        await fs.promises.unlink(this.statePath);
      }
    } catch (error) {
      console.warn('Failed to clear auth state:', error);
    }
  }
}

export function encryptSessionData(session: SessionData) {
  const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY;
  if (!ENCRYPTION_KEY) throw new Error('SESSION_ENCRYPTION_KEY not set');
  const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
  if (keyBuffer.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must be 32 bytes (hex-encoded)');
  const dataToEncrypt = JSON.stringify(session);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createSecretKey(keyBuffer), iv);
  const encrypted = Buffer.concat([cipher.update(dataToEncrypt, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: authTag.toString('base64'),
    createdAt: new Date().toISOString(),
    isEncrypted: true as const,
  };
}

export function decryptSessionData(encryptedData: { ciphertext: string; iv: string; tag: string }) {
  const ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY;
  if (!ENCRYPTION_KEY) throw new Error('SESSION_ENCRYPTION_KEY not set');
  const keyBuffer = Buffer.from(ENCRYPTION_KEY, 'hex');
  if (keyBuffer.length !== 32) throw new Error('SESSION_ENCRYPTION_KEY must be 32 bytes (hex-encoded)');
  const iv = Buffer.from(encryptedData.iv, 'base64');
  const encrypted = Buffer.from(encryptedData.ciphertext, 'base64');
  const authTag = Buffer.from(encryptedData.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.createSecretKey(keyBuffer), iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

export async function persistEncryptedSessionData(session: SessionData, stateDir: string = './data'): Promise<string> {
  const dir = pathModule.join(stateDir, 'diagnostics');
  await fs.promises.mkdir(dir, { recursive: true });
  const payload = encryptSessionData(session);
  const filename = `session_diag_${Date.now()}.json`;
  const filePath = pathModule.join(dir, filename);
  await fs.promises.writeFile(filePath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
  return filename;
}
