import { Queue } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

import { getRedis } from '@cursor-usage/redis';

import { ConsoleLogger } from './scraper/adapters/logger';
import { SystemClock } from './scraper/adapters/clock';
import { CursorFetchAdapter } from './scraper/adapters/fetch';
import { PrismaBlobStoreAdapter } from './scraper/adapters/blobStore';
import { PrismaSnapshotStoreAdapter } from './scraper/adapters/snapshotStore';
import { ScraperOrchestrator } from './scraper/orchestrator';
import { ScraperError } from './scraper/errors';

const USAGE_CSV_URL = 'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens';

const envSchema = z.object({
  CURSOR_AUTH_STATE_DIR: z.string().min(1).default('./data'),
  RAW_BLOB_KEEP_N: z
    .string()
    .optional()
    .default('20')
    .transform((value) => parseInt(value, 10)),
});

type EnvConfig = z.infer<typeof envSchema>;

function parseEnv(): EnvConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ScraperError('VALIDATION_ERROR', `invalid env: ${parsed.error.message}`);
  }
  return parsed.data;
}

function resolveStateDir(requested: string): string {
  const resolved = path.resolve(requested);
  const requestedStatePath = path.join(resolved, 'cursor.state.json');
  if (fs.existsSync(requestedStatePath)) {
    return resolved;
  }

  let repoRoot = process.cwd();
  let foundRoot = false;
  for (let i = 0; i < 100; i++) {
    const marker1 = path.join(repoRoot, 'pnpm-workspace.yaml');
    const marker2 = path.join(repoRoot, 'turbo.json');
    const marker3 = path.join(repoRoot, '.git');
    if (fs.existsSync(marker1) || fs.existsSync(marker2) || fs.existsSync(marker3)) {
      foundRoot = true;
      break;
    }
    const parent = path.dirname(repoRoot);
    if (parent === repoRoot) break;
    repoRoot = parent;
  }

  if (!foundRoot) repoRoot = process.cwd();

  const alt = path.join(repoRoot, 'apps', 'web', 'data');
  const altStatePath = path.join(alt, 'cursor.state.json');
  if (fs.existsSync(altStatePath)) return alt;

  return resolved;
}

const connection = getRedis();
export const scraperQueue = new Queue('scraper', { connection });

export type ScrapeResult = {
  savedCount: number;
};

export async function runScrape(): Promise<ScrapeResult> {
  const logger = new ConsoleLogger();

  try {
    const env = parseEnv();
    const stateDir = resolveStateDir(env.CURSOR_AUTH_STATE_DIR);
    logger.info('scraper.run.config', { stateDir, retention: env.RAW_BLOB_KEEP_N });

    const orchestrator = new ScraperOrchestrator({
      fetchPort: new CursorFetchAdapter({ stateDir, logger, targetUrl: USAGE_CSV_URL }),
      blobStore: new PrismaBlobStoreAdapter(logger),
      snapshotStore: new PrismaSnapshotStoreAdapter(logger),
      clock: new SystemClock(),
      logger,
      retentionCount: env.RAW_BLOB_KEEP_N,
      usageCsvUrl: USAGE_CSV_URL,
    });

    const result = await orchestrator.run();
    return { savedCount: result.savedBlob ? 1 : 0 };
  } catch (err) {
    if (err instanceof ScraperError) {
      logger.error('scraper.run.error', { code: err.code, message: err.message });
      throw err;
    }
    logger.error('scraper.run.error', { message: err instanceof Error ? err.message : 'unknown' });
    throw err;
  }
}

export async function ingestFixtures(
  fixtures: Array<{ url?: string; json: unknown }>,
  keepN = 20,
): Promise<ScrapeResult> {
  const logger = new ConsoleLogger();
  const blobStore = new PrismaBlobStoreAdapter(logger);
  let saved = 0;
  const start = Date.now();
  let index = 0;
  for (const fixture of fixtures) {
    const payload = Buffer.from(JSON.stringify(fixture.json));
    const capturedAt = new Date(start + index * 1000);
    index += 1;
    const result = await blobStore.saveIfNew({
      payload,
      kind: 'network_json',
      capturedAt,
      url: fixture.url,
      retentionCount: keepN,
    });
    if (result.status === 'saved') {
      saved += 1;
    }
  }

  return { savedCount: saved };
}

async function runCli() {
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

const invokedDirectly = (() => {
  const entry = process.argv[1] || '';
  const parts = entry.split(/[\\/]/);
  const name = parts[parts.length - 1] || '';
  return name === 'scrape.ts' || name === 'scrape.js';
})();

if (invokedDirectly) {
  void runCli();
}
