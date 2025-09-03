import { getScrapeQueue } from "@cursor-usage/queues";

async function main() {
  const queue = getScrapeQueue();
  await queue.add("scrape", { reason: "manual" }, { attempts: 3, backoff: { type: "exponential", delay: 1000 } });
  // eslint-disable-next-line no-console
  console.log("Enqueued scrape job");
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});


