# Release Process

This project ships stand-alone release bundles so the web app can run without a full workspace checkout. The automation lives in `scripts/make_release.sh` and orchestrates package builds, the Next.js standalone output, and the final archive.

## Prerequisites

- macOS or Linux shell with `bash`, `zip`, `git`, and `pnpm` available.
- Production configuration in `.env.production.local`. The script sources this file before building.
- A clean Git worktree (unless you pass `--allow-dirty`).

## Usage

From the repository root run:

```bash
scripts/make_release.sh <version> [options]
```

Common options:

| Option            | Purpose                                                                 |
|-------------------|-------------------------------------------------------------------------|
| `--allow-dirty`   | Skip the clean git check (useful for local experiments).                |
| `--skip-install`  | Assume dependencies are already installed.                              |
| `--tag`           | Tag the current commit with `<version>`.                                |
| `--push-tag`      | Create the tag and push it to `origin`.                                 |
| `--skip-zip`      | Leave the assembled folder in `releases/` without creating a `.zip`.    |

Example: `scripts/make_release.sh v1.2.3 --tag --push-tag`

The script always ensures the release artifacts live under `releases/`:

- `releases/cursor-usage-web-<version>/` – expanded runtime bundle.
- `releases/cursor-usage-web-<version>.zip` – compressed archive (unless `--skip-zip`).

## What the script does

1. **Pre-flight checks**
   - Confirms it is run from the repo root and required tools exist.
   - Optionally enforces a clean git state.
   - Installs dependencies with `pnpm install --frozen-lockfile` unless `--skip-install`.
   - Exports `NODE_ENV=production` and sources `.env.production.local`.
   - Clears any existing release directory/archive for the requested version.

2. **Build internal packages**
   - Runs `pnpm --filter @cursor-usage/db run db:generate`.
   - Builds every `@cursor-usage/*` workspace except `web` and `worker`, using `--if-present` to skip packages without a `build` script.

3. **Build the Next.js app**
   - Executes `pnpm --filter @cursor-usage/web run build`, which produces `.next/standalone` and supporting static assets.

4. **Assemble the release folder**
   - Copies `.next/standalone` into `releases/cursor-usage-web-<version>/`.
   - Bundles `.next/static`, `public/`, and Prisma migrations (`packages/db/prisma/`) alongside the runtime.
   - Drops a short `README-release.md` with startup instructions.

5. **Package and tag**
   - Zips the assembled directory (unless `--skip-zip`).
   - Optionally creates and pushes a git tag when `--tag`/`--push-tag` are provided.

6. **Summary output**
   - Prints the paths to the release folder and zip.
   - Shows the command required to boot the server (`PORT=4000 node apps/web/server.js`).

## Deploying the bundle

1. Copy or unzip `releases/cursor-usage-web-<version>.zip` onto the host.
2. Create a `.env.production.local` file beside `README-release.md` with the secrets used at build time.
3. Start the server:

   ```bash
   NODE_ENV=production PORT=4000 node apps/web/server.js
   ```

Adjust `PORT` or additional environment variables as needed. The standalone bundle includes all compiled packages and node modules required to serve the app.
