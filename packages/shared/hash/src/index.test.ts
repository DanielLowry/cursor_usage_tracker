// Relative path: packages/shared/hash/src/index.test.ts

/**
 * Test Suite Overview:
 * - Validates deterministic canonicalization and hashing so that semantically equivalent objects produce the
 *   same hash while actual data mutations do not.
 *
 * Assumptions:
 * - `canonicalize` sorts object keys recursively and orders arrays by their canonical JSON representations.
 * - `stableHash` consumes the canonicalized value to produce consistent output across runs.
 *
 * Expected Outcomes & Rationale:
 * - Equivalent objects with different key or array orderings hash identically, preventing redundant snapshots
 *   for the same logical data.
 * - Different values yield different hashes to ensure real changes trigger persistence.
 */
import { describe, it, expect } from 'vitest';
import { canonicalize, stableHash } from './index';

describe('canonicalize', () => {
  it('sorts object keys recursively', () => {
    const a = { b: 2, a: 1, z: { y: 2, x: 1 } };
    const c = canonicalize(a) as Record<string, unknown>;
    expect(Object.keys(c)).toEqual(['a', 'b', 'z']);
    const z = c.z as Record<string, unknown>;
    expect(Object.keys(z)).toEqual(['x', 'y']);
  });

  it('sorts arrays by canonical JSON representation', () => {
    const arr1 = [ { a: 1, b: 2 }, { b: 2, a: 1 }, 3, 'x' ];
    const arr2 = [ 'x', 3, { b: 2, a: 1 }, { a: 1, b: 2 } ];
    expect(JSON.stringify(canonicalize(arr1))).toEqual(JSON.stringify(canonicalize(arr2)));
  });
});

describe('stableHash', () => {
  it('produces identical hash for logically equivalent but differently ordered objects', () => {
    const v1 = { model: 'gpt', rows: [ { a: 1, b: 2 }, { a: 2, b: 1 } ] };
    const v2 = { rows: [ { b: 1, a: 2 }, { b: 2, a: 1 } ], model: 'gpt' };
    expect(stableHash(v1)).toBe(stableHash(v2));
  });

  it('changes hash when data changes', () => {
    const v1 = { a: 1 };
    const v2 = { a: 2 };
    expect(stableHash(v1)).not.toBe(stableHash(v2));
  });
});



