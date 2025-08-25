import { describe, it, expect, beforeAll } from 'vitest';
import { chromium } from 'playwright-chromium';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('Playwright onboarding', () => {
  let tempUserDataDir: string;

  beforeAll(() => {
    // Create temporary directory for test profile
    tempUserDataDir = path.join(os.tmpdir(), `playwright-test-${Date.now()}`);
    fs.mkdirSync(tempUserDataDir, { recursive: true });
  });

  it('can launch browser with persistent context (smoke test)', async () => {
    // Only run headless smoke test
    const browser = await chromium.launchPersistentContext(tempUserDataDir, {
      headless: true, // Force headless for CI
    });

    expect(browser).toBeDefined();
    expect(fs.existsSync(tempUserDataDir)).toBe(true);

    await browser.close();
  }, 30000); // Increase timeout for browser launch

  // Clean up
  afterAll(() => {
    fs.rmSync(tempUserDataDir, { recursive: true, force: true });
  });
});
