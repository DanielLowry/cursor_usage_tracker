import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import DashboardPage from './page';

describe('DashboardPage', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch as never;
  });

  it('renders summary text with API data', async () => {
    vi.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({ snapshotCount: 3, lastSnapshotAt: '2025-02-15T10:00:00.000Z', usageEventCount: 7 }),
    } as never);

    const ui = await DashboardPage();
    render(ui as unknown as JSX.Element);

    expect(screen.getByTestId('snapshot-count').textContent).toBe('3');
    expect(screen.getByTestId('usage-event-count').textContent).toBe('7');
    expect(screen.getByTestId('last-snapshot-at').textContent).toBe('2025-02-15T10:00:00.000Z');
  });

  it('renders fallback values if API fails', async () => {
    vi.spyOn(global, 'fetch' as never).mockRejectedValue(new Error('network'));

    const ui = await DashboardPage();
    render(ui as unknown as JSX.Element);

    expect(screen.getByTestId('snapshot-count').textContent).toBe('0');
    expect(screen.getByTestId('usage-event-count').textContent).toBe('0');
    expect(screen.getByTestId('last-snapshot-at').textContent).toBe('—');
  });
});
