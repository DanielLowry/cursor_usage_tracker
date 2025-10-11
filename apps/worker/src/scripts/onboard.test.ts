/**
 * Relative path: apps/worker/src/scripts/onboard.test.ts
 *
 * Test Purpose:
 * - Provides a smoke test for the Playwright-based onboarding script by launching a persistent Chromium
 *   context headlessly and ensuring the temporary user-data directory is created.
 *
 * Assumptions:
 * - The environment has Playwright Chromium binaries installed and can run headless without a display server.
 * - Tests can safely create and remove temporary directories on the host filesystem.
 *
 * Expected Outcome & Rationale:
 * - Launching and closing the browser without errors demonstrates that Playwright dependencies are installed
 *   correctly and that scripts relying on persistent contexts will be able to initialize during onboarding.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('Playwright onboarding (headless smoke)', () => {
  let tempUserDataDir: string;

  beforeAll(() => {
    tempUserDataDir = path.join(os.tmpdir(), `playwright-test-${Date.now()}`);
    fs.mkdirSync(tempUserDataDir, { recursive: true });
  });

  it('launches persistent context headless', async () => {
    const browser = await chromium.launchPersistentContext(tempUserDataDir, {
      headless: true,
    });
    expect(browser).toBeDefined();
    expect(fs.existsSync(tempUserDataDir)).toBe(true);
    await browser.close();
  }, 30000);

  afterAll(() => {
    fs.rmSync(tempUserDataDir, { recursive: true, force: true });
  });
});



