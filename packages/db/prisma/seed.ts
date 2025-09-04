import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  await prisma.$connect();

  // Insert one budget row if none exists
  const count = await prisma.budget.count();
  if (count === 0) {
    await prisma.budget.create({ data: { effective_budget_cents: 5000 } });
    console.log('Seeded one budget row (effective_budget_cents=5000)');
  } else {
    console.log('Budget row already present, skipping.');
  }
}

main()
  .catch((e) => {
    console.error('Error in seed script:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
