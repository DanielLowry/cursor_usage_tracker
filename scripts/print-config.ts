import { loadConfig } from "@cursor-usage/env";

/**
 * This script loads, validates, and prints the application configuration.
 * It redacts sensitive values to prevent them from being exposed in logs.
 */
function main() {
  try {
    const config = loadConfig();

    // Create a redacted version for safe logging
    const redactedConfig = {
      ...config,
      AUTH_SECRET: config.AUTH_SECRET ? "[REDACTED]" : undefined,
      SMTP_PASS: config.SMTP_PASS ? "[REDACTED]" : undefined,
    };

    console.log(JSON.stringify(redactedConfig, null, 2));
  } catch (error) {
    console.error("Error: Failed to load or validate configuration.", error.message);
    process.exit(1);
  }
}

main();