/**
 * Test Suite Overview:
 * - Validates the `/api/summary-min` route against an isolated Postgres schema to ensure counts and timestamps
 *   returned to the dashboard match the data stored in snapshots, usage events, and budgets tables.
 * - Covers both the populated and empty-database cases to guarantee predictable API responses for callers.
 *
 * Assumptions:
 * - Tests can create a schema-scoped DATABASE_URL so Prisma models operate on isolated tables without
 *   interfering with concurrent test runs.
 * - The route handler reads directly from Prisma without requiring request context beyond environment config.
 *
 * Expected Outcomes & Rationale:
 * - When seeding representative data, the route should return the seeded counts and last snapshot timestamp,
 *   demonstrating correct aggregation queries.
 * - With no data present, the route must return zeros and `null` to ensure the UI can safely display defaults
 *   instead of throwing or showing stale values.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// NOTE: We avoid importing the route or prisma at module top-level so we can
// set DATABASE_URL to a test-specific schema before the client initializes.
let GET: typeof import('./route').GET;
let prisma: typeof import('@cursor-usage/db').prisma;

const TEST_SCHEMA = `summary_min_${process.pid}_${Date.now()}`;
const BASE_DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/cursor_usage_tracker';

async function importClients() {
  // Point Prisma to our isolated schema
  process.env.DATABASE_URL = `${BASE_DB_URL}?schema=${TEST_SCHEMA}`;
  // Ensure fresh module import with new env
  vi.resetModules();
  ({ prisma } = await import('@cursor-usage/db'));
  ({ GET } = await import('./route'));
}

async function reset() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE usage_events RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE snapshots RESTART IDENTITY CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE budgets RESTART IDENTITY CASCADE');
}

describe('/api/summary-min', () => {
  beforeAll(async () => {
    // Use the default/public prisma to prepare an isolated schema by cloning tables
    const { prisma: publicPrisma } = await import('@cursor-usage/db');
    await publicPrisma.$connect();
    // Create dedicated schema and copy table structures from public
    await publicPrisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${TEST_SCHEMA}"`);
    await publicPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${TEST_SCHEMA}".snapshots (LIKE public.snapshots INCLUDING ALL)`);
    await publicPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${TEST_SCHEMA}".usage_events (LIKE public.usage_events INCLUDING ALL)`);
    await publicPrisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${TEST_SCHEMA}".budgets (LIKE public.budgets INCLUDING ALL)`);
    await publicPrisma.$disconnect();

    // Now import prisma and route bound to the isolated schema
    await importClients();
    await prisma.$connect();
  });

  afterAll(async () => {
    await reset();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await reset();
  });

  it('returns correct shape and values', async () => {
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
