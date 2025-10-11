// Relative path: packages/shared/queues/src/index.ts

import { Queue } from "bullmq";
import { getRedis } from "@cursor-usage/redis";

export type ScrapeJob = {
  reason?: string;
};

export function createQueue<T extends object>(name: string): Queue<T> {
  const redis = getRedis();
  // BullMQ accepts an ioredis instance via connection property
  const queue = new Queue<T>(name, {
    connection: redis,
  });
  return queue;
}

export function getScrapeQueue() {
  return createQueue<ScrapeJob>("scrape");
}


