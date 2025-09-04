import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
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
  },
}));

describe('/api/summary-min (unit tests)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct shape and values with data', async () => {
    // Mock database responses
    vi.mocked(prisma.snapshot.count).mockResolvedValue(2);
    vi.mocked(prisma.snapshot.findFirst).mockResolvedValue({
      captured_at: new Date('2025-02-15T10:00:00Z'),
    });
    vi.mocked(prisma.usageEvent.count).mockResolvedValue(5);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      snapshotCount: 2,
      lastSnapshotAt: '2025-02-15T10:00:00.000Z',
      usageEventCount: 5,
    });
  });

  it('returns zero counts when no data exists', async () => {
    // Mock database responses
    vi.mocked(prisma.snapshot.count).mockResolvedValue(0);
    vi.mocked(prisma.snapshot.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.usageEvent.count).mockResolvedValue(0);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      snapshotCount: 0,
      lastSnapshotAt: null,
      usageEventCount: 0,
    });
  });

  it('handles database errors gracefully', async () => {
    // Mock database error
    vi.mocked(prisma.snapshot.count).mockRejectedValue(new Error('Database error'));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({
      error: 'Failed to fetch summary data',
    });
  });
});
