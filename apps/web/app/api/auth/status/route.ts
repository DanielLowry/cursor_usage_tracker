import { NextResponse } from 'next/server';
// Ensure this route runs in the Node runtime and import Playwright dynamically
export const runtime = 'nodejs';

// Playwright is a heavy native dependency that should not be bundled for the Edge/worker runtime.
// Import it dynamically inside the handler so the Next build step doesn't try to bundle it.
import { z } from 'zod';
import { CursorAuthManager } from '../../../../../../packages/shared/cursor-auth/src';
import { sessionStore } from '../../../../lib/utils/file-session-store';
import {
  detectAuthFromSession,
  hydrateContextWithSessionData,
  setupPageDebugHooks,
  navigateToUsage,
  saveDebugArtifacts,
  dumpContextCookies,
  readAndLogPageStorage,
  logSelectorPresence,
  evaluateLoginStatus,
  getLoginSelectors,
  isStoredStateValid,
} from './helpers';

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

// helpers moved to ./helpers

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
      const { valid, details } = isStoredStateValid(storedState);
      console.log('State Check Details:', JSON.stringify(details, null, 2));
      console.log('Is Stored State Valid:', valid);

      if (valid) {
        console.log('Returning authenticated state from stored state');
        return NextResponse.json({
          isAuthenticated: true,
          lastChecked: storedState.lastChecked,
          source: 'stored_state',
          sessionFile: mostRecentSession?.filename
        });
      } else {
        console.log('Stored state is not valid. Reasons:', {
          notRecent: details ? !details.isRecent : true,
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
      await hydrateContextWithSessionData(context, authManager, mostRecentSession?.data);

      // Improved Playwright-based authentication check
      const page = await context.newPage();

      // Playwright page / network debug hooks
      setupPageDebugHooks(page);

      // Define login and logout selectors
      const { loginSelectors, loginFailSelectors } = getLoginSelectors();

      // Navigate and wait for page readiness
      await navigateToUsage(page, env.CURSOR_USAGE_URL);

      // Save debug artifacts (screenshot + HTML)
      await saveDebugArtifacts(page);

      // Dump cookies and storage for diagnosis
      await dumpContextCookies(context);
      await readAndLogPageStorage(page);

      // Log which selectors (if any) are present on the page
      await logSelectorPresence(page, loginSelectors, loginFailSelectors);

      // Attempt to detect login status using Playwright's native waiters
      const loginStatus = await evaluateLoginStatus(page, loginSelectors, loginFailSelectors);

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
