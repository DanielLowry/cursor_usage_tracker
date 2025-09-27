import { NextRequest, NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { z } from 'zod';

const envSchema = z.object({
  PLAYWRIGHT_USER_DATA_DIR: z.string().min(1),
  CURSOR_USAGE_URL: z.string().url().default('https://cursor.com/dashboard?tab=usage'),
});

export async function GET(request: NextRequest) {
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

    // Launch a lightweight browser context to check auth status
    const context = await chromium.launchPersistentContext(env.PLAYWRIGHT_USER_DATA_DIR, {
      headless: true,
    });

    try {
      const page = await context.newPage();
      
      // Navigate to the dashboard and check if we're redirected to login
      // This is a lightweight check - we don't wait for full page load
      await page.goto(env.CURSOR_USAGE_URL, { 
        waitUntil: 'domcontentloaded',
        timeout: 10000 
      });

      // Check if we're still on the dashboard (not redirected to login)
      const currentUrl = page.url();
      const isAuthenticated = !currentUrl.includes('login') && !currentUrl.includes('auth') && !currentUrl.includes('authenticator.cursor.sh');

      return NextResponse.json({
        isAuthenticated,
        lastChecked: new Date().toISOString(),
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
