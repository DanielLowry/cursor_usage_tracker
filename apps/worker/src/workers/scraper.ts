import { Worker, Queue, QueueEvents, Job } from 'bullmq';
import { getRedis } from '@cursor-usage/redis';
import { runScrape } from './scrape';

const connection = getRedis();

export const scraperQueue = new Queue('scraper', { connection });
export const scraperQueueEvents = new QueueEvents('scraper', { connection });

export const startScraperWorker = (): Worker => {
  const worker = new Worker(
    'scraper',
    async (_job: Job) => {
      const result = await runScrape();
      return result;
    },
    { connection }
  );
  return worker;
};


