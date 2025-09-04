import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GET } from './route';
import { prisma } from '@cursor-usage/db';

async function reset() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE usage_events RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE snapshots RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE budgets RESTART IDENTITY CASCADE');
}

describe('/api/summary-min', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  it('returns correct shape and values', async () => {
    await reset();

    // Seed some test data
    await prisma.budget.create({
      data: { effective_budget_cents: 5000 },
    });

    await prisma.snapshot.create({
      data: {
        captured_at: new Date('2025-02-15T10:00:00Z'),
        billing_period_start: new Date('2025-02-01'),
        billing_period_end: new Date('2025-02-28'),
        table_hash: 'test-hash-123',
        rows_count: 2,
      },
    });

    await prisma.usageEvent.create({
      data: {
        captured_at: new Date('2025-02-15T10:00:00Z'),
        model: 'gpt-4.1',
        input_with_cache_write_tokens: 100,
        input_without_cache_write_tokens: 200,
        cache_read_tokens: 50,
        output_tokens: 150,
        total_tokens: 500,
        api_cost_cents: 50,
        cost_to_you_cents: 40,
        billing_period_start: new Date('2025-02-01'),
        billing_period_end: new Date('2025-02-28'),
        source: 'network_json',
      },
    });

    await prisma.usageEvent.create({
      data: {
        captured_at: new Date('2025-02-15T10:00:00Z'),
        model: 'gpt-4.1-mini',
        input_with_cache_write_tokens: 10,
        input_without_cache_write_tokens: 20,
        cache_read_tokens: 5,
        output_tokens: 15,
        total_tokens: 50,
        api_cost_cents: 5,
        cost_to_you_cents: 4,
        billing_period_start: new Date('2025-02-01'),
        billing_period_end: new Date('2025-02-28'),
        source: 'network_json',
      },
    });

    // Call the API route
    const response = await GET();
    const data = await response.json();

    // Assert response shape and values
    expect(response.status).toBe(200);
    expect(data).toEqual({
      snapshotCount: 1,
      lastSnapshotAt: '2025-02-15T10:00:00.000Z',
      usageEventCount: 2,
    });
  });

  it('returns zero counts when no data exists', async () => {
    await reset();

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      snapshotCount: 0,
      lastSnapshotAt: null,
      usageEventCount: 0,
    });
  });
});