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


