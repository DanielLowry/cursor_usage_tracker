/* Relative path: apps/worker/tsup.config.ts */

import { defineConfig } from "tsup"

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/scripts/onboard.ts",
    "src/workers/scraper.ts",
    "src/workers/scheduler.ts",
  ],
  format: ["cjs", "esm"],
  external: ["@cursor-usage/ingest", "@prisma/client", ".prisma/client/default"],
  clean: true,
})
