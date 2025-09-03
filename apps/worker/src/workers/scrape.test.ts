import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '../../../../packages/db/src/client';
import { ingestFixtures } from './scrape';

async function reset() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE raw_blobs RESTART IDENTITY CASCADE');
}

describe('network capture → raw_blobs (fixtures)', () => {
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


