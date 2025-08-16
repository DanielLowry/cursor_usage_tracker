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

  it("should throw an error for an empty DATABASE_URL string", async () => {
    // An empty string is invalid because the schema requires a minimum length of 1.
    process.env.DATABASE_URL = "";
    const { loadConfig } = await import("./index");
    // Use a regex to make the test less brittle to changes in the exact error message.
    expect(() => loadConfig()).toThrow(/invalid environment variables/i);
  });
});