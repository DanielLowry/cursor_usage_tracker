import { Worker, Job } from "bullmq";
import { getRedis } from "@cursor-usage/redis";

type ScrapeJob = {
  reason?: string;
};

const connection = getRedis();

const scrapeWorker = new Worker<ScrapeJob>(
  "scrape",
  async (job: Job<ScrapeJob>) => {
    console.log(
      JSON.stringify({
        msg: "scrape job received",
        id: job.id,
        name: job.name,
        data: job.data,
        ts: new Date().toISOString(),
      })
    );
    return { ok: true };
  },
  { connection }
);

scrapeWorker.on("completed", (job) => {
  console.log(JSON.stringify({ msg: "scrape job completed", id: job.id }));
});

scrapeWorker.on("failed", (job, err) => {
  console.error(
    JSON.stringify({ msg: "scrape job failed", id: job?.id, error: err?.message })
  );
});


