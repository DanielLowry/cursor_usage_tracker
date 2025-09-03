import { defineConfig } from "tsup"

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/scripts/onboard.ts",
    "src/workers/scraper.ts",
    "src/workers/scheduler.ts",
  ],
  format: ["cjs", "esm"],
  clean: true,
})
