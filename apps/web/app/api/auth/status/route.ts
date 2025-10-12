// Relative path: apps/web/app/api/auth/status/route.ts

import { NextResponse } from 'next/server';
// Ensure this route runs in the Node runtime and import Playwright dynamically
export const runtime = 'nodejs';

import { z } from 'zod';
import { validateRawCookies, readRawCookies } from '../../../../../../packages/shared/cursor-auth/src';

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

    // Read canonical cookie state and validate directly via shared helper
    const cookies = await readRawCookies(env.CURSOR_AUTH_STATE_DIR);
    const apiProof = await validateRawCookies(cookies);

    const responseBody = {
      isAuthenticated: apiProof.ok,
      lastChecked: new Date().toISOString(),
      source: 'live_check' as const,
      sessionDetection: null,
      sessionFile: null,
      verification: {
        status: apiProof.status ?? null,
        reason: apiProof.reason ?? null,
        hasUser: apiProof.ok,
        keys: (apiProof as any).keys ?? [],
        contentType: (apiProof as any).contentType ?? null
      },
      usageSummary: (apiProof as any).usageSummary ?? null
    };

    const httpStatus = apiProof.ok
      ? 200
      : (apiProof.status === 401 || apiProof.status === 403 ? (apiProof.status as number) : 401);

    const responseWithError = apiProof.ok
      ? responseBody
      : { ...responseBody, error: apiProof.reason || 'Cannot access usage data - not authenticated' };

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
