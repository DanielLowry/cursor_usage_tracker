// Relative path: apps/worker/src/scripts/onboard.ts

import { chromium } from 'playwright';
import { z } from 'zod';
import * as path from 'path';

const envSchema = z.object({
  PLAYWRIGHT_USER_DATA_DIR: z.string().min(1),
  CURSOR_LOGIN_URL: z.string().url().default('https://cursor.sh/login'),
});

export async function runOnboard(): Promise<void> {
  const env = envSchema.safeParse(process.env);
  if (!env.success) {
    console.error('Environment validation failed:', env.error.flatten().fieldErrors);
    process.exit(1);
  }

  const { PLAYWRIGHT_USER_DATA_DIR, CURSOR_LOGIN_URL } = env.data;
  const userDataDir = path.resolve(process.cwd(), PLAYWRIGHT_USER_DATA_DIR);
  console.log(`Using profile directory: ${userDataDir}`);

  try {
    const browser = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: ['--start-maximized'],
    });

    const page = await browser.newPage();
    await page.goto(CURSOR_LOGIN_URL);

    console.log('\nPlease log in to Cursor in the browser window.');
    console.log('The session will be saved to the profile directory.');
    console.log('Close the browser window when you are done to exit.\n');

    await browser.close();
    console.log('Browser closed. Profile saved successfully.');
  } catch (error) {
    console.error('Failed to complete onboarding:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  runOnboard().catch(console.error);
}


