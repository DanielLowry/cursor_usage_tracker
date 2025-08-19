import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // No-op seed - just verify connection
  await prisma.$connect();
  console.log('Database connection verified');
}

main()
  .catch((e) => {
    console.error('Error in seed script:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
