import { defineConfig } from "vitest/config";
import path from "path";

const fromRoot = (segment: string) => path.resolve(__dirname, segment);

export default defineConfig({
  test: {
    // Look for test files in all packages
    include: ["packages/**/*.test.ts", "packages/**/*.test.tsx", "apps/**/*.test.ts", "apps/**/*.test.tsx"],
    // Exclude node_modules and build artifacts
    exclude: ["**/node_modules/**", "**/dist/**", ".next", "data"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      all: true,
    },
  },
  resolve: {
    alias: [
      { find: "@cursor-usage/db", replacement: fromRoot("packages/db/src") },
      { find: "@cursor-usage/ingest", replacement: fromRoot("packages/shared/ingest/src") },
      { find: "@cursor-usage/hash", replacement: fromRoot("packages/shared/hash/src") },
      { find: "@cursor-usage/normalize", replacement: fromRoot("packages/shared/normalize/src") },
      { find: "@cursor-usage/env", replacement: fromRoot("packages/env/src") },
      { find: "@cursor-usage/queues", replacement: fromRoot("packages/shared/queues/src") },
      { find: "@cursor-usage/redis", replacement: fromRoot("packages/shared/redis/src") },
    ],
  },
});