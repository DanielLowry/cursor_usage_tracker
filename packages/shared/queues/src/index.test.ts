// Relative path: packages/shared/queues/src/index.test.ts

/**
 * Test Purpose:
 * - Smoke-tests the BullMQ scrape queue integration by enqueueing a dummy job and verifying it is processed to
 *   completion using the shared Redis connection.
 *
 * Assumptions:
 * - A Redis instance is reachable via `REDIS_URL`; otherwise the suite is skipped to avoid spurious failures.
 * - `getScrapeQueue` and `getRedis` expose shared singletons that can be reused across worker and events.
 *
 * Expected Outcome & Rationale:
 * - The job resolves with the echoed data, confirming that queue registration, worker processing, and event
 *   listeners are wired correctly and that the infrastructure is functioning end-to-end.
 */
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



