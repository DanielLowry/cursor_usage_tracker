import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
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
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: `Invalid environment: ${parsed.error.message}`
      }, { status: 500 });
    }
    const env = parsed.data;
    const authManager = new CursorAuthManager(env.CURSOR_AUTH_STATE_DIR);

    // Launch a headed browser context for manual login
    const context = await chromium.launchPersistentContext('./data/temp-profile', {
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

      // Set up a listener to save session when user completes login
      page.on('response', async (response) => {
        const url = response.url();
        // If we get redirected back to dashboard, user likely logged in successfully
        if (url.includes('cursor.com/dashboard') || url.includes('cursor.com/account')) {
          try {
            await authManager.saveSessionCookies(context);
            console.log('Login detected - session saved to cursor.state.json');
          } catch (error) {
            console.warn('Failed to save session after login:', error);
          }
        }
      });

      console.log('Login browser launched - user can now authenticate');
      
      return NextResponse.json({
        success: true,
        message: 'Login browser launched successfully. Please complete authentication in the opened window. Session will be automatically saved.'
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
