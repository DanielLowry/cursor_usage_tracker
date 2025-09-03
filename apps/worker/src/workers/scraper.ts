import { Worker, Queue, QueueEvents, Job } from 'bullmq';
import { getRedis } from '@cursor-usage/redis';

const connection = getRedis();

export const scraperQueue = new Queue('scraper', { connection });
export const scraperQueueEvents = new QueueEvents('scraper', { connection });

export const startScraperWorker = (): Worker => {
  const worker = new Worker(
    'scraper',
    async (job: Job) => {
      // Placeholder scrape logic
      return { ok: true, received: job.data };
    },
    { connection }
  );
  return worker;
};


