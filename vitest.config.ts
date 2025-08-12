import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Look for test files in all packages
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    // Exclude node_modules and build artifacts
    exclude: ["node_modules", "dist", ".next"],
  },
});