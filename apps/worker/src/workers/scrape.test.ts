/**
 * Relative path: apps/worker/src/workers/scrape.test.ts
 *
 * Test Purpose:
 * - Validates that the scrape worker stores captured network fixtures as gzipped `raw_blob` records and enforces
 *   the retention policy to keep only the newest N entries.
 *
 * Assumptions:
 * - Prisma can connect to the test database and truncate the `raw_blobs` table between runs.
 * - `ingestFixtures` returns a summary containing the number of saved payloads and applies the retention cap.
 *
 * Expected Outcome & Rationale:
 * - All five fixtures are written initially (`savedCount` = 5) and only the newest three remain after trimming,
 *   confirming both persistence and retention behavior. Each stored blob must be tagged as `network_json` with
 *   non-empty payload buffers to emulate real captures.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '../../../../packages/db/src/client';
import { ingestFixtures } from './scraper';

async function reset() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE raw_blobs RESTART IDENTITY CASCADE');
}

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabaseUrl ? describe : describe.skip;

describeIfDb('network capture → raw_blobs (fixtures)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('stores gzipped payloads with kind network_json and trims to keepN', async () => {
    await reset();
    const fixtures = Array.from({ length: 5 }, (_, i) => ({
      url: `https://api.cursor.sh/usage?page=${i}`,
      json: { page: i, spend_cents: i * 100, models: [{ name: 'gpt', tokens: i * 10 }] },
    }));

    const result = await ingestFixtures(fixtures, 3);
    expect(result.savedCount).toBe(5);

    const rows = await prisma.rawBlob.findMany({ orderBy: { captured_at: 'asc' } });
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.kind).toBe('network_json');
      expect(row.payload).toBeInstanceOf(Buffer);
      expect(row.payload.length).toBeGreaterThan(0);
    }
  });
});



