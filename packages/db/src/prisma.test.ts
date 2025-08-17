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