# Cursor Usage Tracker

This project tracks and visualizes your Cursor Pro usage without Admin API access. It follows the 2025 stack defined in `SPEC.md` (TypeScript, Next.js App Router, Prisma/Postgres, Redis, BullMQ, Playwright workers, Auth.js, Sentry, OpenTelemetry).

This repository is developed in phases. Phase 0 focuses only on bootstrapping your environment and confirming prerequisites.

## Prerequisites (high level)
- Node.js 20.x (use `nvm`/`nvm-windows` to pin 20.x)
- pnpm 9 (via Corepack)
- Docker (Docker Desktop on Windows; Docker Engine on Linux)
- Git

If Node is not installed yet, or for step-by-step verification commands, see the OS-specific guides below.

## OS-specific install guides
- Windows: `docs/INSTALL.windows.md`
- Linux (Ubuntu/Debian): `docs/INSTALL.linux.md`

## Node version
This repo includes an `.nvmrc` with `20`. Use your OS package manager plus `nvm`/`nvm-windows` to ensure Node 20.x. If you install a newer Node, switch to 20.x to match the toolchain.

## Monorepo quickstart
```bash
# Ensure pnpm via Corepack (Windows PowerShell: use docs/INSTALL.windows.md)
node -v  # should be v20.x
corepack enable
corepack prepare pnpm@9 --activate

# Install workspace deps
pnpm -w install

# Build all packages/apps
pnpm -w build

# Run web app (dev)
pnpm --filter @cursor-usage/web dev

# Run worker (dev)
pnpm --filter @cursor-usage/worker dev
```

## Workspace structure
```
.
├─ apps/
│  ├─ web/       # Next.js (App Router)
│  └─ worker/    # Node worker (Playwright jobs)
├─ packages/
│  ├─ db/        # Prisma schema and DB client (scaffold)
│  ├─ types/     # Shared TypeScript types
│  └─ config/    # Shared lint/TS config presets
├─ turbo.json
├─ pnpm-workspace.yaml
└─ tsconfig.json
```

## References
- Specification: `SPEC.md`
- Acceptance Criteria: `ACCEPTANCE.md`
- License: `LICENSE` (PUSL-1.0 — personal use only)


