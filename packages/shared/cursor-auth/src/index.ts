// Relative path: packages/shared/cursor-auth/src/index.ts

import * as fs from 'fs';
import * as pathModule from 'path';
import * as crypto from 'crypto';
import { RawCookie, SessionData, buildCookieHeader, deriveRawCookiesFromSessionData, CursorAuthState, AuthSession } from './AuthSession';
// Re-export helpers from AuthSession so consumers can import from the package root
export { validateRawCookies, persistEncryptedSessionData, deriveRawCookiesFromSessionData, buildCookieHeader } from './AuthSession';

// Schema for Cursor authentication state
// const CursorAuthStateSchema = z.object({
//   isAuthenticated: z.boolean(),
//   lastChecked: z.string(),
//   sessionCookies: z.array(z.object({
//     name: z.string(),
//     value: z.string(),
//     domain: z.string(),
//     path: z.string(),
//     expires: z.number().optional(),
//     httpOnly: z.boolean().optional(),
//     secure: z.boolean().optional(),
//     sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
//   })).optional(),
//   userAgent: z.string().optional(),
//   lastLogin: z.string().optional(),
//   expiresAt: z.string().optional(),
//   source: z.enum(['stored_state', 'live_check']).optional(),
//   error: z.string().optional(),
// });

// export type CursorAuthState = z.infer<typeof CursorAuthStateSchema>;

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
// export class CursorAuthManager {
//   private statePath: string;

//   constructor(stateDir: string = './data') {
//     this.statePath = pathModule.join(stateDir, 'cursor.state.json');
//   }

//   /**
//    * Load the current authentication state
//    */
//   async loadState(): Promise<CursorAuthState | null> {
//     const enableDebug = process.env.DEBUG_AUTH === '1';
//     try {
//       const resolvedDir = pathModule.resolve(pathModule.dirname(this.statePath));
//       const fullPath = this.statePath;
//       if (enableDebug) {
//         console.log('cursor-auth: loadState resolvedDir=', resolvedDir);
//         console.log('cursor-auth: loadState fullPath=', fullPath);
//       }

//       if (!fs.existsSync(fullPath)) {
//         if (enableDebug) console.log('cursor-auth: loadState file does not exist');
//         return null;
//       }

//       const content = await fs.promises.readFile(fullPath, 'utf-8');
//       if (enableDebug) {
//         try {
//           const stat = fs.statSync(fullPath);
//           console.log('cursor-auth: loadState fileSize=', stat.size, 'modified=', stat.mtime.toISOString());
//         } catch (e) {}
//       }
//       const parsed = JSON.parse(content);
//       const state = CursorAuthStateSchema.parse(parsed);
//       if (enableDebug) {
//         console.log('cursor-auth: loadState parsed sessionCookies count=', (state.sessionCookies || []).length);
//       }
//       return state;
//     } catch (error) {
//       if (process.env.DEBUG_AUTH === '1') console.warn('cursor-auth: Failed to load cursor auth state:', error);
//       return null;
//     }
//   }

//   /**
//    * Save the authentication state
//    */
//   async saveState(state: CursorAuthState): Promise<void> {
//     try {
//       // Ensure directory exists
//       const dir = pathModule.dirname(this.statePath);
//       await fs.promises.mkdir(dir, { recursive: true });
      
//       // Validate state before saving
//       const validatedState = CursorAuthStateSchema.parse(state);
//       // Atomic write: write to a temp file then rename
//       const tempPath = this.statePath + `.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
//       const payload = JSON.stringify(validatedState, null, 2);
//       console.log('cursor-auth: saveState writing temp file:', tempPath);
//       await fs.promises.writeFile(tempPath, payload, { encoding: 'utf8', mode: 0o600 });
//       await fs.promises.rename(tempPath, this.statePath);
//       console.log('cursor-auth: saveState replaced state file:', this.statePath);
//     } catch (error) {
//       console.error('Failed to save cursor auth state:', error);
//       throw error;
//     }
//   }

//   /**
//    * Update authentication status
//    */
//   async updateAuthStatus(isAuthenticated: boolean, error?: string): Promise<void> {
//     const currentState = await this.loadState();
//     const newState: CursorAuthState = {
//       ...(currentState || {}),
//       isAuthenticated,
//       lastChecked: new Date().toISOString(),
//       source: 'live_check',
//       ...(error ? { error } : {}),
//     };

//     if (!error && 'error' in (newState as any)) {
//       delete (newState as any).error;
//     }

//     await this.saveState(newState);
//   }

//   // Note: Playwright-specific cookie save/apply helpers have been removed.

//   /**
//    * Save session cookies provided directly (no Playwright dependency)
//    */
//   async saveSessionCookiesRaw(cookies: Array<RawCookie>): Promise<void> {
//     try {
//       const normalized = (cookies || [])
//         .filter(Boolean)
//         .map((c) => ({
//           name: String(c.name),
//           value: String(c.value ?? ''),
//           domain: String(c.domain ?? ''),
//           path: String(c.path ?? '/'),
//           ...(typeof c.expires === 'number' ? { expires: c.expires } : {}),
//           ...(typeof c.httpOnly === 'boolean' ? { httpOnly: c.httpOnly } : {}),
//           ...(typeof c.secure === 'boolean' ? { secure: c.secure } : {}),
//           ...(c.sameSite ? { sameSite: c.sameSite } : {}),
//         }));

//       const currentState = await this.loadState();
//       const newState: CursorAuthState = {
//         ...(currentState || {}),
//         isAuthenticated: true,
//         lastChecked: new Date().toISOString(),
//         sessionCookies: normalized,
//         lastLogin: new Date().toISOString(),
//         source: 'live_check',
//       };

//       if ('error' in (newState as any)) {
//         delete (newState as any).error;
//       }

//       await this.saveState(newState);
//     } catch (error) {
//       console.error('Failed to save raw session cookies:', error);
//       throw error;
//     }
//   }

//   // Note: Playwright-specific cookie application has been removed.

//   /**
//    * Check if session is likely expired
//    */
//   async isSessionExpired(): Promise<boolean> {
//     const state = await this.loadState();
//     if (!state?.expiresAt) {
//       return false;
//     }
    
//     return new Date() > new Date(state.expiresAt);
//   }

//   /**
//    * Clear authentication state
//    */
//   async clearState(): Promise<void> {
//     try {
//       if (fs.existsSync(this.statePath)) {
//         await fs.promises.unlink(this.statePath);
//       }
//     } catch (error) {
//       console.warn('Failed to clear auth state:', error);
//     }
//   }

//   /**
//    * Get state file path
//    */
//   getStatePath(): string {
//     const dir = pathModule.dirname(this.statePath);
//     if (!fs.existsSync(dir)) {
//       try { fs.mkdirSync(dir, { recursive: true }); } catch {}
//     }
//     return this.statePath;
//   }
// }

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

