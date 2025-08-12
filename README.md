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