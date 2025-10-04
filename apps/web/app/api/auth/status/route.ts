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
    if (mostRecentSession) {
      console.log('Found session file:', JSON.stringify({
        filename: mostRecentSession.filename,
        createdAt: mostRecentSession.data.createdAt
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
    const context = await chromium.launchPersistentContext('./data/temp-profile', {
      headless: true,
    });

    try {
      const page = await context.newPage();
      
      // Add more detailed logging for live check
      console.log('Navigating to usage URL:', env.CURSOR_USAGE_URL);
      await page.goto(env.CURSOR_USAGE_URL, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      });

      // Check for authentication indicators
      const isLoggedIn = await page.evaluate(() => {
        // Add specific checks for being logged in
        const loginIndicators = [
          document.querySelector('.user-profile'),
          document.querySelector('#dashboard-content'),
          // Add more specific selectors that indicate being logged in
        ];
        return loginIndicators.some(indicator => indicator !== null);
      });

      console.log('Live Check - Is Logged In:', isLoggedIn);

      // Close the context to free up resources
      await context.close();

      // Save the authentication state
      await authManager.saveState({
        isAuthenticated: isLoggedIn,
        lastChecked: new Date().toISOString(),
        source: 'live_check',
        ...(isLoggedIn ? {} : { error: 'Cannot access usage data - not authenticated' })
      });

      return NextResponse.json({
        isAuthenticated: isLoggedIn,
        lastChecked: new Date().toISOString(),
        source: 'live_check',
        ...(isLoggedIn ? {} : { error: 'Cannot access usage data - not authenticated' })
      });

    } catch (liveCheckError) {
      console.error('Live authentication check failed:', liveCheckError);
      
      // Save failed state
      await authManager.saveState({
        isAuthenticated: false,
        lastChecked: new Date().toISOString(),
        source: 'live_check',
        error: `Live check failed: ${liveCheckError instanceof Error ? liveCheckError.message : 'Unknown error'}`
      });

      return NextResponse.json({
        isAuthenticated: false,
        lastChecked: new Date().toISOString(),
        source: 'live_check',
        error: 'Live authentication check failed'
      }, { status: 500 });
    }
  } catch (error) {
    console.error('Complete authentication status check failed:', error);
    
    return NextResponse.json({
      isAuthenticated: false,
      lastChecked: new Date().toISOString(),
      error: 'Comprehensive authentication check failed'
    }, { status: 500 });
  }
}
