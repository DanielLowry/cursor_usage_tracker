/**
 * Test Purpose:
 * - Ensures the `trimRawBlobs` retention routine deletes the oldest raw blob records while keeping the most
 *   recent N entries, preserving chronological order.
 *
 * Assumptions:
 * - The test database can be connected to and truncated between runs to provide a clean slate.
 * - `trimRawBlobs` performs deletions based on the `captured_at` timestamp field.
 *
 * Expected Outcomes & Rationale:
 * - Seeding 30 blobs and trimming to 20 should delete 10 rows, leaving the 20 newest records.
 * - The `count` query should report 20 remaining entries to confirm the deletion total.
 * - The newest record after trimming must match the latest seed timestamp, while the oldest retained record
 *   should align with the 20th newest seed, proving ordering logic is correct.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from './client';
import { trimRawBlobs } from './retention';

async function reset() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE raw_blobs RESTART IDENTITY CASCADE');
}

describe('trimRawBlobs', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('keeps the newest N rows by captured_at and deletes older ones', async () => {
    await reset();
    // Seed ~30 blobs with 1-minute increments
    const base = new Date('2025-01-01T00:00:00.000Z').getTime();
    const total = 30;
    await prisma.$transaction(
      Array.from({ length: total }, (_, i) =>
        prisma.rawBlob.create({
          data: {
            captured_at: new Date(base + i * 60_000),
            kind: 'network_json',
            url: `https://example.com/${i}`,
            payload: Buffer.from(`blob-${i}`),
          },
          select: { id: true, captured_at: true },
        })
      )
    );

    // Trim to 20
    const deleted = await trimRawBlobs(20);
    expect(deleted).toBe(10);

    const count = await prisma.rawBlob.count();
    expect(count).toBe(20);

    // Ensure newest preserved
    const newest = await prisma.rawBlob.findFirst({ orderBy: { captured_at: 'desc' } });
    expect(newest?.captured_at.toISOString()).toBe(new Date(base + (total - 1) * 60_000).toISOString());

    // Oldest after trim should be the previous 20th newest
    const oldestKept = await prisma.rawBlob.findMany({ orderBy: { captured_at: 'asc' }, take: 1 });
    expect(oldestKept[0].captured_at.toISOString()).toBe(new Date(base + (total - 20) * 60_000).toISOString());
  });
});


