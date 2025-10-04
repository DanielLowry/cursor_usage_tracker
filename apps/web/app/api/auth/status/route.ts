import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { z } from 'zod';
import { CursorAuthManager } from '../../../../../../packages/shared/cursor-auth/src';
import { sessionStore } from '../../../../lib/utils/file-session-store';

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

    // First, check the session file
    const mostRecentSession = sessionStore.readSessionFile();
    if (mostRecentSession) {
      console.log('Found session file:', mostRecentSession.filename);
    }

    // First check the stored state - but only trust it if it's very recent (within 5 minutes)
    // and only if it was verified by a successful live check
    const storedState = await authManager.loadState();
    if (storedState?.isAuthenticated && !(await authManager.isSessionExpired())) {
      const lastChecked = new Date(storedState.lastChecked);
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      // Only trust stored state if it's very recent (5 minutes) and was from a successful live check
      if (lastChecked > fiveMinutesAgo && storedState.source === 'live_check' && !storedState.error) {
        return NextResponse.json({
          isAuthenticated: true,
          lastChecked: storedState.lastChecked,
          source: 'stored_state',
          sessionFile: mostRecentSession?.filename
        });
      }
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

      // Check if we can actually access the usage data
      const currentUrl = page.url();
      
      // Wait for the page to load and check for usage data or login redirect
      await page.waitForTimeout(3000); // Give time for the dashboard to load
      
      // Check if we're redirected to login
      const isRedirectedToLogin = currentUrl.includes('login') || 
                                 currentUrl.includes('auth') || 
                                 currentUrl.includes('authenticator.cursor.sh');
      
      // If not redirected, check if we can see usage data (not just the loading screen)
      let hasUsageData = false;
      if (!isRedirectedToLogin) {
        try {
          // Look for usage-related elements that would indicate we're actually logged in
          // and can see the dashboard content
          const usageElements = await page.locator('[data-testid*="usage"], .usage, [class*="usage"], [id*="usage"]').count();
          const hasDashboardContent = await page.locator('text=Loading Dashboard').count() === 0;
          const hasUserInfo = await page.locator('text=@').count() > 0; // Look for email indicator
          
          hasUsageData = usageElements > 0 || (hasDashboardContent && hasUserInfo);
        } catch (error) {
          console.warn('Error checking for usage data:', error);
        }
      }
      
      const isAuthenticated = !isRedirectedToLogin && hasUsageData;

      // Update stored state with source information
      const errorMessage = isAuthenticated ? undefined : 
        (isRedirectedToLogin ? 'Redirected to login - session expired' : 'Cannot access usage data - not authenticated');
      
      // Save the full state including source
      const currentState = await authManager.loadState();
      const newState = {
        isAuthenticated,
        lastChecked: new Date().toISOString(),
        source: 'live_check' as const,
        sessionCookies: currentState?.sessionCookies,
        userAgent: currentState?.userAgent,
        lastLogin: currentState?.lastLogin,
        expiresAt: currentState?.expiresAt,
        ...(errorMessage && { error: errorMessage }),
      };
      await authManager.saveState(newState);

      // When returning the final response, include the session filename if available
      return NextResponse.json({
        isAuthenticated,
        lastChecked: new Date().toISOString(),
        source: 'live_check',
        sessionFile: mostRecentSession?.filename,
        ...(isAuthenticated ? {} : { error: errorMessage })
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
