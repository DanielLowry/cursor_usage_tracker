import fs from 'fs';
import path from 'path';
import { CursorAuthManager } from '../../../../../../packages/shared/cursor-auth/src';

// Heuristic helper to detect whether a session file likely contains auth info
export function detectAuthFromSession(sessionData: any) {
  const matched: string[] = [];
  let hasAuthData = false;
  let hasTokens = false;

  console.log('detectAuthFromSession: entry, keys:', sessionData && typeof sessionData === 'object' ? Object.keys(sessionData) : typeof sessionData);

  if (!sessionData || typeof sessionData !== 'object') {
    console.log('detectAuthFromSession: no session object present');
    return { hasAuthData, hasTokens, matched };
  }

  // Inspect cookies (array or object)
  const cookies = (sessionData as any).cookies || (sessionData as any).Cookies || [];
  if (Array.isArray(cookies)) {
    for (const c of cookies) {
      if (!c) continue;
      const name = (c.name || c.key || '').toString();
      const value = (c.value || c.val || c.cookie || '').toString();
      if (/(sess|session|jwt|token|access|id)/i.test(name) || /^eyJ/.test(value)) {
        hasAuthData = true;
        if (/token|jwt|eyJ/.test(name + ' ' + value)) hasTokens = true;
        matched.push(`cookie:${name || '<unnamed>'}`);
        console.log('detectAuthFromSession: cookie matched', { name, valueSnippet: value.slice(0, 40) });
        break;
      }
    }
  }

  // Inspect localStorage / sessionStorage (could be object or array of pairs)
  const storageCandidates = ['localStorage', 'sessionStorage'];
  for (const key of storageCandidates) {
    const storage = (sessionData as any)[key];
    if (!storage) continue;

    // Handle array of { key, value }
    if (Array.isArray(storage)) {
      for (const entry of storage) {
        const k = (entry && (entry.key || entry.name || entry.k) || '').toString();
        const v = (entry && (entry.value || entry.val || entry.v) || '').toString();
        if (/(token|access|refresh|auth|user|cursor)/i.test(k) || /^eyJ/.test(v)) {
          hasAuthData = true;
          if (/token|jwt|eyJ/.test(k + ' ' + v)) hasTokens = true;
          matched.push(`${key}:${k || '<unnamed>'}`);
          console.log('detectAuthFromSession: storage matched', { storage: key, key: k, valueSnippet: v.slice(0, 40) });
        }
      }
    } else if (typeof storage === 'object') {
      for (const k of Object.keys(storage)) {
        const v = String((storage as any)[k] ?? '');
        if (/(token|access|refresh|auth|user|cursor)/i.test(k) || /^eyJ/.test(v)) {
          hasAuthData = true;
          if (/token|jwt|eyJ/.test(k + ' ' + v)) hasTokens = true;
          matched.push(`${key}:${k}`);
          console.log('detectAuthFromSession: storage object matched', { storage: key, key: k, valueSnippet: v.slice(0, 40) });
        }
      }
    }
  }

  // Timestamp presence isn't auth by itself but is useful metadata
  if ((sessionData as any).timestamp || (sessionData as any).createdAt) {
    matched.push('hasTimestamp');
  }

  console.log('detectAuthFromSession: result', { hasAuthData, hasTokens, matched });
  return { hasAuthData, hasTokens, matched };
}

export async function applyUploadedSessionCookies(ctx: any, session: any) {
  if (!session) return;
  const candidates: any[] = [];

  // Common shapes: { cookies: [...] } or top-level array
  const rawCookies = (session as any).cookies || (session as any).Cookies || (session as any).cookieStore || null;
  if (Array.isArray(rawCookies)) {
    candidates.push(...rawCookies);
  } else if (Array.isArray(session)) {
    candidates.push(...session);
  }

  if (candidates.length === 0) return;

  const toPlaywright = (c: any) => {
    const name = c.name || c.key;
    const value = c.value || c.val || c.cookie;
    if (!name || value === undefined) return null;
    let domain = c.domain || c.Domain;
    if (domain && typeof domain === 'string' && domain.startsWith('.')) {
      domain = domain.slice(1); // normalize leading dot
    }
    const path = c.path || '/';
    const expires = typeof c.expires === 'number' ? c.expires : undefined;
    const secure = Boolean(c.secure);
    const httpOnly = Boolean(c.httpOnly || c.httponly);

    const normalizeSameSite = (raw: any) => {
      if (raw == null) return undefined;
      const s = String(raw).trim().toLowerCase();
      if (s === 'strict') return 'Strict';
      if (s === 'lax') return 'Lax';
      if (s === 'none') return 'None';
      return undefined;
    };

    // Playwright cookie shape (use url fallback when domain is missing)
    const cookie: any = {
      name: String(name),
      value: String(value),
      path: String(path),
      expires,
      secure,
      httpOnly,
      sameSite: normalizeSameSite(c.sameSite ?? c.same_site ?? c.sameSitePolicy),
    };
    if (domain) cookie.domain = String(domain);
    if (!domain) cookie.url = 'https://cursor.com';
    return cookie;
  };

  const converted = candidates.map(toPlaywright).filter(Boolean);
  if (converted.length > 0) {
    const httpOnlyCount = converted.filter((c: any) => !!c.httpOnly).length;
    console.log('applyUploadedSessionCookies: applying cookies from uploaded session', {
      candidateCount: candidates.length,
      applyingCount: converted.length,
      httpOnlyCount,
      sample: converted.slice(0, 5).map((c: any) => ({ name: c.name, domain: c.domain, url: c.url }))
    });
    try {
      await ctx.addCookies(converted as any);
    } catch (e) {
      console.warn('Failed to apply some uploaded session cookies:', e);
    }
  }
}

export async function hydrateContextWithSessionData(context: any, authManager: any, sessionData: any) {
  const before = await context.cookies().catch(() => []);
  // Apply cookies that were previously saved by the auth manager (minimal reusable state)
  await authManager.applySessionCookies(context);
  // If uploaded session contains cookie-like data, attempt to apply it
  await applyUploadedSessionCookies(context, sessionData);
  const after = await context.cookies().catch(() => []);
  const addedCount = Math.max(0, (after?.length || 0) - (before?.length || 0));
  console.log('hydrateContextWithSessionData: cookie application summary', {
    beforeCount: before?.length || 0,
    afterCount: after?.length || 0,
    addedCount
  });
}

// API-first verification: request usage summary using context-bound cookies and validate shape
export async function checkUsageSummaryWithContext(context: any) {
  try {
    const page = await context.newPage();
    // Use page.request bound to this context so cookies apply
    const r = await page.request.get('https://cursor.com/api/usage-summary', { failOnStatusCode: false });
    const status = r.status();
    const contentType = (r.headers()['content-type'] || '').toLowerCase();
    let json: any = null;
    let textSample = '';
    try {
      json = await r.json();
    } catch {
      try { textSample = (await r.text()).slice(0, 200); } catch {}
    }
    await page.close().catch(() => {});

    const isHtml = /text\/html/.test(contentType) || /<html|<body|<!doctype/i.test(textSample);
    if (isHtml) return { ok: false, status, reason: 'html_response', keys: [], contentType, textSample };
    if (status === 401 || status === 403) return { ok: false, status, reason: `status:${status}`, keys: [], contentType };
    if (status !== 200) return { ok: false, status, reason: `status:${status}`, keys: [], contentType };
    const isObject = json && typeof json === 'object' && !Array.isArray(json);
    if (!isObject) return { ok: false, status, reason: 'invalid_json', keys: [], contentType };
    const keys = Object.keys(json || {});
    const required = ['billingCycleStart', 'billingCycleEnd', 'membershipType'];
    const hasRequired = required.every(k => k in (json || {}));
    if (!hasRequired) return { ok: false, status, reason: 'missing_fields', keys, contentType };
    return { ok: true, status, reason: 'api_ok', keys, contentType };
  } catch (e) {
    return { ok: false, status: 0, reason: `fetch_error:${e instanceof Error ? e.message : String(e)}`, keys: [], contentType: '' };
  }
}

export function setupPageDebugHooks(page: any) {
  page.on('console', (msg: any) => console.log('PAGE_CONSOLE:', msg.type(), msg.text()));
  page.on('requestfailed', (req: any) => {
    const f = req.failure();
    console.log('REQ_FAILED:', req.url(), f ? f.errorText : '');
  });
  page.on('response', (res: any) => console.log('PAGE_RESPONSE:', res.status(), res.url()));
}

export async function navigateToUsage(page: any, url: string) {
  console.log('Navigating to usage URL:', url);
  const navigationStartTime = Date.now();
  const resp = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 15000
  });
  const navigationEndTime = Date.now();
  console.log(`Page navigation completed in ${navigationEndTime - navigationStartTime}ms`);
  console.log('Navigation response:', resp ? resp.status() : 'no response');
  try {
    console.log('Page URL after navigation:', page.url());
  } catch (e) {
    console.log('Page URL after navigation: <unavailable>', String(e));
  }

  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 });
  } catch (e) {
    const errMsg = e && typeof e === 'object' && 'message' in (e as any) ? (e as any).message : String(e);
    console.log('networkidle wait timed out or failed:', errMsg);
  }
}

export async function saveDebugArtifacts(page: any) {
  try {
    fs.mkdirSync('./data/debug', { recursive: true });
    const timestamp = Date.now();
    await page.screenshot({ path: `./data/debug/${timestamp}-page.png`, fullPage: true });
    const html = await page.content();
    fs.writeFileSync(`./data/debug/${timestamp}-page.html`, html);
    console.log('Saved debug screenshot and HTML to ./data/debug');
  } catch (e) {
    console.warn('Failed to save debug artifacts:', e);
  }
}

export async function dumpContextCookies(context: any) {
  try {
    const allCookies = await context.cookies();
    console.log('Context cookies:', JSON.stringify(allCookies, null, 2));
  } catch (e) {
    console.warn('Failed to read cookies:', e);
  }
}

export async function readAndLogPageStorage(page: any) {
  try {
    const storage = await page.evaluate(() => {
      return {
        localStorage: Object.keys(localStorage).reduce((acc: any, k: string) => { acc[k] = localStorage.getItem(k); return acc; }, {}),
        sessionStorage: Object.keys(sessionStorage).reduce((acc: any, k: string) => { acc[k] = sessionStorage.getItem(k); return acc; }, {})
      };
    });
    console.log('page storage:', JSON.stringify(storage, null, 2));
  } catch (e) {
    console.warn('Failed to read page storage:', e);
  }
}

export async function logSelectorPresence(page: any, loginSelectors: string[], loginFailSelectors: string[]) {
  for (const sel of loginSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const visible = await el.isVisible().catch(() => false);
        console.log('Matched login success selector:', sel, 'visible:', visible);
        break;
      }
    } catch {
      /* ignore selector probe errors */
    }
  }
  for (const sel of loginFailSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const visible = await el.isVisible().catch(() => false);
        console.log('Matched login failure selector:', sel, 'visible:', visible);
        break;
      }
    } catch {
      /* ignore selector probe errors */
    }
  }
}

export async function evaluateLoginStatus(page: any, loginSelectors: string[], loginFailSelectors: string[]) {
  let loginStatus = false;
  try {
    const loginResult = await Promise.race([
      page.waitForSelector(loginSelectors.join(', '), {
        state: 'visible',
        timeout: 10000
      }).then(() => true).catch(() => false),

      page.waitForSelector(loginFailSelectors.join(', '), {
        state: 'visible',
        timeout: 10000
      }).then(() => false).catch(() => null)
    ]);

    loginStatus = loginResult === true;
    console.log('Login Status (resolved):', loginStatus, loginStatus ? '(logged in)' : '(not logged in)');
  } catch (detectionError) {
    console.warn('Login status detection inconclusive:', detectionError);
    loginStatus = false;
  }
  return loginStatus;
}

export function getLoginSelectors() {
  const loginSelectors = [
    '.user-profile',
    '#dashboard-content',
  ];
  const loginFailSelectors = [
    '.login-form',
    '[data-testid="login-page"]',
  ];
  return { loginSelectors, loginFailSelectors };
}

export function isStoredStateValid(storedState: any) {
  if (!storedState || !storedState.isAuthenticated) {
    return { valid: false, details: null as any };
  }
  const lastChecked = new Date(storedState.lastChecked);
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const details = {
    lastChecked: lastChecked.toISOString(),
    fiveMinutesAgo: fiveMinutesAgo.toISOString(),
    isRecent: lastChecked > fiveMinutesAgo,
    source: storedState.source,
    hasError: !!storedState.error
  };
  const valid = details.isRecent && storedState.source === 'live_check' && !details.hasError;
  return { valid, details };
}

// Shared Playwright-based live check used by status route and upload flow.
// Returns a compact result: { isAuthenticated, hasUser, status?, reason?, sessionDetection?, error? }
export async function runPlaywrightLiveCheck(sessionData: any) {
  try {
    const env = {
      CURSOR_AUTH_STATE_DIR: process.env.CURSOR_AUTH_STATE_DIR || './data',
      CURSOR_USAGE_URL: process.env.CURSOR_USAGE_URL || 'https://cursor.com/dashboard?tab=usage'
    };

    const authManager = new CursorAuthManager(env.CURSOR_AUTH_STATE_DIR);
    const sessionDetection = detectAuthFromSession(sessionData);

    // Dynamic import Playwright to avoid bundling in serverless builds
    const { chromium } = await import('playwright');
    const context = await chromium.launchPersistentContext('./data/temp-profile', { headless: true });

    try {
      if (sessionData) {
        console.log('runPlaywrightLiveCheck: applying uploaded session (redacted):', JSON.stringify({ keys: Object.keys(sessionData || {}), hasAuthData: sessionDetection.hasAuthData }, null, 2));
      }

      await hydrateContextWithSessionData(context, authManager, sessionData);

      // Single authoritative API verification to usage-summary
      const apiProof = await checkUsageSummaryWithContext(context);
      console.log('API proof: GET /api/usage-summary →', apiProof.status, '| keys:', (apiProof.keys || []).join(','), '| reason:', apiProof.reason);

      if (apiProof.ok) {
        try { await authManager.saveSessionCookies(context); } catch (e) { console.warn('runPlaywrightLiveCheck: saving session cookies failed:', e); }
        await authManager.updateAuthStatus(true);
        try { await context.close(); } catch (_) {}
        return {
          isAuthenticated: true,
          hasUser: true,
          status: apiProof.status,
          reason: apiProof.reason,
          keys: apiProof.keys,
          contentType: apiProof.contentType,
          sessionDetection
        };
      }

      // No DOM fallback: return diagnostics from API probe
      await authManager.updateAuthStatus(false, apiProof.reason);
      try { await context.close(); } catch (_) {}
      return {
        isAuthenticated: false,
        hasUser: false,
        status: apiProof.status,
        reason: apiProof.reason,
        keys: apiProof.keys,
        contentType: apiProof.contentType,
        sessionDetection
      };
    } catch (liveErr) {
      console.error('runPlaywrightLiveCheck: live check failed:', liveErr);
      try { await context.close(); } catch (_) {}
      await authManager.updateAuthStatus(false, `Live check failed: ${liveErr instanceof Error ? liveErr.message : String(liveErr)}`);
      return { isAuthenticated: false, hasUser: false, status: null, reason: liveErr instanceof Error ? liveErr.message : String(liveErr), keys: [], contentType: '', sessionDetection };
    }
  } catch (err) {
    console.error('runPlaywrightLiveCheck: setup failed:', err);
    return { isAuthenticated: false, hasUser: false, status: null, reason: err instanceof Error ? err.message : String(err), keys: [], contentType: '' };
  }
}


