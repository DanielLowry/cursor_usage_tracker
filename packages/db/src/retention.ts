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

  // Find the cutoff timestamp at position maxN (0-based index → skip maxN-1 newer rows)
  const nth = await prisma.rawBlob.findMany({
    orderBy: { captured_at: 'desc' },
    skip: maxN - 1,
    take: 1,
    select: { captured_at: true },
  });

  if (nth.length === 0) return 0; // fewer than maxN rows, nothing to trim

  const cutoffTs = nth[0].captured_at;

  // Delete strictly older than cutoff timestamp
  const result = await prisma.rawBlob.deleteMany({
    where: { captured_at: { lt: cutoffTs } },
  });

  // If there are multiple rows at the exact cutoff timestamp, we may still be > maxN
  // In that rare case, delete oldest among ties by id ordering.
  const totalAfterFirstPass = await prisma.rawBlob.count();
  if (totalAfterFirstPass > maxN) {
    const toDelete = totalAfterFirstPass - maxN;
    const extras = await prisma.rawBlob.findMany({
      where: { captured_at: cutoffTs },
      orderBy: { id: 'asc' },
      take: toDelete,
      select: { id: true },
    });
    if (extras.length > 0) {
      const del2 = await prisma.rawBlob.deleteMany({ where: { id: { in: extras.map((e) => e.id) } } });
      return result.count + del2.count;
    }
  }

  return result.count;
}


