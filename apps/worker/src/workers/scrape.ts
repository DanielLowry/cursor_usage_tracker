// Playwright browser automation + types
import { chromium, BrowserContext } from 'playwright';
// Prisma client & helper DB functions used to persist raw blobs and snapshots
import prisma from '../../../../packages/db/src/client';
import { createSnapshotIfChanged } from '../../../../packages/db/src/snapshots';
import { trimRawBlobs } from '../../../../packages/db/src/retention';
// Env validation
import { z } from 'zod';
// gzip helper for storing compressed payloads
import * as zlib from 'zlib';
// filesystem helper used to read temporary download files from Playwright
import * as fs from 'fs';

// Expected environment variables and basic validation/transforms
const envSchema = z.object({
  // Directory for Playwright persistent profile (so manual login can persist)
  PLAYWRIGHT_USER_DATA_DIR: z.string().min(1),
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

// Heuristic to filter network responses to only those likely containing usage/billing JSON
function isRelevant(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes('usage') || u.includes('spend') || u.includes('billing');
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
  const env = parsed.data as { PLAYWRIGHT_USER_DATA_DIR: string; CURSOR_USAGE_URL: string; RAW_BLOB_KEEP_N: number };
  console.log('runScrape: env', { CURSOR_USAGE_URL: env.CURSOR_USAGE_URL, PLAYWRIGHT_USER_DATA_DIR: env.PLAYWRIGHT_USER_DATA_DIR });

  // browser context and captured payload accumulator
  let context: BrowserContext | null = null;
  const captured: Array<{ url?: string; payload: Buffer }> = [];

  try {
    // Launch Chromium with a persistent profile so manual login can persist across runs
    // acceptDownloads=true allows Playwright to capture download events
    context = await chromium.launchPersistentContext(env.PLAYWRIGHT_USER_DATA_DIR, {
      headless: true,
      acceptDownloads: true,
    });
    console.log('runScrape: launched browser persistent context');
    const page = await context.newPage();

    // Listen for network responses and capture JSON payloads that look like usage/billing data
    // This is the primary (historically reliable) method because Cursor previously returned JSON
    page.on('response', async (response) => {
      try {
        const url = response.url();
        if (!isRelevant(url)) return; // skip irrelevant endpoints
        const ct = response.headers()['content-type'] || '';
        if (!ct.includes('application/json')) return; // only JSON bodies
        const body = await response.body();
        try {
          // quick sanity check that it's valid JSON before storing
          JSON.parse(body.toString('utf8'));
        } catch {
          return;
        }
        captured.push({ url, payload: Buffer.from(body) });
      } catch {
        // ignore individual response errors to keep scraping resilient
      }
    });

    // Navigate to the usage page. We wait for DOMContentLoaded but do not block indefinitely on networkidle
    await page.goto(env.CURSOR_USAGE_URL, { waitUntil: 'domcontentloaded' });
    console.log('runScrape: page loaded, listener active');

    // Prefer CSV export path if the UI provides it. Try direct CSV links first, then export buttons.
    try {
      // look for anchor links pointing to .csv or anchors with text suggesting an export
      const csvAnchor = await page.$('a[href$=".csv"], a[href*=".csv?"], a:has-text("Export CSV"), a:has-text("Download CSV")');
      if (csvAnchor) {
        // If a direct CSV link exists, click it and wait for the download event
        console.log('runScrape: found csv anchor, initiating download');
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 30000 }),
          csvAnchor.click(),
        ]);
        const tmpPath = await download.path();
        if (tmpPath) {
          const buf = await fs.promises.readFile(tmpPath);
          captured.push({ url: download.url(), payload: Buffer.from(buf) });
        } else {
          console.warn('runScrape: download path empty for csv anchor');
        }
      } else {
        // Otherwise try an Export button which may trigger a download or cause a CSV network response
        // Use sequential selectors to avoid mixing CSS and Playwright text selectors in one string
        let exportButton = await page.$('button:has-text("Export")');
        if (!exportButton) exportButton = await page.$('button:has-text("Export CSV")');
        if (!exportButton) exportButton = await page.$('text=Export CSV');
        if (exportButton) {
          console.log('runScrape: found export button, clicking and waiting for download/response');
          const clickPromise = exportButton.click();
          const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);
          const responsePromise = page.waitForResponse((resp) => {
            const ct = (resp.headers()['content-type'] || '').toLowerCase();
            return ct.includes('text/csv') || resp.url().toLowerCase().endsWith('.csv');
          }, { timeout: 30000 }).catch(() => null);
          const [download, response] = await Promise.all([downloadPromise, responsePromise, clickPromise]);
          if (download) {
            const tmpPath = await download.path();
            if (tmpPath) {
              const buf = await fs.promises.readFile(tmpPath);
              captured.push({ url: download.url(), payload: Buffer.from(buf) });
            }
          } else if (response) {
            const body = await response.body();
            captured.push({ url: response.url(), payload: Buffer.from(body) });
          } else {
            console.log('runScrape: export click did not produce a download or CSV response within timeout');
          }
        } else {
          console.log('runScrape: no CSV anchor or export button found; relying on network JSON capture');
        }
      }
    } catch (err) {
      // CSV attempt failed; log and continue so network JSON capture can still work
      console.warn('runScrape: csv download attempt failed', err);
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
