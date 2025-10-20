# Scraper Core Invariants

The `scraper/` directory hosts the stateless core that powers the worker. Each module is
pure and deterministic so the outer orchestration can be tested with adapters. The core
functions obey the following invariants:

## Ordering

* Stable views are hashed after sorting normalized usage events by `model` (ascending),
  `total_tokens` (ascending), and `api_cost_cents` (ascending).
* Deltas preserve the order emitted by normalization; the filter never reorders rows.

## Hash Projection

* The table hash projects each normalized row to the following fields before hashing:
  `model`, `kind`, `max_mode`, `input_with_cache_write_tokens`,
  `input_without_cache_write_tokens`, `cache_read_tokens`, `output_tokens`,
  `total_tokens`, `api_cost_cents`, `api_cost_raw`, `cost_to_you_cents`,
  and `cost_to_you_raw`.
* The billing period persisted in the hash is the UTC `YYYY-MM-DD` slice of the first
  normalized row's `billing_period_start` / `billing_period_end`.

## Equality Semantics

* CSV parsing normalizes numeric columns to numbers and trims strings. Equality at the
  table level is determined by the stable hash. Idempotency on raw blobs is enforced by
  comparing the SHA-256 of the original payload bytes before gzip.
* Per-row equality inside downstream storage relies on the `row_hash` emitted by
  `mapNetworkJson`, which in turn inherits the normalized payload produced here.

## Time Semantics

* CSV rows carry their original `Date` column as a `captured_at` timestamp, but
  downstream normalization injects the orchestration clock (`capturedAt`) so test runs
  can override time by swapping the injected clock.
* Delta computation compares the normalized row timestamps against the latest persisted
  capture; passing a `null` cutoff replays the entire normalized set.
