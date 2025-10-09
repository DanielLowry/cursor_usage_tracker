import { NextResponse } from 'next/server';
// Ensure this route runs in the Node runtime and import Playwright dynamically
export const runtime = 'nodejs';

// Playwright is a heavy native dependency that should not be bundled for the Edge/worker runtime.
// Import it dynamically inside the handler so the Next build step doesn't try to bundle it.
import { z } from 'zod';
import { CursorAuthManager } from '../../../../../../packages/shared/cursor-auth/src';
import { sessionStore } from '../../../../lib/utils/file-session-store';

/**
 * Auth Status Route (Orchestrator)
 *
 * Responsibilities:
 * - Read the latest uploaded session artifact (decrypted by FileSessionStore)
 * - Hydrate Playwright context with previously saved cookies and any cookies present in the uploaded artifact
 * - Perform a live check against the Cursor dashboard
 * - On success: persist cookies and update the canonical auth state via CursorAuthManager
 * - On failure: update auth state with error context
 *
 * Note: Uploaded session artifacts are considered inputs. The distilled, minimal state
 * used by the rest of the app lives in `cursor.state.json` and is owned by CursorAuthManager.
 */

const envSchema = z.object({
  CURSOR_AUTH_STATE_DIR: z.string().min(1).default('./data'),
  CURSOR_USAGE_URL: z.string().url().default('https://cursor.com/dashboard?tab=usage'),
});

// Heuristic helper to detect whether a session file likely contains auth info
function detectAuthFromSession(sessionData: any) {
  const matched: string[] = [];
  let hasAuthData = false;
  let hasTokens = false;

  console.log('detectAuthFromSession: entry, keys:', sessionData && typeof sessionData === 'object' ? Object.keys(sessionData) : typeof sessionData);

  if (!sessionData || typeof sessionData !== 'object') {
    console.log('detectAuthFromSession: no session object present');
    return { hasAuthData, hasTokens, matched };
  }

  // Inspect cookies (array or object)
  const cookies = sessionData.cookies || sessionData.Cookies || [];
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
    const storage = sessionData[key];
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
  if (sessionData.timestamp || sessionData.createdAt) {
    matched.push('hasTimestamp');
  }

  console.log('detectAuthFromSession: result', { hasAuthData, hasTokens, matched });
  return { hasAuthData, hasTokens, matched };
}

export async function GET() {
  try {
    console.log('Starting authentication status check at:', new Date().toISOString());

    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error('Environment validation failed:', parsed.error.message);
      return NextResponse.json({
        isAuthenticated: false,
        lastChecked: new Date().toISOString(),
        error: `Invalid environment: ${parsed.error.message}`
      }, { status: 500 });
    }
    const env = parsed.data;
    console.log('Environment validated successfully');

    const authManager = new CursorAuthManager(env.CURSOR_AUTH_STATE_DIR);
    console.log('CursorAuthManager initialized with state dir:', env.CURSOR_AUTH_STATE_DIR);

    // First, check the session file
    const mostRecentSession = sessionStore.readSessionFile();
    //console.log('Most Recent Session:', mostRecentSession);
    
    const sessionKeys = Object.keys(mostRecentSession?.data || {});
    console.log("Session data keys", sessionKeys);

    // Run heuristic detector on the session file so we can log exactly what's present
    const sessionDetection = detectAuthFromSession(mostRecentSession?.data);
    console.log('Session detection summary:', JSON.stringify(sessionDetection, null, 2));

    if (mostRecentSession) {
      console.log('Raw Session File Contents (Redacted):', JSON.stringify({
        filename: mostRecentSession.filename,
        createdAt: mostRecentSession.data.createdAt,
        // Redact sensitive fields, show only structure
        keys: Object.keys(mostRecentSession.data),
        hasAuthData: sessionDetection.hasAuthData,
        hasTokens: sessionDetection.hasTokens,
        detectionMatches: sessionDetection.matched
      }, null, 2));
    } else {
      console.log('No session file found');
    }

    // Load stored authentication state
    const storedState = await authManager.loadState();
    console.log('Loaded Stored State:', JSON.stringify(storedState, null, 2));

    // Detailed logging for state check
    if (storedState?.isAuthenticated) {
      const lastChecked = new Date(storedState.lastChecked);
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      const stateCheckDetails = {
        lastChecked: lastChecked.toISOString(),
        fiveMinutesAgo: fiveMinutesAgo.toISOString(),
        isRecent: lastChecked > fiveMinutesAgo,
        source: storedState.source,
        hasError: !!storedState.error
      };
      
      console.log('State Check Details:', JSON.stringify(stateCheckDetails, null, 2));

      // Detailed conditions for trusting stored state
      const isValidStoredState = 
        lastChecked > fiveMinutesAgo && 
        storedState.source === 'live_check' && 
        !storedState.error;

      console.log('Is Stored State Valid:', isValidStoredState);

      if (isValidStoredState) {
        console.log('Returning authenticated state from stored state');
        return NextResponse.json({
          isAuthenticated: true,
          lastChecked: storedState.lastChecked,
          source: 'stored_state',
          sessionFile: mostRecentSession?.filename
        });
      } else {
        console.log('Stored state is not valid. Reasons:', {
          notRecent: lastChecked <= fiveMinutesAgo,
          wrongSource: storedState.source !== 'live_check',
          hasError: !!storedState.error
        });
      }
    } else {
      console.log('No valid stored authentication state found');
    }

    // If no valid stored state, do a live check
    console.log('Attempting live authentication check');

    // Dynamic import to avoid bundling Playwright into the edge/worker build output
    const { chromium } = await import('playwright');

    const context = await chromium.launchPersistentContext('./data/temp-profile', {
      headless: true,
    });

    // Log context creation details
    if (mostRecentSession?.data) {
      console.log('Session Data to be Applied (Redacted):', JSON.stringify({
        keys: Object.keys(mostRecentSession.data),
        hasAuthData: sessionDetection.hasAuthData,
        hasTokens: sessionDetection.hasTokens,
        detectionMatches: sessionDetection.matched,
        // Optionally, log any non-sensitive metadata about the session
        createdAt: mostRecentSession.data.createdAt
      }, null, 2));
    }

    // Before navigation: hydrate cookies from prior successful runs and uploaded session
    try {
      // Apply cookies that were previously saved by the auth manager (minimal reusable state)
      await authManager.applySessionCookies(context);

      // If uploaded session contains cookie-like data, attempt to apply it
      // We support a few common shapes and best-effort conversion
      const applyUploadedSessionCookies = async (ctx: any, session: any) => {
        if (!session) return;
        const candidates: any[] = [];

        // Common shapes: { cookies: [...] } or top-level array
        const rawCookies = session.cookies || session.Cookies || session.cookieStore || null;
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
          const domain = c.domain || c.Domain;
          const path = c.path || '/';
          const expires = typeof c.expires === 'number' ? c.expires : undefined;
          const secure = Boolean(c.secure);
          const httpOnly = Boolean(c.httpOnly || c.httponly);
          // Playwright cookie shape
          return {
            name: String(name),
            value: String(value),
            domain: domain ? String(domain) : undefined,
            path: String(path),
            expires,
            secure,
            httpOnly,
            sameSite: c.sameSite || undefined,
          };
        };

        const converted = candidates.map(toPlaywright).filter(Boolean);
        if (converted.length > 0) {
          try {
            await ctx.addCookies(converted as any);
          } catch (e) {
            console.warn('Failed to apply some uploaded session cookies:', e);
          }
        }
      };

      await applyUploadedSessionCookies(context, mostRecentSession?.data);

      // Improved Playwright-based authentication check
      const page = await context.newPage();
      
      console.log('Navigating to usage URL:', env.CURSOR_USAGE_URL);
      
      // Define login and logout selectors
      const loginSelectors = [
        '.user-profile',
        '#dashboard-content',
      ];
      
      const loginFailSelectors = [
        '.login-form',
        '[data-testid="login-page"]',
      ];
      
      // Navigate with extended timeout and wait for navigation
      const navigationStartTime = Date.now();
      await page.goto(env.CURSOR_USAGE_URL, { 
        waitUntil: 'domcontentloaded',
        timeout: 15000 
      });
      const navigationEndTime = Date.now();
      console.log(`Page navigation completed in ${navigationEndTime - navigationStartTime}ms`);

      // Attempt to detect login status using Playwright's native waiters
      let loginStatus = false;
      try {
        // Race between login success and login page selectors
        const loginResult = await Promise.race([
          // Wait for login success indicators
          page.waitForSelector(loginSelectors.join(', '), { 
            state: 'visible', 
            timeout: 10000 
          }).then(() => true).catch(() => false),
          
          // Wait for login page indicators
          page.waitForSelector(loginFailSelectors.join(', '), { 
            state: 'visible', 
            timeout: 10000 
          }).then(() => false).catch(() => null)
        ]);

        // Resolve login status
        loginStatus = loginResult === true;
        console.log('Login Status (resolved):', loginStatus, 
          loginStatus ? '(logged in)' : '(not logged in)'
        );
      } catch (detectionError) {
        console.warn('Login status detection inconclusive:', detectionError);
        loginStatus = false;
      }

      // Persist cookies and update auth state
      if (loginStatus) {
        try {
          await authManager.saveSessionCookies(context);
        } catch (e) {
          console.warn('Saving session cookies failed:', e);
        }
        await authManager.updateAuthStatus(true);
      } else {
        await authManager.updateAuthStatus(false, 'Cannot access usage data - not authenticated');
      }

      const responseBody = {
        isAuthenticated: loginStatus,
        lastChecked: new Date().toISOString(),
        source: 'live_check' as const,
        sessionDetection: sessionDetection,
        ...(loginStatus ? {} : { error: 'Cannot access usage data - not authenticated' })
      };
      return NextResponse.json(responseBody);

    } catch (liveCheckError) {
      console.error('Live authentication check failed:', liveCheckError);
      
      // Save failed state via auth manager (canonical)
      await authManager.updateAuthStatus(
        false,
        `Live check failed: ${liveCheckError instanceof Error ? liveCheckError.message : 'Unknown error'}`
      );

      const errorResponse = {
        isAuthenticated: false,
        lastChecked: new Date().toISOString(),
        source: 'live_check' as const,
        error: 'Live authentication check failed'
      };
      return NextResponse.json(errorResponse, { status: 500 });
    }
  } catch (error) {
    console.error('Complete authentication status check failed:', error);
    
    const finalErrorResponse = {
      isAuthenticated: false,
      lastChecked: new Date().toISOString(),
      error: 'Comprehensive authentication check failed'
    };
    return NextResponse.json(finalErrorResponse, { status: 500 });
  }
}
