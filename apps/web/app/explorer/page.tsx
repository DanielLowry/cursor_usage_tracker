// Relative path: apps/web/app/explorer/page.tsx

'use client';

import { useEffect, useMemo, useState } from 'react';

type BlobItem = {
  id: string;
  captured_at: string;
  kind: string;
  url?: string | null;
  size_bytes?: number | null;
};

function Pager({ page, setPage, total, pageSize }: { page: number; setPage: (n: number) => void; total: number; pageSize: number; }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center gap-2">
      <button className="px-3 py-1 border rounded" onClick={() => setPage(1)} disabled={page <= 1}>First</button>
      <button className="px-3 py-1 border rounded" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>Prev</button>
      <span className="text-sm">Page {page} / {totalPages}</span>
      <button className="px-3 py-1 border rounded" onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>Next</button>
      <button className="px-3 py-1 border rounded" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>Last</button>
    </div>
  );
}

function RawCsvViewer() {
  const [rows, setRows] = useState<string[][]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(q ? { q } : {}) });
      const res = await fetch(`/api/explorer/raw-csv?${params.toString()}`);
      const data = await res.json();
      setColumns(data.columns || []);
      setRows(data.rows || []);
      setTotalRows(data.totalRows || 0);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void fetchData(); }, [page, pageSize, q]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input className="border px-2 py-1 rounded" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="border px-2 py-1 rounded" value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value))}>
          {[25, 50, 100, 500, 1000].map((n) => (<option key={n} value={n}>{n}/page</option>))}
        </select>
        <button className="px-3 py-1 border rounded" onClick={() => void fetchData()}>Fetch latest</button>
        <div className="ml-auto"><Pager page={page} setPage={setPage} total={totalRows} pageSize={pageSize} /></div>
      </div>
      <div className="overflow-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100">
            <tr>{columns.map((c) => (<th key={c} className="text-left px-2 py-1 border-b">{c}</th>))}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td className="px-2 py-2" colSpan={columns.length || 1}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="px-2 py-2" colSpan={columns.length || 1}>No rows</td></tr>
            ) : rows.map((r, i) => (
              <tr key={i} className="odd:bg-white even:bg-gray-50">
                {r.map((v, j) => (<td key={j} className="px-2 py-1 border-b align-top">{v}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RawBlobGrid() {
  const [items, setItems] = useState<BlobItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [q, setQ] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [totalRows, setTotalRows] = useState(0);

  useEffect(() => {
    const load = async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), ...(q ? { q } : {}) });
      const res = await fetch(`/api/explorer/raw-blobs?${params.toString()}`);
      const data = await res.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
    };
    void load();
  }, [page, pageSize, q]);

  const openPreview = async (id: string) => {
    setPreviewId(id);
    const params = new URLSearchParams({ page: '1', pageSize: '100' });
    const res = await fetch(`/api/explorer/raw-blobs/${id}/rows?${params.toString()}`);
    const data = await res.json();
    setColumns(data.columns || []);
    setRows(data.rows || []);
    setTotalRows(data.totalRows || 0);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <input className="border px-2 py-1 rounded" placeholder="Search url/kind" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="border px-2 py-1 rounded" value={pageSize} onChange={(e) => setPageSize(parseInt(e.target.value))}>
          {[25, 50, 100, 500, 1000].map((n) => (<option key={n} value={n}>{n}/page</option>))}
        </select>
        <div className="ml-auto"><Pager page={page} setPage={setPage} total={total} pageSize={pageSize} /></div>
      </div>

      <div className="overflow-auto border rounded">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left px-2 py-1 border-b">Captured</th>
              <th className="text-left px-2 py-1 border-b">Kind</th>
              <th className="text-left px-2 py-1 border-b">URL</th>
              <th className="text-left px-2 py-1 border-b">Size</th>
              <th className="text-left px-2 py-1 border-b"></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td className="px-2 py-2" colSpan={5}>No blobs</td></tr>
            ) : items.map((it) => (
              <tr key={it.id} className="odd:bg-white even:bg-gray-50">
                <td className="px-2 py-1 border-b">{new Date(it.captured_at).toLocaleString()}</td>
                <td className="px-2 py-1 border-b">{it.kind}</td>
                <td className="px-2 py-1 border-b">{it.url || ''}</td>
                <td className="px-2 py-1 border-b">{it.size_bytes ?? ''}</td>
                <td className="px-2 py-1 border-b"><button className="px-2 py-1 border rounded" onClick={() => void openPreview(it.id)}>Preview</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {previewId && (
        <div className="border rounded p-3 bg-white shadow">
          <div className="flex items-center mb-2">
            <div className="font-semibold">Preview rows</div>
            <button className="ml-auto px-2 py-1 border rounded" onClick={() => setPreviewId(null)}>Close</button>
          </div>
          <div className="overflow-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>{columns.map((c) => (<th key={c} className="text-left px-2 py-1 border-b">{c}</th>))}</tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td className="px-2 py-2" colSpan={columns.length || 1}>No rows</td></tr>
                ) : rows.map((r, i) => (
                  <tr key={i} className="odd:bg-white even:bg-gray-50">
                    {r.map((v, j) => (<td key={j} className="px-2 py-1 border-b align-top">{v}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-gray-500 mt-1">Total rows: {totalRows}</div>
        </div>
      )}
    </div>
  );
}

export default function ExplorerPage() {
  const [tab, setTab] = useState<'raw_csv' | 'raw_blobs' | 'snapshots'>('raw_csv');
  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold">Raw Data Explorer</h1>
      <div className="flex gap-2">
        <button className={`px-3 py-1 border rounded ${tab==='raw_csv' ? 'bg-blue-600 text-white' : ''}`} onClick={() => setTab('raw_csv')}>Raw CSV</button>
        <button className={`px-3 py-1 border rounded ${tab==='raw_blobs' ? 'bg-blue-600 text-white' : ''}`} onClick={() => setTab('raw_blobs')}>Raw Blobs</button>
        <button className="px-3 py-1 border rounded opacity-60 cursor-not-allowed" title="Snapshots view (coming soon)">Snapshots</button>
      </div>
      {tab === 'raw_csv' && <RawCsvViewer />}
      {tab === 'raw_blobs' && <RawBlobGrid />}
      {/* Snapshots (future):
        - Provide `/api/explorer/snapshots` list endpoint with `{ id, captured_at, billing_period_start, billing_period_end, rows_count }` columns.
        - Provide `/api/explorer/snapshots/{id}/rows` to return materialized rows for preview (similar to raw blob rows), with pagination and search.
        - Default ordering by `captured_at desc`, capped page sizes, same search behavior.
      */}
    </div>
  );
}


