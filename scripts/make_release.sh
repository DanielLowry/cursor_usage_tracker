#!/usr/bin/env bash
#
# make_release.sh - Build a standalone production bundle for the Cursor Usage Tracker web app.
# The script orchestrates package builds, the Next.js standalone build, assembles runtime assets,
# and produces a versioned zip file that can be deployed directly.

set -Eeuo pipefail

###############################################################################
# Helper functions
###############################################################################

usage() {
  cat <<'EOF'
Usage: scripts/make_release.sh <version> [options]

Arguments:
  <version>           Release identifier (e.g. v1.0.0). Used in folder and tag names.

Options:
  --allow-dirty       Skip the clean Git check (useful for local experiments).
  --skip-install      Skip running "pnpm install --frozen-lockfile".
  --tag               Create a Git tag that matches <version>.
  --push-tag          Create the tag (implies --tag) and push it to origin.
  --skip-zip          Leave the assembled release directory in place without zipping it.
  -h, --help          Show this help message.

Examples:
  scripts/make_release.sh v1.2.3
  scripts/make_release.sh v1.2.3 --tag --push-tag
  scripts/make_release.sh 2024-07-01 --allow-dirty --skip-install
EOF
}

log() {
  printf '[make_release] %s\n' "$*"
}

fatal() {
  printf '[make_release] ERROR: %s\n' "$*" >&2
  exit 1
}

# Make unexpected command failures visible with location + last command
trap 'fatal "Command failed (exit=$?) at ${BASH_SOURCE[0]}:${LINENO}: $BASH_COMMAND"' ERR

ensure_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fatal "Required command \"$cmd\" is not available in PATH."
}

### (env file handling removed; release does not copy or load env files)

resolve_workspace_module_dir() {
  local module_name="$1"
  local resolved_path=""

  # Capture stdout without relying on assignment exit code
  resolved_path="$(pnpm --filter @cursor-usage/web exec node "$NODE_MODULES_HELPER" resolve "$module_name" 2>/dev/null || true)"

  # Trim trailing newline characters if any.
  resolved_path="${resolved_path//$'\r'/}"
  resolved_path="${resolved_path//$'\n'/}"

  if [[ -z "$resolved_path" || ! -d "$resolved_path" ]]; then
    fatal "Module \"$module_name\" could not be resolved from workspace."
  fi

  printf '%s' "$resolved_path"
}

copy_workspace_module() {
  local module_name="$1"
  local destination_root="$2"
  local destination_path="$destination_root/$module_name"
  local destination_parent

  destination_parent="$(dirname "$destination_path")"
  mkdir -p "$destination_parent"

  local source_dir
  source_dir="$(resolve_workspace_module_dir "$module_name")"

  rm -rf "$destination_path"
  cp -aL "$source_dir" "$destination_path"
}

# Resolve and copy a dependency relative to a base package (works with pnpm nested deps)
copy_dep_from_base() {
  local base_pkg="$1"
  local dep_name="$2"
  local destination_root="$3"

  local dest_path="$destination_root/$dep_name"
  local resolved_dir=""

  # Try resolving from the base package context first
  if resolved_dir="$(pnpm --filter @cursor-usage/web exec node "$NODE_MODULES_HELPER" resolve-from "$base_pkg" "$dep_name" 2>/dev/null || true)"; then
    :
  fi

  # Trim newlines
  resolved_dir="${resolved_dir//$'\r'/}"
  resolved_dir="${resolved_dir//$'\n'/}"

  # Fallback: resolve base dir then look for sibling under its node_modules
  if [[ -z "$resolved_dir" || ! -d "$resolved_dir" ]]; then
    local base_dir_out="$(pnpm --filter @cursor-usage/web exec node "$NODE_MODULES_HELPER" resolve "$base_pkg" 2>/dev/null || true)"
    base_dir_out="${base_dir_out//$'\r'/}"
    base_dir_out="${base_dir_out//$'\n'/}"
    if [[ -n "$base_dir_out" && -d "$base_dir_out" ]]; then
      local base_nm_dir
      base_nm_dir="$(dirname "$base_dir_out")"
      local candidate_path="$base_nm_dir/$dep_name"
      if [[ -d "$candidate_path" ]]; then
        resolved_dir="$candidate_path"
      fi
    fi
  fi

  # Fallback 2: locate via Next's parent node_modules (common for pnpm virtual store)
  if [[ -z "$resolved_dir" || ! -d "$resolved_dir" ]]; then
    local next_pkg_dir
    next_pkg_dir="$(pnpm --filter @cursor-usage/web exec node -e 'const p=require("path");try{console.log(p.dirname(require.resolve("next/package.json")))}catch(e){process.exit(0)}' 2>/dev/null || true)"
    next_pkg_dir="${next_pkg_dir//$'\r'/}"
    next_pkg_dir="${next_pkg_dir//$'\n'/}"
    if [[ -n "$next_pkg_dir" && -d "$next_pkg_dir" ]]; then
      local next_parent
      next_parent="$(dirname "$next_pkg_dir")"
      local candidate_path2="$next_parent/$dep_name"
      if [[ -d "$candidate_path2" ]]; then
        resolved_dir="$candidate_path2"
      fi
    fi
  fi

  if [[ -z "$resolved_dir" || ! -d "$resolved_dir" ]]; then
    log "warn: copy_dep_from_base: unable to resolve '$dep_name' from base '$base_pkg'"
    return 1
  fi

  mkdir -p "$(dirname "$dest_path")"
  rm -rf "$dest_path"
  cp -aL "$resolved_dir" "$dest_path"
}

detect_missing_node_modules() {
  local node_modules_dir="$1"
  node "$NODE_MODULES_HELPER" detect-missing "$node_modules_dir"
}

###############################################################################
# Parse arguments and validate execution context
###############################################################################

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

VERSION=""
ALLOW_DIRTY=false
SKIP_INSTALL=false
CREATE_TAG=false
PUSH_TAG=false
SKIP_ZIP=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --allow-dirty)
      ALLOW_DIRTY=true
      ;;
    --skip-install)
      SKIP_INSTALL=true
      ;;
    --tag)
      CREATE_TAG=true
      ;;
    --push-tag)
      CREATE_TAG=true
      PUSH_TAG=true
      ;;
    --skip-zip)
      SKIP_ZIP=true
      ;;
    -*)
      fatal "Unknown option: $1"
      ;;
    *)
      if [[ -n "$VERSION" ]]; then
        fatal "Version already specified as \"$VERSION\"; unexpected extra argument \"$1\"."
      fi
      VERSION="$1"
      ;;
  esac
  shift
done

[[ -n "$VERSION" ]] || fatal "A release version (e.g. v1.0.0) is required."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE_MODULES_HELPER="$REPO_ROOT/scripts/utils/node_modules_helper.js"

if [[ "$PWD" != "$REPO_ROOT" ]]; then
  fatal "Run this script from the repository root ($REPO_ROOT). Current directory is $PWD."
fi

[[ -f "pnpm-workspace.yaml" ]] || fatal "pnpm-workspace.yaml not found; make sure you are in the repository root."
[[ -f "$NODE_MODULES_HELPER" ]] || fatal "Expected helper script at $NODE_MODULES_HELPER"

ensure_command pnpm
ensure_command git
ensure_command zip
ensure_command node

###############################################################################
# Pre-flight checks and setup
###############################################################################

log "Preparing release $VERSION"

if [[ "$ALLOW_DIRTY" == false ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    fatal "Working tree has uncommitted changes. Commit or stash them, or re-run with --allow-dirty."
  fi
fi

if [[ "$SKIP_INSTALL" == false ]]; then
  log "Installing dependencies via pnpm (frozen lockfile)"
  pnpm install --frozen-lockfile
else
  log "Skipping dependency installation as requested"
fi

export NODE_ENV=production
# Note: build does not read or copy env files; rely on current environment

RELEASES_DIR="$REPO_ROOT/releases"
RELEASE_NAME="cursor-usage-web-${VERSION}"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"
RELEASE_ZIP="${RELEASE_DIR}.zip"

log "Cleaning previous artifacts (if any)"
rm -rf "$RELEASE_DIR" "$RELEASE_ZIP"
mkdir -p "$RELEASE_DIR"

###############################################################################
# Build internal packages and generated sources
###############################################################################

log "Generating Prisma client"
pnpm --filter @cursor-usage/db run db:generate

log "Building internal libraries"
pnpm --filter "@cursor-usage/*" \
     --filter "!@cursor-usage/web" \
     --filter "!@cursor-usage/worker" \
     run --if-present build

###############################################################################
# Build the Next.js web application in standalone mode
###############################################################################

log "Building Next.js (standalone mode)"
pnpm --filter @cursor-usage/web run build

STANDALONE_DIR="apps/web/.next/standalone"
STATIC_DIR="apps/web/.next/static"
PUBLIC_DIR="apps/web/public"
PRISMA_DIR="packages/db/prisma"

[[ -d "$STANDALONE_DIR" ]] || fatal "Expected $STANDALONE_DIR to exist after the build."
[[ -d "$STATIC_DIR" ]] || fatal "Expected $STATIC_DIR to exist after the build."

###############################################################################
# Assemble the release folder
###############################################################################

log "Assembling release directory at $RELEASE_DIR"

# Define app release root and ensure it's clean
APP_RELEASE_DIR="$RELEASE_DIR/apps/web"
rm -rf "$APP_RELEASE_DIR"
mkdir -p "$APP_RELEASE_DIR"

# 1) Materialize the web package with a symlink-free node_modules using pnpm deploy
log "Materializing @cursor-usage/web with pnpm deploy (prod deps only)"
pnpm --filter @cursor-usage/web deploy --prod "$APP_RELEASE_DIR"

# 2) Copy the server entry produced by Next standalone build
if [[ ! -f "$STANDALONE_DIR/apps/web/server.js" ]]; then
  fatal "Expected Next server entry at $STANDALONE_DIR/apps/web/server.js"
fi
cp -a "$STANDALONE_DIR/apps/web/server.js" "$APP_RELEASE_DIR/server.js"

# 3) Copy non-code runtime assets expected at runtime
mkdir -p "$APP_RELEASE_DIR/.next"
rm -rf "$APP_RELEASE_DIR/.next/static"
cp -a "$STATIC_DIR" "$APP_RELEASE_DIR/.next/"

if [[ -d "$PUBLIC_DIR" ]]; then
  mkdir -p "$APP_RELEASE_DIR/public"
  cp -a "$PUBLIC_DIR"/. "$APP_RELEASE_DIR/public/"
fi

# Optional: include Prisma schema/migrations for operational tooling
if [[ -d "$PRISMA_DIR" ]]; then
  mkdir -p "$APP_RELEASE_DIR/prisma"
  cp -a "$PRISMA_DIR"/. "$APP_RELEASE_DIR/prisma/"
fi

# 4) Validate that deployed node_modules appear complete (should be a no-op now)
log "Validating runtime node_modules dependencies"
NODE_MODULES_ROOT="$APP_RELEASE_DIR/node_modules"
if [[ ! -d "$NODE_MODULES_ROOT" ]]; then
  fatal "Expected node_modules directory at $NODE_MODULES_ROOT after pnpm deploy."
fi
if mapfile -t _missing < <(detect_missing_node_modules "$NODE_MODULES_ROOT"); then
  if [[ ${#_missing[@]} -gt 0 ]]; then
    printf '\n' >&2
    printf '[make_release] ERROR: Missing modules after pnpm deploy:\n' >&2
    for m in "${_missing[@]}"; do printf '  - %s\n' "$m" >&2; done
    fatal "Dependency validation failed"
  fi
fi

# 6) Smoke tests to catch common runtime issues without starting the server
log "Running smoke tests (module resolution)"
(
  cd "$APP_RELEASE_DIR"
  # Ensure the server entry can be resolved (path exists), but do not execute it
  node -e "require.resolve('./server.js'); console.log('server entry resolvable')" \
    || fatal "Smoke test failed: server.js not resolvable"
  # Ensure Next is present and resolvable from the deployed app
  node -e "console.log(require.resolve('next/package.json'))" \
    || fatal "Smoke test failed: next package not resolvable"
  # Ensure the start-server module is loadable (import tree intact)
  node -e "require('next/dist/server/lib/start-server'); console.log('next start-server import OK')" \
    || fatal "Smoke test failed: next start-server module not importable"
)

# 5) Provide root package.json so "pnpm web:pdn:lan" works in the release
cp -a "$REPO_ROOT/package.json" "$RELEASE_DIR/package.json"

# 7) Sanitize: ensure no environment files are included in the artifact
log "Sanitizing release: removing any .env* files"
find "$RELEASE_DIR" -type f -name ".env*" -print -delete || true

# Provide a quick-start readme in the release artifact.
cat <<'EOF' > "$RELEASE_DIR/README-release.md"
# Cursor Usage Tracker - Release Bundle

This directory contains a production-ready bundle of the web app.

Start the server:

- With env file (Node 20.6+):
  pnpm web:pdn:lan

- Or without env file:
  HOSTNAME=0.0.0.0 PORT=4000 NODE_ENV=production node apps/web/server.js

Notes:
- Requires Node.js 20+ and pnpm installed on the host.
- Place `.env.production.local` at the bundle root if using the pnpm script.
- `apps/web` contains the fully materialized app with a symlink-free `node_modules`.
- Do not commit or ship any `.env.*` files to public repos.
EOF

###############################################################################
# Create the zip archive
###############################################################################

if [[ "$SKIP_ZIP" == false ]]; then
  log "Creating zip archive $RELEASE_ZIP"
  (
    cd "$RELEASES_DIR"
    zip -rq "$(basename "$RELEASE_ZIP")" "$(basename "$RELEASE_DIR")"
  )
else
  log "Skipping archive creation as requested"
fi

###############################################################################
# Optional Git tagging
###############################################################################

if [[ "$CREATE_TAG" == true ]]; then
  if git rev-parse "$VERSION" >/dev/null 2>&1; then
    fatal "Git tag \"$VERSION\" already exists."
  fi

  log "Creating Git tag $VERSION"
  git tag "$VERSION"

  if [[ "$PUSH_TAG" == true ]]; then
    log "Pushing tag $VERSION to origin"
    git push origin "$VERSION"
  fi
fi

###############################################################################
# Summary
###############################################################################

log "Release directory: $RELEASE_DIR"
if [[ "$SKIP_ZIP" == false ]]; then
  log "Release archive:   $RELEASE_ZIP"
fi
log "To start: cd $RELEASE_DIR && pnpm web:pdn:lan"

log "Done."
