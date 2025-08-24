import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { QueueEvents, Worker, Job } from "bullmq";
import { getScrapeQueue } from "./index";
import { getRedis } from "@cursor-usage/redis";

const shouldRun = !!process.env.REDIS_URL;
const d = shouldRun ? describe : describe.skip;

d("scrape queue", () => {
  const connection = getRedis();
  const queue = getScrapeQueue();
  let events: QueueEvents;
  let worker: Worker;

  beforeAll(async () => {
    events = new QueueEvents("scrape", { connection });
    await events.waitUntilReady();
    worker = new Worker(
      "scrape",
      async (job: Job) => {
        // Minimal processor: just echo data
        return { ok: true, data: job.data };
      },
      { connection }
    );
  });

  afterAll(async () => {
    await worker.close();
    await events.close();
    await queue.close();
    // Do not close shared Redis singleton here to avoid affecting other tests.
  });

  it("enqueues and completes a dummy scrape job", async () => {
    const job = await queue.add("test", { reason: "test" });
    const result = await job.waitUntilFinished(events, 10000);
    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
    expect(result.data.reason).toBe("test");
  });
});


