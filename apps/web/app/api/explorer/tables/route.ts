// Relative path: apps/web/app/api/explorer/tables/route.ts

import { NextResponse } from 'next/server';

export async function GET() {
  const views = [
    'raw_csv',
    'raw_blobs',
    // snapshots: reserved for future implementation
    // This will expose a read-only view of the `snapshots` table and a
    // row inspector endpoint similar to raw blobs, with paginated rows
    // materialized from the normalized snapshot payload.
    'snapshots',
  ];
  return NextResponse.json({ views });
}


