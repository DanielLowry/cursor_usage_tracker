import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$connect();
    console.log('Database connection successful');

    // Count rows in all tables
    const [usageEvents, ingestions, rawBlobs] = await Promise.all([
      prisma.usageEvent.count(),
      prisma.ingestion.count(),
      prisma.rawBlob.count(),
    ]);

    console.log('Row counts:', {
      usageEvents,
      ingestions,
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
