import { chromium } from 'playwright-chromium';
import { z } from 'zod';
import path from 'path';

// Environment validation
const envSchema = z.object({
  PLAYWRIGHT_USER_DATA_DIR: z.string().min(1),
  CURSOR_LOGIN_URL: z.string().url().default('https://cursor.sh/login'),
});

async function onboard() {
  // Validate environment
  const env = envSchema.safeParse(process.env);
  if (!env.success) {
    console.error('Environment validation failed:', env.error.flatten().fieldErrors);
    process.exit(1);
  }

  const { PLAYWRIGHT_USER_DATA_DIR, CURSOR_LOGIN_URL } = env.data;

  // Ensure user data directory is absolute
  const userDataDir = path.resolve(process.cwd(), PLAYWRIGHT_USER_DATA_DIR);
  console.log(`Using profile directory: ${userDataDir}`);

  try {
    // Launch non-headless browser with persistent context
    const browser = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // Required for manual login
      args: ['--start-maximized'],
    });

    const page = await browser.newPage();
    
    // Navigate to login page
    await page.goto(CURSOR_LOGIN_URL);
    
    console.log('\nPlease log in to Cursor in the browser window.');
    console.log('The session will be saved to the profile directory.');
    console.log('Close the browser window when you are done to exit.\n');

    // Wait for browser to close
    await browser.close();
    console.log('Browser closed. Profile saved successfully.');

  } catch (error) {
    console.error('Failed to complete onboarding:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  onboard().catch(console.error);
}
