# Scraper core invariants

The pure helpers under `core/` provide the functional core for CSV ingestion. They share a few
non-negotiable invariants that the orchestrator relies on when coordinating I/O and persistence.

## Ordering and table hashing

`computeTableHash` sorts normalized events by model (alphabetical) and then by `total_tokens`
before projecting a minimal view that includes the billing period bounds. The hash input keeps only
the deterministic fields that describe the tabular usage summary (`model`, token counts, cost
fields, and optional mode metadata). This guarantees identical CSV captures yield the same stable
hash regardless of fetch order.【F:apps/worker/src/workers/scraper/core/tableHash.ts†L18-L55】

## Equality and idempotency

Blob deduplication happens first via `ensureBlob`, which short-circuits on a repeated `content_hash`
and returns the existing blob identifier. Downstream, `computeDeltaEvents` filters out events whose
`captured_at` timestamps are not strictly newer than the latest persisted capture for the billing
period, so we only emit true deltas into the database.【F:apps/worker/src/workers/scraper.ts†L248-L317】【F:apps/worker/src/workers/scraper/core/delta.ts†L1-L8】

## Field projections used for hashing

The stable view used for hashing includes only the normalized presentation fields: per-row token
counts, cost cents/raw strings, the optional `kind`/`max_mode` metadata, and the normalized billing
period. No transient identifiers or timestamps participate in the hash, keeping the projection
minimal and deterministic.【F:apps/worker/src/workers/scraper/core/tableHash.ts†L24-L55】

## Time semantics

The orchestrator injects the scrape `now` timestamp into both blob persistence and normalization.
`ensureBlob` stores the precise capture timestamp on raw blobs, while `normalizeNetworkPayload`
passes the same `capturedAt` into `mapNetworkJson` so every normalized row reflects the scrape
moment. This keeps later comparisons deterministic and ensures deltas compare timestamps in the
same time base.【F:apps/worker/src/workers/scraper.ts†L246-L317】【F:apps/worker/src/workers/scraper/core/normalize.ts†L24-L44】
