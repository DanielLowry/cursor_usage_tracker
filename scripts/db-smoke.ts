import prisma from "../packages/db/src/client";

export async function dbSmoke(): Promise<void> {
  await prisma.$connect();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
  } finally {
    await prisma.$disconnect();
  }
}

// Allow running directly: pnpm tsx scripts/db-smoke.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: any | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const module: any | undefined;

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  dbSmoke()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}


