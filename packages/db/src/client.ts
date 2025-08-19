
import { PrismaClient } from "@prisma/client";

// Persist a single PrismaClient instance across hot reloads in dev.
const globalForPrisma = globalThis as typeof globalThis & {
  __cursor_usage_db_prisma__?: PrismaClient;
};
const GLOBAL_KEY = '__cursor_usage_db_prisma__';

export const prisma = globalForPrisma[GLOBAL_KEY] ?? new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error', 'warn'],
  });

if (!globalForPrisma[GLOBAL_KEY]) globalForPrisma[GLOBAL_KEY] = prisma;

export default prisma;
