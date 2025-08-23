import { describe, it, expect, beforeAll } from 'vitest';
import { dbSmoke } from '../../../scripts/db-smoke';

const isWindows = process.platform === 'win32';

describe('DB smoke connectivity', () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL && process.env.CI && process.platform !== 'win32') {
      // Default to CI Postgres started by workflow on Linux
      process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/cursor_usage_tracker';
    }
  });
  const t = isWindows ? it.skip : it;
  t('connects and runs SELECT 1', async () => {
    await expect(dbSmoke()).resolves.toBeUndefined();
  });
});


