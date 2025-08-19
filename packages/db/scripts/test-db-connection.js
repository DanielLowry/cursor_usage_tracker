let PrismaClient;
try {
  PrismaClient = require('@prisma/client').PrismaClient;
} catch (err) {
  console.error('Prisma Client is not installed. Please run:');
  console.error('  pnpm --filter @cursor-usage/db install');
  console.error('Then generate/migrate:');
  console.error('  pnpm --filter @cursor-usage/db run db:generate');
  console.error('  pnpm --filter @cursor-usage/db run db:migrate');
  process.exit(1);
}

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


