// Relative path: apps/web/app/api/summary-min/route.ts

import { NextResponse } from 'next/server';

// Aggregated stats should reflect current database state
export const dynamic = 'force-dynamic';

// Avoid importing Prisma at build time when DATABASE_URL isn't set; return safe defaults.
const DATABASE_URL = process.env.DATABASE_URL;

export async function GET() {
  if (!DATABASE_URL) {
    // During static builds or environments without a database, return safe defaults.
    return NextResponse.json({
      snapshotCount: 0,
      lastSnapshotAt: null,
      usageEventCount: 0,
      rawBlobCount: 0,
      lastRawBlobAt: null,
      ingestionCount: 0,
      lastIngestionAt: null,
      lastUsageEventSeenAt: null,
    });
  }

  // Import Prisma lazily so building without DATABASE_URL won't attempt to initialize it.
  try {
    const { prisma } = await import('@cursor-usage/db');

    const usageEventCount = await prisma.usageEvent.count();

    const lastUsageEvent = await prisma.usageEvent.findFirst({
      orderBy: { last_seen_at: 'desc' },
      select: { last_seen_at: true },
    });
    const lastUsageEventSeenAt = lastUsageEvent?.last_seen_at?.toISOString() || null;

    const ingestionCount = await prisma.ingestion.count();
    const lastIngestion = await prisma.ingestion.findFirst({
      orderBy: { ingested_at: 'desc' },
      select: { ingested_at: true },
    });
    const lastIngestionAt = lastIngestion?.ingested_at?.toISOString() || null;

    // Raw blob stats
    const rawBlobCount = await prisma.rawBlob.count();
    const lastRawBlob = await prisma.rawBlob.findFirst({
      orderBy: { captured_at: 'desc' },
      select: { captured_at: true },
    });
    const lastRawBlobAt = lastRawBlob?.captured_at?.toISOString() || null;

    return NextResponse.json({
      snapshotCount: 0,
      lastSnapshotAt: null,
      usageEventCount,
      rawBlobCount,
      lastRawBlobAt,
      ingestionCount,
      lastIngestionAt,
      lastUsageEventSeenAt,
    });
  } catch (error) {
    console.error('Error fetching summary data:', error);
    return NextResponse.json({
      snapshotCount: 0,
      lastSnapshotAt: null,
      usageEventCount: 0,
      rawBlobCount: 0,
      lastRawBlobAt: null,
      ingestionCount: 0,
      lastIngestionAt: null,
      lastUsageEventSeenAt: null,
    });
  }
}
