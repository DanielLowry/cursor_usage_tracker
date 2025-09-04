import { NextResponse } from 'next/server';
import { prisma } from '@cursor-usage/db';

export async function GET() {
  try {
    // Get snapshot count
    const snapshotCount = await prisma.snapshot.count();

    // Get last snapshot timestamp
    const lastSnapshot = await prisma.snapshot.findFirst({
      orderBy: { captured_at: 'desc' },
      select: { captured_at: true },
    });
    const lastSnapshotAt = lastSnapshot?.captured_at?.toISOString() || null;

    // Get usage event count
    const usageEventCount = await prisma.usageEvent.count();

    return NextResponse.json({
      snapshotCount,
      lastSnapshotAt,
      usageEventCount,
    });
  } catch (error) {
    console.error('Error fetching summary data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch summary data' },
      { status: 500 }
    );
  }
}