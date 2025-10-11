// Relative path: apps/web/app/api/auth/launch-login/route.ts

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CursorAuthManager } from '../../../../../../packages/shared/cursor-auth/src';
// login-helper-scripts are not needed in this route; GET redirects to Cursor

const envSchema = z.object({
  CURSOR_AUTH_STATE_DIR: z.string().min(1).default('./data'),
  CURSOR_AUTH_URL: z.string().url().default('https://authenticator.cursor.sh/'),
});

export async function GET() {
  try {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error('Invalid environment in GET /api/auth/launch-login:', parsed.error.message);
      return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 500 });
    }
    const env = parsed.data;
    // Redirect the client to the configured Cursor auth URL for interactive login
    return NextResponse.redirect(env.CURSOR_AUTH_URL);
  } catch (error) {
    console.error('GET /api/auth/launch-login failed:', error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 });
  }
}

export async function POST() {
  try {
    // Deprecated: Previously launched Playwright for interactive login.
    // Now we redirect via GET to the external login page; POST is kept
    // for backward compatibility and returns guidance.
    return NextResponse.json({
      success: false,
      deprecated: true,
      message: 'Interactive login via Playwright has been removed. Use GET /api/auth/launch-login to redirect to the Cursor auth page, or upload session cookies via /api/auth/upload-session.'
    }, { status: 410 });

  } catch (error) {
    console.error('Login launch failed:', error);
    return NextResponse.json({
      success: false,
      error: `Login launch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500 });
  }
}
