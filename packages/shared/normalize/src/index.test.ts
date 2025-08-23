import { describe, it, expect } from 'vitest';
import { parseCurrencyToCents, parseIntSafe, toUtcMidnight, truncateToHour } from './index';

describe('parseCurrencyToCents', () => {
  it('parses common formats', () => {
    expect(parseCurrencyToCents('$1,234.56')).toBe(123456);
    expect(parseCurrencyToCents('1,234.56')).toBe(123456);
    expect(parseCurrencyToCents('1234')).toBe(123400);
    expect(parseCurrencyToCents('0.01')).toBe(1);
    expect(parseCurrencyToCents('0.009')).toBe(1);
    expect(parseCurrencyToCents('0.004')).toBe(0);
  });

  it('handles negatives and symbols', () => {
    expect(parseCurrencyToCents('-$12.34')).toBe(-1234);
    expect(parseCurrencyToCents('(12.34)')).toBe(-1234); // accounting style parentheses
  });

  it('blanks or invalid → 0', () => {
    expect(parseCurrencyToCents('')).toBe(0);
    expect(parseCurrencyToCents('   ')).toBe(0);
    // @ts-expect-error test invalid
    expect(parseCurrencyToCents(null)).toBe(0);
    // @ts-expect-error test invalid
    expect(parseCurrencyToCents(undefined)).toBe(0);
    expect(parseCurrencyToCents('abc')).toBe(0);
  });
});

describe('parseIntSafe', () => {
  it('parses integers with commas', () => {
    expect(parseIntSafe('1,234')).toBe(1234);
    expect(parseIntSafe('  2,000  ')).toBe(2000);
  });

  it('floats are truncated', () => {
    expect(parseIntSafe('123.9')).toBe(123);
  });

  it('blanks or invalid → 0', () => {
    expect(parseIntSafe('')).toBe(0);
    // @ts-expect-error test invalid
    expect(parseIntSafe(null)).toBe(0);
    expect(parseIntSafe('abc')).toBe(0);
  });
});

describe('UTC helpers', () => {
  it('toUtcMidnight respects UTC (independent of local tz)', () => {
    const d = new Date('2025-01-15T23:59:59.999Z');
    const m = toUtcMidnight(d);
    expect(m.toISOString()).toBe('2025-01-15T00:00:00.000Z');
  });

  it('truncateToHour truncates to start of hour in UTC', () => {
    const d = new Date('2025-01-15T12:34:56.789Z');
    const t = truncateToHour(d);
    expect(t.toISOString()).toBe('2025-01-15T12:00:00.000Z');
  });

  it('handles offsets correctly', () => {
    const d = new Date('2025-06-01T03:15:00-07:00');
    const m = toUtcMidnight(d);
    expect(m.toISOString()).toBe('2025-06-01T00:00:00.000Z');
    const t = truncateToHour(d);
    expect(t.toISOString()).toBe('2025-06-01T10:00:00.000Z');
  });
});


