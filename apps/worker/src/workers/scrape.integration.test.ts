import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '../../../../packages/db/src/client';
import { ingestFixtures } from './scrape';
import { createSnapshotIfChanged } from '../../../../packages/db/src/snapshots';

async function reset() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE usage_events RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE snapshots RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE raw_blobs RESTART IDENTITY CASCADE');
}

describe('scrape integration: insert usage events from captured JSON', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('ingests fixtures as raw_blobs then maps and inserts into usage_events', async () => {
    await reset();
    const fixtures = [
      { url: 'https://api/usage', json: { billing_period: { start: '2025-02-01', end: '2025-02-29' }, rows: [{ model: 'gpt-4.1', input_with_cache_write_tokens: 1, input_without_cache_write_tokens: 2, cache_read_tokens: 0, output_tokens: 3, total_tokens: 6, api_cost: '$0.01', cost_to_you: '$0.01' }] } },
    ];
    const r = await ingestFixtures(fixtures, 5);
    expect(r.savedCount).toBe(1);

    const blobs = await prisma.rawBlob.findMany();
    expect(blobs.length).toBe(1);

    // Stored payloads are gzipped; decompress before parsing
    const zlib = await import('zlib');
    const decompressed = zlib.gunzipSync(Buffer.from(blobs[0].payload));
    const json = JSON.parse(decompressed.toString('utf8'));
    const result = await createSnapshotIfChanged({ payload: json, capturedAt: blobs[0].captured_at, rawBlobId: blobs[0].id });
    expect(result.wasNew).toBe(true);
    expect(result.usageEventIds.length).toBe(1);

    const events = await prisma.usageEvent.findMany();
    expect(events.length).toBe(1);
    expect(events[0].raw_blob_id).toBe(blobs[0].id);

    const snapshots = await prisma.snapshot.findMany();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].rows_count).toBe(1);
  });
});


