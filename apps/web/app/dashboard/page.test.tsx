import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardPage from './page';

// Mock the Prisma client
vi.mock('@cursor-usage/db', () => ({
  prisma: {
    $queryRaw: vi.fn()
  }
}));

describe('DashboardPage', () => {
  it('shows database connection status', async () => {
    const { prisma } = await import('@cursor-usage/db');
    
    // Test successful connection
    vi.mocked(prisma.$queryRaw).mockResolvedValueOnce([{ '1': 1 }]);
    const { container } = render(await DashboardPage());
    
    expect(screen.getByTestId('db-status')).toHaveTextContent('yes');
    
    // Test failed connection
    vi.mocked(prisma.$queryRaw).mockRejectedValueOnce(new Error('Connection failed'));
    const { container: container2 } = render(await DashboardPage());
    
    expect(screen.getByTestId('db-status')).toHaveTextContent('no');
  });
});
