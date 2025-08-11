# Cursor Usage Tracker

This project tracks and visualizes your Cursor Pro usage without Admin API access. It follows the 2025 stack defined in `SPEC.md` (TypeScript, Next.js App Router, Prisma/Postgres, Redis, BullMQ, Playwright workers, Auth.js, Sentry, OpenTelemetry).

This repository is developed in phases. Phase 0 focuses only on bootstrapping your environment and confirming prerequisites.

## Prerequisites
- Node.js 20.x (use `nvm`/`nvm-windows` to pin 20.x)
- pnpm 9 (via Corepack)
- Docker (Docker Desktop on Windows; Docker Engine on Linux)
- Git

If Node is not installed yet, see the OS-specific guides below.

## OS-specific install guides
- Windows: `docs/INSTALL.windows.md`
- Linux (Ubuntu/Debian): `docs/INSTALL.linux.md`

## Quick verification (Phase 0 checks)
Run the following to verify your toolchain. Expected outputs are described in each install guide.

```powershell
# Windows PowerShell
node -v
corepack enable
corepack prepare pnpm@9 --activate
pnpm -v
docker --version
git rev-parse --is-inside-work-tree
```

```bash
# Linux
node -v
corepack enable
corepack prepare pnpm@9 --activate
pnpm -v
docker --version
git rev-parse --is-inside-work-tree
```

## Node version
This repo includes an `.nvmrc` with `20`. Use your OS package manager plus `nvm`/`nvm-windows` to ensure Node 20.x. If you install a newer Node, switch to 20.x to match the toolchain.

## References
- Specification: `SPEC.md`
- Acceptance Criteria: `ACCEPTANCE.md`
- License: `LICENSE` (PUSL-1.0 — personal use only)


