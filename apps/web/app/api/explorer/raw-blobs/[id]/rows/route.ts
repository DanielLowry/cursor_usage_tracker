// Relative path: apps/web/app/api/explorer/raw-blobs/[id]/rows/route.ts

import { NextResponse } from 'next/server';
import prisma from '../../../../../../../../packages/db/src/client';
import { gunzipBuffer, parseCsvPage } from '../../../../../../app/api/_utils/csv';

// Always fetch blob content dynamically from the database
export const dynamic = 'force-dynamic';

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '100', 10);
  const q = (searchParams.get('q') || '').trim();

  const take = clamp(pageSize, 1, 1000);
  const safePage = Math.max(1, page);

  const id = ctx.params.id;
  const blob = await (prisma as any).rawBlob.findUnique({
    where: { id },
    select: { payload: true, content_type: true },
  });
  if (!blob) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Decompress; bound size roughly by early bail if text exceeds 5MB
  const gz = blob.payload as Buffer;
  const buf = await gunzipBuffer(Buffer.from(gz));
  if (buf.byteLength > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  const csvText = buf.toString('utf8');
  const pageData = parseCsvPage(csvText, safePage, take, q);
  return NextResponse.json(pageData);
}

