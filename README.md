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
This repo includes an `.nvmrc` with `20`. Use your OS package manager plus `nvm`/`nvm-windows` to ensure Node 20.x. If you install a newer Node, switch to 20.x to match the toolchain.

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

1. **Create an environment file**

   Copy the example and fill in values for your setup:

   ```bash
   cp .env.example .env
   # edit .env to match your database, Redis and auth settings
   ```

2. **Start required services**

   A Postgres instance is provided via Docker Compose:

   ```bash
   pnpm db:up      # start Postgres in the background
   pnpm db:logs    # follow container logs
   pnpm db:down    # stop and remove the container
   ```

   Redis is also required for queues and caching. A quick local instance can be started with Docker:

   ```bash
   docker run --rm -p 6379:6379 redis:7
   ```

3. **Apply database migrations and seed data**

   ```bash
   pnpm --filter @cursor-usage/db db:migrate
   pnpm --filter @cursor-usage/db db:seed   # optional
   ```

4. **Auth consolidation overview**

   - Canonical state lives at `./data/cursor.state.json` (written atomically).
   - Runtime uses only the `Cookie` header derived from this file.
   - Uploaded session artifacts are encrypted with `SESSION_ENCRYPTION_KEY` and stored under `./data/diagnostics/` for troubleshooting only.
   - Validation hits `https://cursor.com/api/usage-summary` and requires `membershipType`, `billingCycleStart`, `billingCycleEnd` in the JSON body.

5. **Start development servers**

   ```bash
   pnpm dev  # runs web and worker apps concurrently
   ```

   Individual apps can be started as well:

   ```bash
   pnpm --filter @cursor-usage/web dev     # Next.js at http://localhost:3000
   pnpm --filter @cursor-usage/worker dev  # worker with watch mode
   ```

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

## References
- Specification: `SPEC.md`
- Acceptance Criteria: `ACCEPTANCE.md`
- License: `LICENSE` (PUSL-1.0 — personal use only)
