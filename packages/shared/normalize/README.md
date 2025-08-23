# @cursor-usage/normalize

Normalization utilities shared across the project.

Exports:
- `parseCurrencyToCents(input)` – parse currency-like strings to integer cents. Blanks/invalid → 0. Rounds to nearest cent. Handles `($12.34)` as negative.
- `parseIntSafe(input)` – parse integers safely (strips commas). Blanks/invalid → 0.
- `toUtcMidnight(date)` – return a new `Date` at UTC midnight for the given date.
- `truncateToHour(date)` – return a new `Date` truncated to the start of the hour (UTC).

Testing:
```
pnpm test
```

