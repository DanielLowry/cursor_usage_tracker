// Relative path: apps/web/app/api/summary-min/route.ts

import { NextResponse } from 'next/server';

// Avoid importing Prisma at build time when DATABASE_URL isn't set; return safe defaults.
const DATABASE_URL = process.env.DATABASE_URL;

export async function GET() {
  if (!DATABASE_URL) {
    // During static builds or environments without a database, return safe defaults.
    return NextResponse.json({
      snapshotCount: 0,
      lastSnapshotAt: null,
      usageEventCount: 0,
    });
  }

  // Import Prisma lazily so building without DATABASE_URL won't attempt to initialize it.
  try {
    const { prisma } = await import('@cursor-usage/db');

    const snapshotCount = await prisma.snapshot.count();

    const lastSnapshot = await prisma.snapshot.findFirst({
      orderBy: { captured_at: 'desc' },
      select: { captured_at: true },
    });
    const lastSnapshotAt = lastSnapshot?.captured_at?.toISOString() || null;

    const usageEventCount = await prisma.usageEvent.count();

    return NextResponse.json({ snapshotCount, lastSnapshotAt, usageEventCount });
  } catch (error) {
    console.error('Error fetching summary data:', error);
    return NextResponse.json({ snapshotCount: 0, lastSnapshotAt: null, usageEventCount: 0 });
  }
}