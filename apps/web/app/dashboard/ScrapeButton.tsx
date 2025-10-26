"use client";

import React from 'react';
import { useState } from 'react';

export function ScrapeButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function triggerScrape() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/scrape-once', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'unknown error' }));
        throw new Error(String(data.error ?? `HTTP ${res.status}`));
      }
      // Refresh the page data to reflect new ingestion
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={triggerScrape}
        disabled={loading}
        className="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        data-testid="scrape-once-button"
      >
        {loading ? 'Starting…' : 'Start scrape'}
      </button>
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </div>
  );
}


