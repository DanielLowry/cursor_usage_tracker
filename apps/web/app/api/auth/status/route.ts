import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { z } from 'zod';
import { CursorAuthManager } from '../../../../../../packages/shared/cursor-auth/src';

const envSchema = z.object({
  CURSOR_AUTH_STATE_DIR: z.string().min(1).default('./data'),
  CURSOR_USAGE_URL: z.string().url().default('https://cursor.com/dashboard?tab=usage'),
});

export async function GET() {
  try {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      return NextResponse.json({
        isAuthenticated: false,
        lastChecked: new Date().toISOString(),
        error: `Invalid environment: ${parsed.error.message}`
      }, { status: 500 });
    }
    const env = parsed.data;
    const authManager = new CursorAuthManager(env.CURSOR_AUTH_STATE_DIR);

    // First check the stored state
    const storedState = await authManager.loadState();
    if (storedState?.isAuthenticated && !(await authManager.isSessionExpired())) {
      return NextResponse.json({
        isAuthenticated: true,
        lastChecked: storedState.lastChecked,
        source: 'stored_state'
      });
    }

    // If no valid stored state, do a live check
    const context = await chromium.launchPersistentContext('./data/temp-profile', {
      headless: true,
    });

    try {
      const page = await context.newPage();
      
      // Apply any saved cookies first
      await authManager.applySessionCookies(context);
      
      // Navigate to the dashboard and check if we're redirected to login
      await page.goto(env.CURSOR_USAGE_URL, { 
        waitUntil: 'domcontentloaded',
        timeout: 10000 
      });

      // Check if we're still on the dashboard (not redirected to login)
      const currentUrl = page.url();
      const isAuthenticated = !currentUrl.includes('login') && !currentUrl.includes('auth') && !currentUrl.includes('authenticator.cursor.sh');

      // Update stored state
      await authManager.updateAuthStatus(isAuthenticated, isAuthenticated ? undefined : 'Redirected to login - session may have expired');

      return NextResponse.json({
        isAuthenticated,
        lastChecked: new Date().toISOString(),
        source: 'live_check',
        ...(isAuthenticated ? {} : { error: 'Redirected to login - session may have expired' })
      });

    } finally {
      await context.close();
    }

  } catch (error) {
    console.error('Auth status check failed:', error);
    return NextResponse.json({
      isAuthenticated: false,
      lastChecked: new Date().toISOString(),
      error: `Auth check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500 });
  }
}
