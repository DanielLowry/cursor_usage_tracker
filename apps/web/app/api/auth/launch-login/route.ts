import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { z } from 'zod';

const envSchema = z.object({
  PLAYWRIGHT_USER_DATA_DIR: z.string().min(1),
  CURSOR_AUTH_URL: z.string().url().default('https://authenticator.cursor.sh/'),
});

export async function POST() {
  try {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: `Invalid environment: ${parsed.error.message}`
      }, { status: 500 });
    }
    const env = parsed.data;

    // Launch a headed browser context for manual login
    const context = await chromium.launchPersistentContext(env.PLAYWRIGHT_USER_DATA_DIR, {
      headless: false, // Must be false for user interaction
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    });

    try {
      const page = await context.newPage();
      
      // Navigate to the Cursor authentication page
      await page.goto(env.CURSOR_AUTH_URL, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });

      // Keep the browser open for user interaction
      // The context will persist the session cookies when the user logs in
      console.log('Login browser launched - user can now authenticate');
      
      return NextResponse.json({
        success: true,
        message: 'Login browser launched successfully. Please complete authentication in the opened window.'
      });

    } catch (error) {
      console.error('Failed to launch login browser:', error);
      return NextResponse.json({
        success: false,
        error: `Failed to launch login browser: ${error instanceof Error ? error.message : 'Unknown error'}`
      }, { status: 500 });
    }

    // Note: We don't close the context here - it stays open for user interaction
    // The session will be saved to the persistent profile directory

  } catch (error) {
    console.error('Login launch failed:', error);
    return NextResponse.json({
      success: false,
      error: `Login launch failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500 });
  }
}
