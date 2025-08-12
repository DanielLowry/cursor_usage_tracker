# Windows install guide

This guide installs Node 20.x, pnpm 9 via Corepack, and Docker Desktop on Windows 10/11.

## Option A — winget (simple)
```powershell
# Node (LTS via winget). If it installs >20, use Option B to switch to 20.x.
winget install OpenJS.NodeJS.LTS --silent
# Enable pnpm via Corepack
node -v
corepack enable
corepack prepare pnpm@9 --activate
pnpm -v

# Docker Desktop
winget install Docker.DockerDesktop --silent

# Verify
docker --version
git rev-parse --is-inside-work-tree
```

## Option B — nvm-windows (version control)
```powershell
# Install nvm-windows
winget install CoreyButler.NVMforWindows --silent

# Close and reopen your terminal, then:
nvm version

# Install a specific Node 20.x (adjust to the exact version you prefer)
nvm install 20.11.1
nvm use 20.11.1
node -v

# pnpm via Corepack
corepack enable
corepack prepare pnpm@9 --activate
pnpm -v

# Docker Desktop
winget install Docker.DockerDesktop --silent

# Verify
docker --version
```

Notes:
- Docker Desktop requires WSL2 and virtualization. If prompted, enable WSL and the Virtual Machine Platform features and reboot.
- If `pnpm` is not found, ensure `node -v` returns 20.x and re-run the Corepack commands.
- The repo includes `.nvmrc` set to `20`.

## Repo setup and build (PowerShell)
```powershell
# Clone
git clone https://github.com/your-org/cursor_usage_tracker.git
cd cursor_usage_tracker

# Ensure pnpm via Corepack
node -v
corepack enable
corepack prepare pnpm@9 --activate

# Install & build workspace
pnpm install
pnpm build

# Run the web app (dev)
pnpm --filter @cursor-usage/web dev

# Run the worker (dev)
pnpm --filter @cursor-usage/worker dev
```