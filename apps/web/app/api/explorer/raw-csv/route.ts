// Relative path: apps/web/app/api/explorer/raw-csv/route.ts

import { NextResponse } from 'next/server';
import { fetchLiveCsv } from '../../../api/_utils/cursorClient';
import { parseCsvPage } from '../../../api/_utils/csv';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '100', 10);
  const q = (searchParams.get('q') || '').trim();
  const take = clamp(pageSize, 1, 1000);

  try {
    const csvText = await fetchLiveCsv('./data');
    const data = parseCsvPage(csvText, Math.max(1, page), take, q);
    return NextResponse.json(data);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'fetch_failed' }, { status: 502 });
  }
}


