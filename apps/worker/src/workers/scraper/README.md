# Scraper module layout

The scraper uses a functional core with thin infrastructure adapters. Pure
transformations live under `core/`, shared utilities in `lib/`, and database or
IO-bound adapters in `infra/`. The top-level orchestrator wires these pieces
without importing platform dependencies directly.

## Directories

- `core/` — CSV parsing and payload normalization built on `mapNetworkJson`.
  Modules here are deterministic, side-effect free, and expose only named
  exports.
- `lib/` — shared helpers such as the CSV parser configuration, content hashing,
  and the canonical row-hash function re-export.
- `infra/` — Cursor- and Prisma-backed adapters for fetch, event-store access,
  and blob persistence. External dependencies (HTTP, crypto, zlib, Prisma) are
  isolated here.

## Invariants

- `NormalizedUsageEvent` is the single shape passed across boundaries.
- Row equality and dedupe rely exclusively on `row_hash` computed from the
  normalized payload; core modules never mutate records after hashing.
- Metadata keys follow the snake_case naming used in the database
  (`captured_at`, `billing_period_start`, `billing_period_end`, `row_hash`).
- `core/` stays side-effect free and does not read from the environment, file
  system, or network. All IO flows through the ports defined in `ports.ts` and
  their implementations under `infra/`.
