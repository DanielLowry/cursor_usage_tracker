import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '../../../db/src/client';
import { insertUsageEventsFromNetworkJson } from './insertFromNetworkJson';

async function reset() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE usage_events RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE raw_blobs RESTART IDENTITY CASCADE');
}

describe('insertUsageEventsFromNetworkJson', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('inserts normalized rows into usage_events and links raw_blob', async () => {
    await reset();
    const blob = await prisma.rawBlob.create({
      data: { captured_at: new Date('2025-02-10T00:00:00Z'), kind: 'network_json', url: 'https://api/usage', payload: Buffer.from('x') },
      select: { id: true },
    });

    const payload = {
      billing_period: { start: '2025-02-01', end: '2025-02-29' },
      rows: [
        { model: 'gpt-4.1', input_with_cache_write_tokens: 10, input_without_cache_write_tokens: 20, cache_read_tokens: 5, output_tokens: 15, total_tokens: 50, api_cost: '$0.12', cost_to_you: '$0.10' },
        { model: 'gpt-4.1-mini', input_with_cache_write_tokens: 1, input_without_cache_write_tokens: 2, cache_read_tokens: 0, output_tokens: 3, total_tokens: 6, api_cost: '$0.01', cost_to_you: '$0.01' },
      ],
    };

    const res = await insertUsageEventsFromNetworkJson(payload, new Date('2025-02-15T05:00:00Z'), blob.id);
    expect(res.inserted).toBe(2);

    const rows = await prisma.usageEvent.findMany({ orderBy: { total_tokens: 'desc' } });
    expect(rows.length).toBe(2);
    expect(rows[0].model).toBe('gpt-4.1');
    expect(rows[0].raw_blob_id).toBe(blob.id);
  });
});


