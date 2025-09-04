import { defineConfig } from "vitest/config";

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
});