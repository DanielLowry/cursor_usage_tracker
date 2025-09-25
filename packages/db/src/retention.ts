import prisma from './client';

/**
 * Trim raw_blobs table to last N rows by captured_at (descending),
 * preserving the newest rows and deleting older ones beyond the limit.
 * Returns the number of rows deleted.
 */
export async function trimRawBlobs(maxN = 20): Promise<number> {
  if (maxN <= 0) {
    const deletedAll = await prisma.rawBlob.deleteMany({});
    return deletedAll.count;
  }

  const total = await prisma.rawBlob.count();
  const overflow = total - maxN;

  if (overflow <= 0) {
    return 0; // fewer than maxN rows, nothing to trim
  }

  const victims = await prisma.rawBlob.findMany({
    orderBy: [
      { captured_at: 'asc' },
      { id: 'asc' },
    ],
    take: overflow,
    select: { id: true },
  });

  if (victims.length === 0) {
    return 0;
  }

  const deleted = await prisma.rawBlob.deleteMany({
    where: { id: { in: victims.map((v) => v.id) } },
  });

  return deleted.count;
}


