// Relative path: apps/worker/src/workers/scrape.ts

import { Worker, Queue, QueueEvents, Job } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { getRedis } from '@cursor-usage/redis';
import { runIngestion, type BlobPolicyConfig, type RunIngestionResult, type WeeklyBlobPolicyConfig } from './orchestrator';
import { CursorCsvFetchAdapter } from './scraper/infra/fetch';
import { PrismaUsageEventStore } from './scraper/infra/eventStore';
import { PrismaBlobStore } from './scraper/infra/blobStore';
import type { ClockPort, Logger } from './scraper/ports';

const connection = getRedis();

export const scraperQueue = new Queue('scraper', { connection });
export const scraperQueueEvents = new QueueEvents('scraper', { connection });

class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}

class ConsoleLogger implements Logger {
  info(message: string, context: Record<string, unknown> = {}): void {
    console.info(message, context);
  }
  error(message: string, context: Record<string, unknown> = {}): void {
    console.error(message, context);
  }
}

const envSchema = z.object({
  CURSOR_AUTH_STATE_DIR: z.string().min(1).default('./data'),
  BLOB_POLICY: z.enum(['weekly', 'anomaly_only']).default('weekly'),
  BLOB_WEEKLY_INTERVAL: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

let lastBlobSavedAt: Date | null = null;
let ingestionsSinceLastBlob = 0;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`invalid ingestion env: ${parsed.error.message}`);
  }
  return parsed.data;
}

function resolveStateDir(requestedStateDir: string): string {
  const requestedStatePath = path.join(path.resolve(requestedStateDir), 'cursor.state.json');
  if (fs.existsSync(requestedStatePath)) {
    return path.resolve(requestedStateDir);
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
  return requestedStateDir;
}

function buildBlobPolicy(env: Env): BlobPolicyConfig {
  if (env.BLOB_POLICY === 'anomaly_only') {
    return { mode: 'anomaly_only' };
  }
  const interval = env.BLOB_WEEKLY_INTERVAL ? Number.parseInt(env.BLOB_WEEKLY_INTERVAL, 10) : Number.NaN;
  const maxIngestions = Number.isFinite(interval) && interval > 0 ? interval : undefined;
  const policy: WeeklyBlobPolicyConfig = {
    mode: 'weekly',
    lastSavedAt: lastBlobSavedAt,
    ingestionsSinceLastBlob,
  };
  if (typeof maxIngestions === 'number') {
    policy.maxIngestionsBeforeSave = maxIngestions;
  }
  return policy;
}

async function executeIngestionJob(): Promise<RunIngestionResult> {
  const env = parseEnv();
  const logger = new ConsoleLogger();
  const clock = new SystemClock();

  logger.info('scrape.env', { CURSOR_AUTH_STATE_DIR: env.CURSOR_AUTH_STATE_DIR, blobPolicy: env.BLOB_POLICY });

  const stateDir = resolveStateDir(env.CURSOR_AUTH_STATE_DIR);
  logger.info('scrape.auth_state_dir.resolved', { stateDir });

  const fetcher = new CursorCsvFetchAdapter({ stateDir, logger });
  const eventStore = new PrismaUsageEventStore({ logger });
  const blobStore = new PrismaBlobStore({ logger });

  const result = await runIngestion({
    fetcher,
    eventStore,
    blobStore,
    clock,
    logger,
    source: 'cursor_csv',
    blobPolicy: buildBlobPolicy(env),
  });

  if (result.savedBlob) {
    lastBlobSavedAt = clock.now();
    ingestionsSinceLastBlob = 0;
  } else {
    ingestionsSinceLastBlob += 1;
  }

  return result;
}

export const startScraperWorker = (): Worker => {
  const worker = new Worker(
    'scraper',
    async (_job: Job) => {
      try {
        return await executeIngestionJob();
      } catch (err) {
        console.error('scraper.worker.error', err);
        throw err;
      }
    },
    { connection },
  );
  return worker;
};

// Execute a single ingestion run when invoked directly (e.g., via pnpm scrape:once)
(() => {
  const invokedPath = process.argv && process.argv.length > 1 ? process.argv[1] : '';
  const isDirect = typeof invokedPath === 'string' && path.basename(invokedPath) === 'scrape.ts';
  if (!isDirect) return;

  executeIngestionJob()
    .then((result) => {
      console.info('scrape.once.completed', {
        savedBlob: result.savedBlob,
      });
      process.exit(0);
    })
    .catch((err) => {
      console.error('scrape.once.error', err);
      process.exit(1);
    });
})();
