#!/usr/bin/env bash
#
# make_release.sh - Build a standalone production bundle for the Cursor Usage Tracker web app.
# The script orchestrates package builds, the Next.js standalone build, assembles runtime assets,
# and produces a versioned zip file that can be deployed directly.

set -euo pipefail

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

ensure_command() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fatal "Required command \"$cmd\" is not available in PATH."
}

load_env_file() {
  local env_file="$1"
  if [[ ! -f "$env_file" ]]; then
    fatal "Expected environment file \"$env_file\" to exist."
  fi

  # shellcheck source=/dev/null
  set -a
  source "$env_file"
  set +a
}

resolve_workspace_module_dir() {
  local module_name="$1"
  local resolved_path=""

  if ! resolved_path="$(pnpm --filter @cursor-usage/web exec node "$NODE_MODULES_HELPER" resolve "$module_name")"; then
    local exit_status=$?
    if (( exit_status == 3 )); then
      fatal "Unable to resolve workspace module \"$module_name\". Ensure it is installed."
    fi
    fatal "Failed to resolve workspace module \"$module_name\" (exit status $exit_status)."
  fi

  # Trim trailing newline characters if any.
  resolved_path="${resolved_path//$'\r'/}"
  resolved_path="${resolved_path//$'\n'/}"

  if [[ -z "$resolved_path" || ! -d "$resolved_path" ]]; then
    fatal "Resolved path for module \"$module_name\" is empty or not a directory."
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

ENV_FILE=".env.production.local"
log "Loading production environment from $ENV_FILE"
load_env_file "$ENV_FILE"

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

# Copy the standalone Node runtime that Next.js produced.
# Use -L to dereference pnpm symlinks so runtime deps are real files in the release.
cp -aL "$STANDALONE_DIR"/. "$RELEASE_DIR/"

APP_RELEASE_DIR="$RELEASE_DIR/apps/web"

if [[ ! -d "$APP_RELEASE_DIR" ]]; then
  fatal "Standalone copy did not produce $APP_RELEASE_DIR"
fi

# Include Next.js static assets in the location expected by the standalone server.
mkdir -p "$APP_RELEASE_DIR/.next"
rm -rf "$APP_RELEASE_DIR/.next/static"
cp -a "$STATIC_DIR" "$APP_RELEASE_DIR/.next/"

if [[ -d "$PUBLIC_DIR" ]]; then
  mkdir -p "$APP_RELEASE_DIR/public"
  cp -a "$PUBLIC_DIR"/. "$APP_RELEASE_DIR/public/"
fi

# Sanity checks to ensure the standalone runtime has required modules
if [[ ! -f "$RELEASE_DIR/apps/web/server.js" ]]; then
  fatal "Standalone server entry not found at $RELEASE_DIR/apps/web/server.js"
fi

if [[ ! -d "$RELEASE_DIR/apps/web/node_modules/next" ]]; then
  fatal "Next runtime not found at $RELEASE_DIR/apps/web/node_modules/next. The standalone bundle may be missing node_modules."
fi

# Work around a Next.js standalone tracing gap where key server runtime files
# are sometimes omitted from the copied node_modules tree. If the primary
# start-server entry is absent, backfill the package contents from the
# workspace installation to keep the release self-contained.
NEXT_SERVER_ENTRY="$RELEASE_DIR/apps/web/node_modules/next/dist/server/lib/start-server.js"
if [[ ! -f "$NEXT_SERVER_ENTRY" ]]; then
  log "Next.js runtime is missing start-server.js; backfilling package contents"
  NEXT_PACKAGE_DIR="$(pnpm --filter @cursor-usage/web exec node -e 'console.log(require("path").dirname(require.resolve("next/package.json")))')"
  if [[ -z "$NEXT_PACKAGE_DIR" || ! -d "$NEXT_PACKAGE_DIR" ]]; then
    fatal "Unable to resolve the Next.js package directory from the workspace."
  fi
  NEXT_PACKAGE_PARENT="$(dirname "$NEXT_PACKAGE_DIR")"
  if [[ -z "$NEXT_PACKAGE_PARENT" || ! -d "$NEXT_PACKAGE_PARENT" ]]; then
    fatal "Unable to determine Next.js parent node_modules directory."
  fi

  # Refresh the Next.js package contents.
  rm -rf "$RELEASE_DIR/apps/web/node_modules/next"
  mkdir -p "$RELEASE_DIR/apps/web/node_modules/next"
  cp -aL "$NEXT_PACKAGE_DIR/." "$RELEASE_DIR/apps/web/node_modules/next/"

  # Backfill the package's sibling dependencies (e.g. @swc, @next, postcss).
  for dependency_path in "$NEXT_PACKAGE_PARENT"/*; do
    dependency_name="$(basename "$dependency_path")"
    [[ "$dependency_name" == "next" ]] && continue
    if [[ -e "$dependency_path" ]]; then
      rm -rf "$RELEASE_DIR/apps/web/node_modules/$dependency_name"
      cp -aL "$dependency_path" "$RELEASE_DIR/apps/web/node_modules/$dependency_name"
    fi
  done
fi

if [[ ! -f "$NEXT_SERVER_ENTRY" ]]; then
  fatal "Expected $NEXT_SERVER_ENTRY to exist after backfilling Next.js runtime files."
fi

SWC_HELPER_CJS="$APP_RELEASE_DIR/node_modules/@swc/helpers/lib/_interop_require_default.js"
SWC_HELPER_ESM="$APP_RELEASE_DIR/node_modules/@swc/helpers/esm/_interop_require_default.js"
if [[ ! -f "$SWC_HELPER_CJS" && ! -f "$SWC_HELPER_ESM" ]]; then
  fatal "Expected SWC helper runtime at either $SWC_HELPER_CJS or $SWC_HELPER_ESM but neither was found. Standalone build may be incomplete."
fi

# Identify and backfill any dependencies that Next's standalone tracing missed so
# the runtime bundle stays self-contained.
log "Validating runtime node_modules dependencies"
NODE_MODULES_ROOT="$APP_RELEASE_DIR/node_modules"
if [[ ! -d "$NODE_MODULES_ROOT" ]]; then
  fatal "Expected node_modules directory at $NODE_MODULES_ROOT after copying standalone output."
fi

missing_modules=()
dependency_iteration=0
dependency_iteration_limit=5

while true; do
  missing_modules=()
  if mapfile -t missing_modules < <(detect_missing_node_modules "$NODE_MODULES_ROOT"); then
    :
  else
    fatal "Failed to inspect node_modules dependencies under $NODE_MODULES_ROOT."
  fi

  if [[ ${#missing_modules[@]} -eq 0 ]]; then
    break
  fi

  ((dependency_iteration++))
  if ((dependency_iteration > dependency_iteration_limit)); then
    fatal "Unable to resolve missing modules after ${dependency_iteration_limit} attempts: ${missing_modules[*]}"
  fi

  log "Backfilling missing modules (${dependency_iteration}/${dependency_iteration_limit}): ${missing_modules[*]}"

  for module_name in "${missing_modules[@]}"; do
    copy_workspace_module "$module_name" "$NODE_MODULES_ROOT"
  done
done

log "node_modules dependency validation passed"

# Ship Prisma schema and migrations to keep database tooling handy in production.
if [[ -d "$PRISMA_DIR" ]]; then
  mkdir -p "$RELEASE_DIR/packages/db"
  cp -a "$PRISMA_DIR" "$RELEASE_DIR/packages/db/"
fi

# Provide a quick-start readme in the release artifact.
cat <<'EOF' > "$RELEASE_DIR/README-release.md"
# Cursor Usage Tracker - Standalone Release

This directory contains the standalone Next.js bundle produced by `next build` with `output: 'standalone'`.

To run the server:

```bash
# 1) Ensure you have Node.js 20+ installed on the target host
# 2) Create a .env.production.local file alongside this README with production secrets
# 3) Start the server (override PORT as needed)
PORT=4000 node apps/web/server.js
```

Notes:
- The `node_modules` required by the standalone build are already included under this folder.
- If you repackage this folder, prefer a zip created by the release script to preserve structure.
- You can adjust `PORT` and any other environment variables before starting the server.
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
log "To start the server: PORT=4000 node apps/web/server.js"

log "Done."
