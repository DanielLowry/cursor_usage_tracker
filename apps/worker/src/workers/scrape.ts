// Playwright browser automation + types
import { chromium, BrowserContext } from 'playwright';
// Prisma client & helper DB functions used to persist raw blobs and snapshots
import prisma from '../../../../packages/db/src/client';
import { createSnapshotIfChanged } from '../../../../packages/db/src/snapshots';
import { trimRawBlobs } from '../../../../packages/db/src/retention';
// Cursor authentication state management
import { CursorAuthManager } from '../../../../packages/shared/cursor-auth/src';
// Env validation
import { z } from 'zod';
// gzip helper for storing compressed payloads
import * as zlib from 'zlib';
// filesystem helper used to read temporary download files from Playwright
import * as fs from 'fs';
import * as path from 'path';

// Expected environment variables and basic validation/transforms
const envSchema = z.object({
  // Directory for storing Cursor authentication state
  CURSOR_AUTH_STATE_DIR: z.string().min(1).default('./data'),
  // URL of the Cursor usage/dashboard page (may change over time)
  CURSOR_USAGE_URL: z.string().url().default('https://cursor.com/dashboard?tab=usage'),
  // How many raw captures to keep (stored as string in env, converted to number)
  RAW_BLOB_KEEP_N: z
    .string()
    .optional()
    .default('20')
    .transform((s) => parseInt(s, 10)),
});

export type ScrapeResult = {
  savedCount: number;
};

// Compress a Buffer using gzip and return the compressed Buffer
function gzipBuffer(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gzip(input, (err, out) => (err ? reject(err) : resolve(out)));
  });
}


// Main scrape routine.
// - Validates environment
// - Launches a persistent Playwright browser context using the provided profile dir
// - Listens for network responses to capture JSON payloads matching "isRelevant"
// - Attempts to use a provided CSV export path/button if present (preferred)
// - Persists raw captures as compressed blobs and then attempts to create snapshots
export async function runScrape(): Promise<ScrapeResult> {
  // validate and normalize env vars
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid env: ${parsed.error.message}`);
  }
  const env = parsed.data as { CURSOR_AUTH_STATE_DIR: string; CURSOR_USAGE_URL: string; RAW_BLOB_KEEP_N: number };
  console.log('runScrape: env', { CURSOR_USAGE_URL: env.CURSOR_USAGE_URL, CURSOR_AUTH_STATE_DIR: env.CURSOR_AUTH_STATE_DIR });

  // browser context and captured payload accumulator
  let context: BrowserContext | null = null;
  const captured: Array<{ url?: string; payload: Buffer }> = [];

  try {
    // Initialize Cursor auth manager
    const authManager = new CursorAuthManager(env.CURSOR_AUTH_STATE_DIR);
    
    // Launch Chromium with a temporary context (no persistent profile needed)
    context = await chromium.launchPersistentContext('./data/temp-profile', {
      headless: true,
      acceptDownloads: true,
    });
    console.log('runScrape: launched browser context');
    
    // Apply saved authentication state if available
    await authManager.applySessionCookies(context);
    console.log('runScrape: applied saved authentication state');
    
    const page = await context.newPage();

    // Surface page console logs and errors to help diagnose failures
    page.on('console', (msg) => {
      try {
        const type = msg.type();
        if (type !== 'error' && type !== 'warning') return;
        console.log('page console:', msg.type(), msg.text());
      } catch {
        // Ignore console errors
      }
    });
    page.on('pageerror', (err) => {
      console.error('page error:', err);
    });
    page.on('response', async (res) => {
      const url = res.url();
      const status = res.status();
      if (/(usage|spend|billing)/i.test(url) || status >= 400) {
        const ct = res.headers()['content-type'] || '';
        console.log('resp', status, url, ct);
        if (ct.includes('application/json') && status < 400) {
          try { 
            console.log('json peek', (await res.json())?.slice?.(0,1)); 
          } catch {
            // Ignore JSON parse errors
          }
        }
      }
    });
    page.on('requestfailed', (req) => {
      console.warn('request failed', req.failure()?.errorText, req.url());
    });
    

    // NOTE: We intentionally do NOT capture network JSON as a fallback.
    // The authoritative data source is the CSV export button; any other capture method
    // is considered an error per user instruction.

    // Navigate to the usage page. We wait for DOMContentLoaded but do not block indefinitely on networkidle
    await page.goto(env.CURSOR_USAGE_URL, { waitUntil: 'domcontentloaded' });
    // Give the app a moment to render client-side UI before querying for the button
    await page.waitForTimeout(1000);
    console.log('runScrape: page loaded, listener active');

    // Check if we're logged in by looking for login indicators or the export button
    const isLoggedIn = await page.$('button:has-text("Export CSV")').then(() => true).catch(() => false);
    if (!isLoggedIn) {
      console.log('runScrape: not logged in, need to authenticate first');
      // Try to navigate to login page - Cursor typically redirects to login when not authenticated
      const currentUrl = page.url();
      if (!currentUrl.includes('login') && !currentUrl.includes('auth') && !currentUrl.includes('authenticator.cursor.sh')) {
        console.log('runScrape: redirecting to login page');
        await page.goto('https://authenticator.cursor.sh/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
      }
      
      // Check if we're now on a login page
      const loginIndicators = await Promise.all([
        page.$('input[type="email"], input[name="email"]').then(() => true).catch(() => false),
        page.$('button:has-text("Sign in"), button:has-text("Login")').then(() => true).catch(() => false),
        page.$('form').then(() => true).catch(() => false)
      ]);
      
      if (loginIndicators.some(Boolean)) {
        // Check for Google OAuth button
        const googleButton = await page.$('button:has-text("Google"), button:has-text("Sign in with Google"), [data-provider="google"], [aria-label*="Google"]').catch(() => null);
        if (googleButton) {
          console.log('runScrape: Google OAuth detected - this requires manual interaction');
          throw new Error('Google OAuth login detected. Please use the login helper at /admin/login-helper to complete authentication, then retry scraping');
        } else {
          throw new Error('Authentication required: Please use the login helper at /admin/login-helper to authenticate, then retry scraping');
        }
      }
    } else {
      // Successfully authenticated - save the session state
      await authManager.saveSessionCookies(context);
      console.log('runScrape: authentication successful, session saved');
    }

    // We must use the Export CSV button exclusively. Locate the specific button
    // using multiple robust selector strategies and wait for it to become visible.
    try {
      // Try several selectors in order of robustness
      const candidateSelectors = [
        'role=button[name="Export CSV"]',
        'button:has-text("Export CSV")',
        'button.dashboard-outline-button:has(.dashboard-outline-button-text:has-text("Export CSV"))',
        'text=Export CSV >> xpath=ancestor::button[1]'
      ];

      let exportButton: import('playwright').ElementHandle<Element> | null = null;
      for (const sel of candidateSelectors) {
        try {
          const handle = await page.waitForSelector(sel as string, { state: 'visible', timeout: 10000 });
          if (handle) {
            exportButton = handle as import('playwright').ElementHandle<Element>;
            console.log('runScrape: export button found via selector', sel);
            break;
          }
        } catch {
          // try next selector
        }
      }
      if (!exportButton) {
        // Dump diagnostics to help identify why the selector failed
        const debugDir = path.resolve('./data/debug');
        await fs.promises.mkdir(debugDir, { recursive: true }).catch(() => {
          // Ignore directory creation errors
        });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotPath = path.join(debugDir, `usage_${ts}.png`);
        const htmlPath = path.join(debugDir, `usage_${ts}.html`);
        try {
          await page.screenshot({ path: screenshotPath, fullPage: true });
        } catch {
          // Ignore screenshot errors
        }
        try {
          const html = await page.content();
          await fs.promises.writeFile(htmlPath, html);
        } catch {
          // Ignore HTML save errors
        }
        const pageUrl = page.url();
        const title = await page.title().catch(() => '');
        throw new Error(`export button not found (url=${pageUrl}, title=${title}, screenshot=${screenshotPath}, html=${htmlPath})`);
      }

      console.log('runScrape: found export button, clicking and waiting for download');
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        exportButton.click(),
      ]);
      const tmpPath = await download.path();
      if (!tmpPath) throw new Error('download produced no temp path');
      const buf = await fs.promises.readFile(tmpPath);
      captured.push({ url: download.url(), payload: Buffer.from(buf) });
      console.log('runScrape: csv downloaded from', download.url());
    } catch (err) {
      // Fail fast: any inability to find/download via Export CSV is considered an error
      throw new Error(`csv download attempt failed: ${String(err)}`);
    }
  } finally {
    if (context) await context.close();
  }

  // Persist any captured payloads as compressed raw blobs and attempt to create snapshots
  let saved = 0;
  const now = new Date();
  console.log('runScrape: captured count=', captured.length);
  for (const item of captured) {
    const gz = await gzipBuffer(item.payload);
    const blob = await prisma.rawBlob.create({
      data: {
        captured_at: now,
        kind: 'network_json',
        url: item.url,
        payload: gz,
      },
      select: { id: true },
    });
    // Attempt to parse JSON and create a snapshot; non-JSON payloads will be ignored here
    try {
      const json = JSON.parse(item.payload.toString('utf8'));
      await createSnapshotIfChanged({ payload: json, capturedAt: now, rawBlobId: blob.id });
    } catch {
      // ignore JSON parse errors here; raw blob already saved for debugging
    }
    saved += 1;
    console.log('runScrape: saved one blob, id=', blob.id);
  }

  // Trim raw blobs retention to the configured number
  await trimRawBlobs(env.RAW_BLOB_KEEP_N);
  return { savedCount: saved };
}

export async function ingestFixtures(fixtures: Array<{ url?: string; json: unknown }>, keepN = 20): Promise<ScrapeResult> {
  let saved = 0;
  const now = new Date();
  for (const f of fixtures) {
    const buf = Buffer.from(JSON.stringify(f.json));
    const gz = await gzipBuffer(buf);
    await prisma.rawBlob.create({
      data: {
        captured_at: now,
        kind: 'network_json',
        url: f.url,
        payload: gz,
      },
    });
    saved += 1;
  }
  await trimRawBlobs(keepN);
  return { savedCount: saved };
}


// Lightweight CLI wrapper so this module actually runs when executed directly
async function _runCli() {
  try {
    console.log('scrape: starting');
    const res = await runScrape();
    console.log('scrape: finished', { result: res });
    process.exit(0);
  } catch (err) {
    console.error('scrape: error', err);
    process.exit(2);
  }
}

// Heuristic: when executed via `tsx src/workers/scrape.ts`, process.argv[1] will be the script path.
// Use a safe basename check to avoid using `import.meta` which may be disallowed by tsconfig.
const _invokedDirectly = (() => {
  const entry = process.argv[1] || '';
  const parts = entry.split(/[\\/]/);
  const name = parts[parts.length - 1] || '';
  return name === 'scrape.ts' || name === 'scrape.js';
})();

if (_invokedDirectly) {
  void _runCli();
}
