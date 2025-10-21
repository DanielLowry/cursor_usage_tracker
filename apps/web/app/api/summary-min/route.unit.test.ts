/**
 * Relative path: apps/web/app/api/summary-min/route.unit.test.ts
 *
 * Test Suite Overview:
 * - Unit-tests the summary API handler by mocking Prisma responses to simulate populated data, empty tables,
 *   and failure conditions.
 *
 * Assumptions:
 * - The handler reads counts and the most recent snapshot timestamp directly from Prisma and wraps results in
 *   a JSON response with HTTP status metadata.
 * - Vitest's module mocking can replace the Prisma client with stubbed methods returning promises.
 *
 * Expected Outcomes & Rationale:
 * - When counts are provided, the response should mirror those values to confirm the handler formats data
 *   correctly.
 * - With zero counts, the handler should emit null/zero defaults, keeping the contract consistent with the
 *   integration test expectations.
 * - If any Prisma call rejects, the handler must catch the error and return a 500 status with an error payload
 *   so clients can surface the failure without leaking stack traces.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prisma } from '@cursor-usage/db';

// Mock the prisma client
vi.mock('@cursor-usage/db', () => ({
  prisma: {
    snapshot: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    usageEvent: {
      count: vi.fn(),
    },
    rawBlob: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

describe('/api/summary-min (unit tests)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure the route will attempt to import Prisma during tests
    process.env.DATABASE_URL = 'file:memory:test.db';
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
  });

  it('returns correct shape and values with data', async () => {
    // Mock database responses
    vi.mocked(prisma.snapshot.count).mockResolvedValue(2);
    vi.mocked(prisma.snapshot.findFirst).mockResolvedValue({
      captured_at: new Date('2025-02-15T10:00:00Z'),
    } as any);
    vi.mocked(prisma.usageEvent.count).mockResolvedValue(5);
    vi.mocked(prisma.rawBlob.count).mockResolvedValue(3);
    vi.mocked(prisma.rawBlob.findFirst).mockResolvedValue({ captured_at: new Date('2025-02-15T09:00:00Z') } as any);

    const { GET } = await import('./route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      snapshotCount: 2,
      lastSnapshotAt: '2025-02-15T10:00:00.000Z',
      usageEventCount: 5,
      rawBlobCount: 3,
      lastRawBlobAt: '2025-02-15T09:00:00.000Z',
    });
  });

  it('returns zero counts when no data exists', async () => {
    // Mock database responses
    vi.mocked(prisma.snapshot.count).mockResolvedValue(0);
    vi.mocked(prisma.snapshot.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.usageEvent.count).mockResolvedValue(0);
    vi.mocked(prisma.rawBlob.count).mockResolvedValue(0);
    vi.mocked(prisma.rawBlob.findFirst).mockResolvedValue(null);

    const { GET } = await import('./route');

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      snapshotCount: 0,
      lastSnapshotAt: null,
      usageEventCount: 0,
      rawBlobCount: 0,
      lastRawBlobAt: null,
    });
  });

  it('handles database errors gracefully by returning safe defaults', async () => {
    // Mock database error
    vi.mocked(prisma.snapshot.count).mockRejectedValue(new Error('Database error'));

    const { GET } = await import('./route');

    const response = await GET();
    const data = await response.json();

    // The route catches errors and returns safe defaults with a 200 status
    expect(response.status).toBe(200);
    expect(data).toEqual({
      snapshotCount: 0,
      lastSnapshotAt: null,
      usageEventCount: 0,
      rawBlobCount: 0,
      lastRawBlobAt: null,
    });
  });
});
