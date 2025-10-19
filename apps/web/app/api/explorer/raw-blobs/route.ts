// Relative path: apps/web/app/api/explorer/raw-blobs/route.ts

import { NextResponse } from 'next/server';
import prisma from '../../../../../../packages/db/src/client';

type Item = {
  id: string;
  captured_at: string;
  kind: string;
  url?: string | null;
  size_bytes?: number | null;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '100', 10);
  const q = (searchParams.get('q') || '').trim();
  const orderDir = (searchParams.get('orderDir') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  const take = clamp(pageSize, 1, 1000);
  const skip = (Math.max(1, page) - 1) * take;

  const where = q
    ? {
        OR: [
          { url: { contains: q, mode: 'insensitive' } },
          { kind: { equals: q as any } },
        ],
      }
    : {};

  const [total, rows] = await Promise.all([
    (prisma as any).rawBlob.count({ where }),
    (prisma as any).rawBlob.findMany({
      where,
      orderBy: { captured_at: orderDir },
      skip,
      take,
      select: {
        id: true,
        captured_at: true,
        kind: true,
        url: true,
        // size_bytes is not a stored column; approximate from payload length when needed
        payload: true,
      },
    }),
  ]);

  const items: Item[] = rows.map((r: any) => ({
    id: r.id,
    captured_at: new Date(r.captured_at).toISOString(),
    kind: String(r.kind),
    url: r.url ?? null,
    size_bytes: Array.isArray(r.payload) ? r.payload.length : (r.payload?.byteLength ?? null),
  }));

  return NextResponse.json({ items, total });
}


