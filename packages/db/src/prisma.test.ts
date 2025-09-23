/**
 * Test Purpose:
 * - Confirms that the module exports a single Prisma client instance and that subsequent imports reuse the
 *   same object, preventing accidental creation of multiple database connections.
 *
 * Assumptions:
 * - `./index` implements the singleton pattern and caches the Prisma client in module scope.
 *
 * Expected Outcomes & Rationale:
 * - The exported `prisma` symbol is defined, proving initialization succeeds.
 * - Dynamically re-importing the module yields the same reference to confirm memoization, which is critical for
 *   connection pooling and predictable resource usage.
 */
import { describe, it, expect } from 'vitest';
import { prisma } from './index';

describe('Prisma singleton', () => {
  it('exports a Prisma client instance', () => {
    expect(prisma).toBeDefined();
  });

  it('is the same instance when importing again', async () => {
    const mod = await import('./index');
    expect(mod.prisma).toBe(prisma);
  });
}); 
