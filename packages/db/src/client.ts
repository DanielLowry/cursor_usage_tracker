/* eslint-disable @typescript-eslint/no-var-requires */
const PrismaClientModule: any = require('@prisma/client');
const PrismaClientCtor: any = PrismaClientModule?.PrismaClient;

// Persist a single PrismaClient instance across hot reloads in dev.
const globalForPrisma: any = globalThis as any;
const GLOBAL_KEY = '__cursor_usage_db_prisma__';

export const prisma: any = globalForPrisma[GLOBAL_KEY] ?? new PrismaClientCtor({
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error', 'warn'],
});

if (!globalForPrisma[GLOBAL_KEY]) globalForPrisma[GLOBAL_KEY] = prisma;

export default prisma; 