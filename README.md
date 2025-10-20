# Cursor Usage Tracker

This project tracks and visualizes your Cursor Pro usage without Admin API access. It follows the 2025 stack defined in `SPEC.md` (TypeScript, Next.js App Router, Prisma/Postgres, Redis, BullMQ, Playwright workers, Auth.js, Sentry, OpenTelemetry).

This repository is developed in phases. Phase 0 focuses only on bootstrapping your environment and confirming prerequisites.

## Prerequisites (high level)

- Node.js 20.x (use `nvm`/`nvm-windows` to pin 20.x)
- pnpm 9 (via Corepack)
- Docker (Docker Desktop on Windows; Docker Engine on Linux)
- Git

If Node is not installed yet, or for step-by-step verification commands, see the OS-specific guides.

## OS-specific install guides

- Windows: [docs/INSTALL.windows.md](./docs/INSTALL.windows.md)
- Linux (Ubuntu/Debian): [docs/INSTALL.linux.md](./docs/INSTALL.linux.md)

## Node version

This repo includes an `.nvmrc` with `20`. Use your OS package manager plus `nvm`/`nvm-windows` to ensure Node 20.x. If you install a newer Node, switch to 20.x to match the toolchain.nvm

## Monorepo quickstart

After installing the prerequisites, the repository setup involves these high-level steps:

1.  **Install Dependencies:** Ensure Node.js, pnpm, and Docker are installed, then run the package installation command.
2.  **Build Workspace:** Compile all packages and applications.
3.  **Run Applications:** Start the development servers for the web and worker applications.

For specific commands and step-by-step instructions, please refer to the OS-specific installation guides.

## Workspace structure

```
.
├─ apps/
│  ├─ web/       # Next.js (App Router)
│  └─ worker/    # Node worker
├─ packages/
│  ├─ db/        # Prisma schema and DB client (scaffold)
│  ├─ types/     # Shared TypeScript types
│  └─ config/    # Shared lint/TS config presets
├─ turbo.json
├─ pnpm-workspace.yaml
└─ tsconfig.json
```

## Development workflow

These commands are run from the repository root unless noted otherwise.

### Install dependencies

```bash
pnpm install
```

### Generate the Prisma client

```bash
pnpm --filter @cursor-usage/db db:generate
```

### Build all packages and apps

```bash
pnpm build
```

### Type checking

```bash
pnpm typecheck
```

### Linting

```bash
pnpm lint
```

### Testing

```bash
pnpm test
```

### Formatting

```bash
# check without modifying files
pnpm format:check

# apply Prettier formatting
pnpm format
```

### Cleaning build artifacts

```bash
pnpm clean
```

## Running the application

This repository provides a small web app (`@cursor-usage/web`) and a worker (`@cursor-usage/worker`). The README below focuses on getting a local development environment running quickly and reproducibly.

1. **Create an environment file**

   Copy the provided example and fill in values for your environment. Note which scripts load which env file (important for migrations and worker scripts):

   ```bash
   cp .env.example .env
   # For local development scripts that explicitly load `.env.development.local`, also copy:
   cp .env.example .env.development.local
   # Or export DATABASE_URL and other variables before running migration/generation commands
   ```

   Tip: prefer editing `.env.development.local` when running `pnpm` scripts that explicitly load that file; use `.env` for generic environment variables.

2. **Start required services (Postgres, Redis)**

   We recommend using Docker Compose for a reproducible local Postgres instance. The repo exposes helper scripts that use Docker Compose:

   ```bash
   pnpm db:up      # start Postgres in the background (via docker-compose)
   pnpm db:logs    # follow container logs
   pnpm db:down    # stop and remove the container
   ```

   Alternatives and notes:
   - **Docker one-off** (useful without compose):

     ```bash
     docker run --rm -p 5432:5432 -v ~/pgdata:/var/lib/postgresql/data -e POSTGRES_PASSWORD=postgres postgres:15
     ```

   - **System package (Ubuntu/Debian)**:

     ```bash
     sudo apt update && sudo apt install -y postgresql postgresql-contrib
     # If you need a local data directory used by `pnpm pg:start`, initialize it:
     initdb -D ~/pgdata
     ```

   - **Windows / WSL**: Use Docker Desktop or the official Windows installer. Inside WSL, follow the Linux instructions.

   Postgres version: this project is tested with Postgres 15; using the `postgres:15` Docker image or equivalent package is recommended.

   `pnpm pg:start` helper
   - The repository includes `pnpm pg:start` which runs:

     ```bash
     pg_ctl -D ~/pgdata -l ~/pgdata/server.log start
     ```

   - Note: some distro installs provide `initdb`/`pg_ctl` but do not add them to the shell `PATH`. If `initdb` or `pg_ctl` is not found, run them with the full path (for example `/usr/lib/postgresql/15/bin/initdb`) or add the Postgres binary directory to your `PATH`.

   - After installing Postgres, ensure a data directory exists at `~/pgdata` (for example via `initdb -D ~/pgdata`) so that `pnpm pg:start` can start the server.

   - To stop the server started by `pg_ctl`:

     ```bash
     pg_ctl -D ~/pgdata stop -s -m fast
     ```

   Redis (queues & caching)
   - For quick local development, run Redis ephemeral with:

     ```bash
     docker run --rm -p 6379:6379 redis:7
     ```

   - For persistent local state during multi-run development, run with a volume:

     ```bash
     docker run -d -p 6379:6379 -v ~/redisdata:/data --name redis redis:7
     ```

3. **Apply database migrations and seed data**

   Ensure your `DATABASE_URL` is set (either in `.env`/`.env.development.local` or exported) and then run:

   ```bash
   pnpm --filter @cursor-usage/db db:generate
   pnpm --filter @cursor-usage/db db:migrate
   pnpm --filter @cursor-usage/db db:seed   # optional
   ```

   Note: `prisma generate` and `migrate` read the `DATABASE_URL` from your environment; if you use `pnpm db:up` you may need to copy `.env.example` to `.env.development.local` so the scripts can discover the value.

4. **Auth consolidation overview**
   - Canonical state lives at `./data/cursor.state.json` (written atomically).
   - Runtime uses only the `Cookie` header derived from this file.
   - Uploaded session artifacts are encrypted with `SESSION_ENCRYPTION_KEY` and stored under `./data/diagnostics/` for troubleshooting only.
   - Validation hits `https://cursor.com/api/usage-summary` and requires `membershipType`, `billingCycleStart`, `billingCycleEnd` in the JSON body.

5. **Start development servers**

   ```bash
   pnpm dev  # runs web and worker apps concurrently
   ```

   Or run apps individually (useful while developing one component):

   ```bash
   pnpm --filter @cursor-usage/web dev     # Next.js at http://localhost:3000
   pnpm --filter @cursor-usage/worker dev  # worker with watch mode
   ```

   Ports used (common defaults):
   - Web: 3000
   - Postgres: 5432
   - Redis: 6379

## Data Flow: Raw Blobs and Snapshots

- Raw blob capture
  - The scraper authenticates to Cursor and downloads the usage export (currently CSV). The original payload is stored in `raw_blobs.payload` as gzipped bytes, along with metadata (`content_hash`, `content_type`, `schema_version`). A short retention policy trims old blobs.
  - A `content_hash` (sha256 of the pre-gzip payload) prevents storing duplicate blobs; if a duplicate is detected, we skip the insert but still process the payload.

- Inline snapshot creation
  - Immediately after each capture (or dedup hit), the worker parses the payload and calls `createSnapshotIfChanged`. For JSON/network payloads this runs now; CSV parsing is planned next.
  - Usage rows are normalized into `usage_events`. Each row gets a stable `row_hash` so repeated CSVs don’t duplicate events (idempotent upsert).
  - A stable table hash is computed per billing period; if unchanged, no new snapshot row is written (idempotent snapshotting).

- Why both layers?
  - Raw blobs are the immutable source-of-truth for audit and future reprocessing.
  - Snapshots + usage events are query-friendly, deduplicated materializations for the UI and APIs.

## Deduplication and Idempotence

- Blob-level: `raw_blobs.content_hash` (sha256 of raw payload) avoids storing identical captures.
- Row-level: `usage_events.row_hash` (sha256 of normalized salient fields) avoids duplicate usage rows across re-ingestions.
- Snapshot-level: stable table hash per billing period prevents duplicate snapshots when nothing changed.

## Glossary (quick reference)

- **raw_blob**: Immutable stored capture of the original payload (gzipped bytes) with provenance metadata. Stored in `raw_blobs.payload` with `content_hash` used for deduplication.
- **payload**: The raw bytes fetched from Cursor (CSV text or JSON) before gzip compression.
- **normalizedEvents / usage_events**: Rows produced by `mapNetworkJson` — normalized usage records used to build snapshots and insert into the `usage_events` table.
- **billing period**: The start/end date range (YYYY-MM-DD) covering events in a capture; used to group snapshots.
- **stable view / tableHash**: Deterministic representation of a billing period's table (billing bounds + ordered row summaries) hashed via `stableHash` to detect changes.
- **row_hash**: Stable per-row hash used by `usage_events` to dedupe identical rows across re-ingestions.
- **snapshot**: Materialized record representing a `tableHash` for a billing period; persisted when the stable view changes.
- **delta**: The set of `normalizedEvents` newer than the latest existing `captured_at` for the billing period; only the delta is inserted to avoid re-inserting previous rows.
- **createSnapshotWithDelta**: DB helper that persists snapshot metadata and inserts delta `usage_events` for a capture.
- **trimRawBlobs**: Retention helper that keeps only the newest N `raw_blob` records and deletes older ones.

## Summary API

- Route: `apps/web/app/api/summary-min/route.ts` returns:
  - `snapshotCount`: number of rows in `snapshots`
  - `lastSnapshotAt`: most recent snapshot timestamp
  - `usageEventCount`: total usage events
  - `rawBlobCount`: number of raw blobs stored
  - `lastRawBlobAt`: most recent raw blob timestamp

6. **Run workers manually**

   ```bash
   pnpm workers:scraper                          # run scraper from repo root
   pnpm --filter @cursor-usage/worker onboard    # one-off onboarding script
   pnpm --filter @cursor-usage/worker worker:scheduler
   pnpm --filter @cursor-usage/worker worker:scraper
   ```

7. **Production build and start**

   ```bash
   pnpm build
   pnpm --filter @cursor-usage/web start
   pnpm --filter @cursor-usage/worker start
   ```

Troubleshooting checklist

- Check process and ports:

  ```bash
  ps aux | grep postgres
  ss -ltn | grep 5432
  ss -ltn | grep 6379
  ```

- Verify `initdb`/`pg_ctl` availability (may require full path):

  ```bash
  command -v initdb || echo "initdb not found; try /usr/lib/postgresql/<version>/bin/initdb"
  ```

- Docker volume permission issues (common on macOS/WSL): ensure `~/pgdata` is writable by the Postgres process or use a Docker-managed volume.

- Migration errors: confirm `DATABASE_URL` is set in the environment file the scripts load.

- If Postgres port is already in use, either stop the conflicting service or change the container/host port mapping.

## References

- Specification: `SPEC.md`
- Acceptance Criteria: `ACCEPTANCE.md`
- License: `LICENSE` (PUSL-1.0 — personal use only)
