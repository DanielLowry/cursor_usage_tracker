// Relative path: apps/web/app/dashboard/page.tsx

import React from 'react';
import { ScrapeButton } from './ScrapeButton';

export default async function DashboardPage() {
  // Fetch minimal summary from local API route. In production this is intra-process.
  // During static build or when fetch fails, render safe defaults.
  type Summary = {
    usageEventCount: number;
    ingestionCount: number;
    lastIngestionAt: string | null;
    lastUsageEventSeenAt: string | null;
  };
  let summary: Summary = {
    usageEventCount: 0,
    ingestionCount: 0,
    lastIngestionAt: null,
    lastUsageEventSeenAt: null,
  };

  try {
    const res = await fetch('http://localhost:3000/api/summary-min', { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as Partial<Record<string, unknown>>;
      summary = {
        usageEventCount: Number(data.usageEventCount ?? 0),
        ingestionCount: Number(data.ingestionCount ?? 0),
        lastIngestionAt: (data.lastIngestionAt as string | null | undefined) ?? null,
        lastUsageEventSeenAt: (data.lastUsageEventSeenAt as string | null | undefined) ?? null,
      };
    }
  } catch {}

  const lastIngestionDisplay = summary.lastIngestionAt
    ? new Date(summary.lastIngestionAt).toLocaleString()
    : '—';
  const lastUsageEventDisplay = summary.lastUsageEventSeenAt
    ? new Date(summary.lastUsageEventSeenAt).toLocaleString()
    : '—';

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>
        <div className="bg-white shadow rounded-lg p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Trigger a new scrape run.</p>
            </div>
            <ScrapeButton />
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="bg-purple-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-purple-600">Usage Events</h3>
              <p className="text-2xl font-bold text-purple-900" data-testid="usage-event-count">
                {summary.usageEventCount}
              </p>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-blue-600">Ingestions</h3>
              <p className="text-2xl font-bold text-blue-900" data-testid="ingestion-count">
                {summary.ingestionCount}
              </p>
              <p className="mt-2 text-xs text-blue-900/70">Last run: {lastIngestionDisplay}</p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-green-600">Last Usage Event</h3>
              <p className="text-sm text-green-900" data-testid="last-usage-event-at">
                {lastUsageEventDisplay}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
