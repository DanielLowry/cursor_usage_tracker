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
    <main className="p-4">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <div className="p-4 border rounded space-y-1">
        <p>Snapshots: <span data-testid="snapshot-count">{summary.snapshotCount}</span></p>
        <p>Last snapshot at: <span data-testid="last-snapshot-at">{summary.lastSnapshotAt ?? '—'}</span></p>
        <p>Usage events: <span data-testid="usage-event-count">{summary.usageEventCount}</span></p>
      </div>
    </main>
  );
}
