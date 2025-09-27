import React from 'react';

export default async function DashboardPage() {
  // Fetch minimal summary from local API route. In production this is intra-process.
  // During static build or when fetch fails, render safe defaults.
  type Summary = { snapshotCount: number; lastSnapshotAt: string | null; usageEventCount: number };
  let summary: Summary = { snapshotCount: 0, lastSnapshotAt: null, usageEventCount: 0 };

  try {
    const res = await fetch('http://localhost:3000/api/summary-min', { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as Summary;
      summary = data;
    }
  } catch {}

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>
        <div className="bg-white shadow rounded-lg p-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="bg-blue-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-blue-600">Snapshots</h3>
              <p className="text-2xl font-bold text-blue-900" data-testid="snapshot-count">
                {summary.snapshotCount}
              </p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-green-600">Last Snapshot</h3>
              <p className="text-sm text-green-900" data-testid="last-snapshot-at">
                {summary.lastSnapshotAt ? new Date(summary.lastSnapshotAt).toLocaleString() : '—'}
              </p>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg">
              <h3 className="text-sm font-medium text-purple-600">Usage Events</h3>
              <p className="text-2xl font-bold text-purple-900" data-testid="usage-event-count">
                {summary.usageEventCount}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
