import { chromium, BrowserContext } from 'playwright';
import prisma from '../../../../packages/db/src/client';
import { createSnapshotIfChanged } from '../../../../packages/db/src/snapshots';
import { trimRawBlobs } from '../../../../packages/db/src/retention';
import { z } from 'zod';
import * as zlib from 'zlib';

const envSchema = z.object({
  PLAYWRIGHT_USER_DATA_DIR: z.string().min(1),
  CURSOR_USAGE_URL: z.string().url().default('https://cursor.sh/account/usage'),
  RAW_BLOB_KEEP_N: z
    .string()
    .optional()
    .default('20')
    .transform((s) => parseInt(s, 10)),
});

export type ScrapeResult = {
  savedCount: number;
};

function gzipBuffer(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gzip(input, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

function isRelevant(url: string): boolean {
  const u = url.toLowerCase();
  return u.includes('usage') || u.includes('spend') || u.includes('billing');
}

export async function runScrape(): Promise<ScrapeResult> {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid env: ${parsed.error.message}`);
  }
  const env = parsed.data as { PLAYWRIGHT_USER_DATA_DIR: string; CURSOR_USAGE_URL: string; RAW_BLOB_KEEP_N: number };

  let context: BrowserContext | null = null;
  const captured: Array<{ url?: string; payload: Buffer }> = [];

  try {
    context = await chromium.launchPersistentContext(env.PLAYWRIGHT_USER_DATA_DIR, {
      headless: true,
    });
    const page = await context.newPage();

    page.on('response', async (response) => {
      try {
        const url = response.url();
        if (!isRelevant(url)) return;
        const ct = response.headers()['content-type'] || '';
        if (!ct.includes('application/json')) return;
        const body = await response.body();
        try {
          JSON.parse(body.toString('utf8'));
        } catch {
          return;
        }
        captured.push({ url, payload: Buffer.from(body) });
      } catch {
        // ignore individual response errors
      }
    });

    await page.goto(env.CURSOR_USAGE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
  } finally {
    if (context) await context.close();
  }

  let saved = 0;
  const now = new Date();
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
    // Attempt to parse and create snapshot from the same JSON
    try {
      const json = JSON.parse(item.payload.toString('utf8'));
      await createSnapshotIfChanged({ payload: json, capturedAt: now, rawBlobId: blob.id });
    } catch {
      // ignore JSON parse errors here; raw blob already saved
    }
    saved += 1;
  }

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


