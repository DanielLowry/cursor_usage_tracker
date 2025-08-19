const { PrismaClient } = require('@prisma/client');

(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    console.log('Database connection successful');
    const [usageEvents, snapshots, rawBlobs] = await Promise.all([
      prisma.usageEvent.count(),
      prisma.snapshot.count(),
      prisma.rawBlob.count(),
    ]);
    console.log('Row counts:', { usageEvents, snapshots, rawBlobs });
    process.exit(0);
  } catch (e) {
    console.error('Database connection test failed:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();


