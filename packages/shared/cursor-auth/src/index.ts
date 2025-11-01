// Relative path: packages/shared/cursor-auth/src/index.ts

import * as fs from 'fs';
import * as pathModule from 'path';
import * as crypto from 'crypto';
import { RawCookie, SessionData, buildCookieHeader, deriveRawCookiesFromSessionData, CursorAuthState, AuthSession, validateRawCookies } from './AuthSession';
// Re-export helpers from AuthSession so consumers can import from the package root
export { validateRawCookies, persistEncryptedSessionData, deriveRawCookiesFromSessionData, buildCookieHeader } from './AuthSession';


// --- Shared helper APIs ---------------------------------------------------

/**
 * readRawCookies
 *
 * Purpose:
 * - Load RawCookies from the canonical state file managed by AuthSession.
 *
 * Inputs:
 * - stateDir?: string directory containing `cursor.state.json` (default: ./data)
 *
 * Outputs:
 * - Promise<Array<RawCookie>> possibly empty if state file missing or invalid.
 */
export async function readRawCookies(stateDir: string = './data'): Promise<RawCookie[]> {
  const resolvedDir = pathModule.resolve(stateDir);
  const fullPath = pathModule.join(resolvedDir, 'cursor.state.json');

  // Preserve original logging messages for parity with previous behavior
  console.log('cursor-auth: readRawCookies resolved dir:', resolvedDir);
  console.log('cursor-auth: readRawCookies full path:', fullPath);
  const exists = fs.existsSync(fullPath);
  console.log('cursor-auth: readRawCookies file exists:', exists);

  try {
    const authSession = new AuthSession(stateDir);
    const state = await authSession.load();
    const cookies = (state && state.sessionCookies) || [];
    console.log('cursor-auth: readRawCookies cookie count:', cookies.length);
    return cookies;
  } catch (e) {
    console.log('cursor-auth: readRawCookies failed:', (e as any).message ?? String(e));
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
  const authSession = new AuthSession(stateDir);
  console.log('cursor-auth: writeRawCookiesAtomic delegating to saveSessionCookiesRaw');

  // Normalize cookies to match the CursorAuthState schema (ensure required fields)
  const normalized = (cookies || []).filter(Boolean).map((c) => ({
    name: String(c.name),
    value: String(c.value ?? ''),
    domain: String(c.domain ?? ''),
    path: String(c.path ?? '/'),
    ...(typeof c.expires === 'number' ? { expires: c.expires } : {}),
    ...(typeof c.httpOnly === 'boolean' ? { httpOnly: c.httpOnly } : {}),
    ...(typeof c.secure === 'boolean' ? { secure: c.secure } : {}),
    ...(c.sameSite ? { sameSite: c.sameSite } : {}),
  }));

  await authSession.writeAtomically({
    isAuthenticated: true,
    lastChecked: new Date().toISOString(),
    sessionCookies: normalized,
    lastLogin: new Date().toISOString(),
    source: 'live_check',
  });
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
// Encryption helpers and diagnostics persistence are implemented in AuthSession.
// Re-exported above from './AuthSession'.

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
  try {
    // Read canonical cookies (this will log resolved dir / full path / existence / cookie count)
    const cookies = await readRawCookies(stateDir);
    const header = buildCookieHeader(cookies);
    const result = (header ? { Cookie: header } : {}) as Record<string, string>;
    console.log('cursor-auth: getAuthHeaders length:', header ? header.length : 0);
    if (header) console.log('cursor-auth: getAuthHeaders preview:', header.substring(0, 50) + '...');
    return result;
  } catch (e) {
    console.log('cursor-auth: getAuthHeaders failed:', (e as any).message ?? String(e));
    return {} as Record<string, string>;
  }
}

/**
 * verifyAuthState
 *
 * Convenience wrapper that reads canonical raw cookies and validates them
 * against the usage-summary API using the existing validateRawCookies helper.
 */
export async function verifyAuthState(stateDir: string = './data') {
  const cookies = await readRawCookies(stateDir);
  const proof = await validateRawCookies(cookies);
  return { cookies, proof };
}

