// Relative path: apps/web/app/api/_utils/csv.ts

import * as zlib from 'zlib';
import { parse as parseCsv } from 'csv-parse/sync';

export type ParsedCsvPage = {
  columns: string[];
  rows: string[][];
  totalRows: number;
};

export async function gunzipBuffer(input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gunzip(input, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

export function parseCsvPage(
  csvText: string,
  page: number,
  pageSize: number,
  q?: string
): ParsedCsvPage {
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const safePageSize = clamp(pageSize || 100, 1, 1000);
  const safePage = Math.max(1, page || 1);

  const records: Array<Record<string, string>> = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const allColumns = records.length > 0 ? Object.keys(records[0]) : [];
  const filter = (q || '').toLowerCase();
  const filtered = filter
    ? records.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(filter)))
    : records;

  const totalRows = filtered.length;
  const start = (safePage - 1) * safePageSize;
  const end = start + safePageSize;
  const slice = filtered.slice(start, end);

  const rows = slice.map((r) => allColumns.map((c) => String((r as any)[c] ?? '')));

  return { columns: allColumns, rows, totalRows };
}


