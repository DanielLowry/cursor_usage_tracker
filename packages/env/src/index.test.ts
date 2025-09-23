/**
 * Test Suite Overview:
 * - Exercises the environment configuration loader to ensure default values are applied, environment variables
 *   are read correctly, and Zod schema validation enforces expected formats.
 * - Parameterized cases cover both valid and invalid inputs for URLs, secrets, and numeric ports.
 *
 * Assumptions:
 * - `loadConfig` reads from `process.env` at invocation time, so tests reset modules to re-run schema parsing
 *   under different environment setups.
 * - The validation schema throws informative errors when inputs are missing or malformed.
 *
 * Expected Outcomes & Rationale:
 * - When values are absent, defaults such as `NODE_ENV=development` appear, confirming fallback logic.
 * - Providing valid environment variables produces typed outputs (e.g., numeric SMTP port), demonstrating
 *   transformation logic.
 * - Invalid inputs trigger specific error messages, ensuring misconfiguration is caught at startup rather than
 *   causing runtime failures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should return default NODE_ENV when not set", async () => {
    delete process.env.NODE_ENV;
    const { loadConfig } = await import("./index");
    const config = loadConfig();
    expect(config.NODE_ENV).toBe("development");
  });

  it("should correctly parse NODE_ENV when set", async () => {
    process.env.NODE_ENV = "production";
    const { loadConfig } = await import("./index");
    const config = loadConfig();
    expect(config.NODE_ENV).toBe("production");
  });

  it("should return undefined for DATABASE_URL when not set", async () => {
    delete process.env.DATABASE_URL;
    const { loadConfig } = await import("./index");
    const config = loadConfig();
    expect(config.DATABASE_URL).toBeUndefined();
  });

  it("should load DATABASE_URL from environment variables", async () => {
    const dbUrl = "postgresql://user:password@host:port/database";
    process.env.DATABASE_URL = dbUrl;
    const { loadConfig } = await import("./index");
    const config = loadConfig();
    expect(config.DATABASE_URL).toBe(dbUrl);
  });

  describe("schema validation", () => {
    it.each([
      ["DATABASE_URL", "postgresql://u:p@h:1/d"],
      ["REDIS_URL", "redis://h:1"],
      ["AUTH_URL", "http://example.com"],
      ["SMTP_FROM", "test@example.com"],
      ["SMTP_PORT", "587", 587],
    ])("should correctly parse valid %s", async (key, value, expected) => {
      process.env[key] = value as string;
      const { loadConfig } = await import("./index");
      const config = loadConfig();
      expect(config[key as keyof typeof config]).toBe(expected ?? value);
    });

    it.each([
      ["DATABASE_URL", "", /cannot be empty/i],
      ["DATABASE_URL", "not-a-valid-uri", /must be a valid connection string/i],
      ["REDIS_URL", "", /cannot be empty/i],
      ["REDIS_URL", "not-a-valid-uri", /must be a valid connection string/i],
      ["AUTH_URL", "not-a-url", /must be a valid url/i],
      ["AUTH_SECRET", "", /is required/i],
      ["SMTP_FROM", "not-an-email", /must be a valid email address/i],
      ["SMTP_PORT", "not-a-number", /expected number, received nan/i],
    ])("should throw for invalid %s (%s)", async (key, value, message) => {
      process.env[key] = value;
      const { loadConfig } = await import("./index");
      expect(() => loadConfig()).toThrow(message);
    });
  });
});
