import { NextResponse } from 'next/server';
// Ensure this route runs in the Node runtime and import Playwright dynamically
export const runtime = 'nodejs';

import { z } from 'zod';
import { CursorAuthManager } from '../../../../../../packages/shared/cursor-auth/src';
import { sessionStore } from '../../../../lib/utils/file-session-store';
import { detectAuthFromSession, runPlaywrightLiveCheck } from './helpers';

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

    // Always perform live authentication check via usage-summary
    console.log('Attempting live authentication check via runPlaywrightLiveCheck');

    const liveResult = await runPlaywrightLiveCheck(mostRecentSession?.data);
    console.log('Live result summary:', JSON.stringify(liveResult, null, 2));

    const responseBody = {
      isAuthenticated: liveResult.isAuthenticated,
      lastChecked: new Date().toISOString(),
      source: 'live_check' as const,
      sessionDetection: liveResult.sessionDetection ?? sessionDetection,
      sessionFile: mostRecentSession?.filename ?? null,
      verification: {
        status: liveResult.status ?? null,
        reason: liveResult.reason ?? null,
        hasUser: liveResult.hasUser ?? false,
        keys: (liveResult as any).keys ?? [],
        contentType: (liveResult as any).contentType ?? null
      }
    };

    const httpStatus = liveResult.isAuthenticated
      ? 200
      : (liveResult.status === 401 || liveResult.status === 403 ? (liveResult.status as number) : 401);

    const responseWithError = liveResult.isAuthenticated
      ? responseBody
      : { ...responseBody, error: liveResult.reason || 'Cannot access usage data - not authenticated' };

    return NextResponse.json(responseWithError, { status: httpStatus });
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
