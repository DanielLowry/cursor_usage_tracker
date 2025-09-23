/**
 * Test Suite Overview:
 * - Exercises the dashboard server component to confirm it renders API-derived statistics and handles error
 *   scenarios by showing sensible defaults.
 *
 * Assumptions:
 * - The page component fetches summary data via the global `fetch` API and renders values inside elements with
 *   stable `data-testid` attributes.
 * - Tests can mock `global.fetch` and await the async component before rendering its JSX snapshot.
 *
 * Expected Outcomes & Rationale:
 * - When the API returns data, the UI should display the provided counts and timestamp, proving the component
 *   parses and binds the JSON response correctly.
 * - When the fetch call rejects, the UI should fallback to zeros and an em dash, demonstrating resilience to
 *   upstream failures and maintaining predictable UX.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import DashboardPage from './page';

describe('DashboardPage', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    cleanup();
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
