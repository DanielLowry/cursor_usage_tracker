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
import { renderToStaticMarkup } from 'react-dom/server';
import DashboardPage from './page';

function getTestIdValue(html: string, testId: string) {
  const match = html.match(new RegExp(`data-testid="${testId}">(.*?)<`));
  return match ? match[1] : null;
}

describe('DashboardPage', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch as never;
  });

  it('renders summary text with API data', async () => {
    const timestamp = '2025-02-15T10:00:00.000Z';
    vi.spyOn(global, 'fetch' as never).mockResolvedValue({
      ok: true,
      json: async () => ({ snapshotCount: 3, lastSnapshotAt: timestamp, usageEventCount: 7 }),
    } as never);

    const ui = await DashboardPage();
    const html = renderToStaticMarkup(ui as JSX.Element);

    expect(getTestIdValue(html, 'snapshot-count')).toBe('3');
    expect(getTestIdValue(html, 'usage-event-count')).toBe('7');
    // Component formats the timestamp with toLocaleString(); assert against that localized value
    expect(getTestIdValue(html, 'last-snapshot-at')).toBe(new Date(timestamp).toLocaleString());
  });

  it('renders fallback values if API fails', async () => {
    vi.spyOn(global, 'fetch' as never).mockRejectedValue(new Error('network'));

    const ui = await DashboardPage();
    const html = renderToStaticMarkup(ui as JSX.Element);

    expect(getTestIdValue(html, 'snapshot-count')).toBe('0');
    expect(getTestIdValue(html, 'usage-event-count')).toBe('0');
    expect(getTestIdValue(html, 'last-snapshot-at')).toBe('—');
  });
});
