import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$connect();
    console.log('Database connection successful');

    // Count rows in all tables
    const [usageEvents, snapshots, rawBlobs] = await Promise.all([
      prisma.usageEvent.count(),
      prisma.snapshot.count(),
      prisma.rawBlob.count(),
    ]);

    console.log('Row counts:', {
      usageEvents,
      snapshots,
      rawBlobs,
    });

    process.exit(0);
  } catch (error) {
    console.error('Database connection test failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
