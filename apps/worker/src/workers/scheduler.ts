// Relative path: apps/worker/src/workers/scheduler.ts

import { Queue } from 'bullmq';
import { getRedis } from '@cursor-usage/redis';
import { scraperQueue } from './scraper';

const connection = getRedis();

export const schedulerQueue = new Queue('scheduler', { connection });

export async function enqueueScrape(task: unknown): Promise<void> {
  await scraperQueue.add('scrape', task, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } });
}


