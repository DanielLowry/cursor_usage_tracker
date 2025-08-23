/**
 * Normalization utilities for numeric parsing and UTC time helpers.
 */

/**
 * Parses a currency-like string to integer cents. Blanks or invalid inputs → 0.
 * Examples:
 *  - "$1,234.56" → 123456
 *  - "1,234" → 123400
 *  - "0.009" → 1 (round to nearest cent)
 */
export function parseCurrencyToCents(input: unknown): number {
  if (input == null) return 0;
  const raw = String(input).trim();
  if (raw === "") return 0;

  // Remove common currency symbols and whitespace; keep digits, minus, and dot
  const accountingNegative = /\(.*\)/.test(raw);
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return 0;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return 0;

  // Convert to cents, rounding to nearest integer
  const cents = Math.round(value * 100);
  return accountingNegative && cents > 0 ? -cents : cents;
}

/**
 * Parses an integer from a string safely. Strips commas and whitespace.
 * Non-numeric or blank inputs → 0.
 */
export function parseIntSafe(input: unknown): number {
  if (input == null) return 0;
  const raw = String(input).trim();
  if (raw === "") return 0;
  const cleaned = raw.replace(/,/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

/**
 * Returns a new Date at UTC midnight for the given date.
 */
export function toUtcMidnight(date: Date | number | string): Date {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Truncates a date/time down to the start of the hour in UTC.
 */
export function truncateToHour(date: Date | number | string): Date {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0));
}


