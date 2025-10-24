// Relative path: packages/shared/hash/src/index.ts

import { createHash } from 'crypto';

/**
 * Canonicalize an arbitrary JS value into a JSON-serializable structure
 * with deterministic ordering:
 *  - Objects: keys sorted lexicographically
 *  - Arrays: elements sorted by their canonical JSON string
 * Assumptions: inputs are composed of JSON-like types (object/array/number/string/boolean/null)
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    // Primitive: return as-is (Numbers: ensure JSON-safe representation via stringify later)
    return value as never;
  }

  if (Array.isArray(value)) {
    // Canonicalize each element then sort by its JSON representation for order-insensitivity
    const canonicalElements = value.map((v) => canonicalize(v));
    const sorted = canonicalElements
      .map((v) => ({ v, s: JSON.stringify(v) }))
      .sort((a, b) => (a.s < b.s ? -1 : a.s > b.s ? 1 : 0))
      .map((x) => x.v);
    return sorted;
  }

  // Object: sort keys
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    out[k] = canonicalize(obj[k]);
  }
  return out;
}

/**
 * Compute a SHA-256 hex digest for a value using canonical JSON.
 */
export function stableHash(value: unknown): string {
  const canonical = canonicalize(value);
  const json = JSON.stringify(canonical);
  return createHash('sha256').update(json).digest('hex');
}

export function sha256(data: Buffer | string): string {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return createHash('sha256').update(buffer).digest('hex');
}
