# Scraper Core Invariants

The scraper worker follows a functional core / imperative shell split. All deterministic
logic for parsing, normalization, hashing, and delta computation lives in
`apps/worker/src/workers/scraper/core`. The shell (`scraper.ts`) handles orchestration,
I/O, and persistence.

## Ordering guarantees

* `buildStableViewHash` sorts normalized events by `model` (ascending) and then by
  `total_tokens` (ascending). This produces a deterministic table projection regardless
  of the ingestion order.

## Hash projection

* The stable view hash is derived from a projection that includes:
  * Billing period start/end rendered as `YYYY-MM-DD` strings (or `null` when absent).
  * Per-row fields: `model`, `kind`, `max_mode`, token counts, `api_cost_cents`,
    `api_cost_raw`, `cost_to_you_cents`, and `cost_to_you_raw`.
* The projection intentionally excludes volatile fields (e.g. `captured_at`) so that
  the hash changes only when the logical table contents change.

## Equality semantics

* Snapshot equality is defined by the stable view hash described above. Rows are
  considered equivalent when their projected fields match exactly; idempotency is
  enforced upstream by the shared `row_hash` produced during normalization.

## Time semantics

* The `captured_at` timestamp for normalized events is injected by the orchestrator
  (the current scrape time) and is the basis for delta selection.
* `computeDeltaEvents` filters out events whose `captured_at` is not strictly greater
  than the most recent persisted capture for the same billing period. When no prior
  capture exists, the entire set is returned.

