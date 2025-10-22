/**
 * Test Purpose:
 * - Provides a smoke-test that verifies the application can establish a connection to the configured
 *   Postgres database and execute a trivial `SELECT 1` query via the `dbSmoke` helper.
 *
 * Assumptions:
 * - A DATABASE_URL is present in the environment or, when running in CI on Linux, the test harness can
 *   fall back to the default local Postgres instance spun up by the workflow.
 * - Windows CI runners do not have the supporting Postgres container, so the test is skipped on that platform.
 *
 * Expected Outcome & Rationale:
 * - `dbSmoke()` resolves without throwing, signalling that the database connection string is valid and a
 *   minimal query path through Prisma succeeds. Failure would indicate infrastructure or credential issues
 *   before deeper integration tests run.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { dbSmoke } from '../../../scripts/db-smoke';

const isWindows = process.platform === 'win32';
const hasDatabaseUrl = typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;

describe('DB smoke connectivity', () => {
  beforeAll(() => {
    if (!hasDatabaseUrl && process.env.CI && process.platform !== 'win32') {
      // Default to CI Postgres started by workflow on Linux
      process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/cursor_usage_tracker';
    }
  });
  const shouldSkip = !hasDatabaseUrl && !process.env.CI;
  const t = isWindows || shouldSkip ? it.skip : it;
  t('connects and runs SELECT 1', async () => {
    await expect(dbSmoke()).resolves.toBeUndefined();
  });
});


