# Scraper core invariants

The scraper now follows a functional core / imperative shell split.  All stateless
logic lives in the `scraper/` directory so that orchestrator code in
`scraper.ts` only coordinates I/O.

## Modules

- `csv.ts` — parses Cursor usage CSV exports into a deterministic shape.
- `normalize.ts` — adapts parsed payloads (CSV or already-normalized JSON) into
  `NormalizedUsageEvent` records via `mapNetworkJson`.
- `tableHash.ts` — builds the stable snapshot view and hash input.
- `delta.ts` — filters normalized events down to the delta window.

## Invariants

### Ordering

All normalized events are sorted by **model** (lexicographic) and then by
**total_tokens** (ascending) before hashing.  This guarantees stable ordering
for identical datasets, regardless of the incoming CSV order.

### Hash projection

The table hash is computed from an object containing:

- `billing_period.start` / `billing_period.end` (ISO yyyy-mm-dd or `null`)
- Rows projected to `{ model, kind, max_mode, input_with_cache_write_tokens,
  input_without_cache_write_tokens, cache_read_tokens, output_tokens,
  total_tokens, api_cost_cents, api_cost_raw, cost_to_you_cents }`

No other fields influence the snapshot identity.

### Equality & dedupe

Row-level equality is defined downstream by `usage_events.row_hash`, which is
based on the normalized payload emitted by `mapNetworkJson`.  Because the core
modules never mutate events after normalization, the DB layer can safely reuse
row hashes to dedupe identical ingestions.

### Time semantics

- `captured_at` is injected by the orchestrator and passed into
  `normalizeCapturedPayload`, keeping tests deterministic.
- Billing period bounds (`billing_period.start`/`end`) originate from the CSV
  rows and are truncated to UTC midnights.
- Delta calculation only drops events whose `captured_at` is **strictly greater**
  than the latest persisted timestamp for the billing period; retries with the
  same capture timestamp are idempotent.
