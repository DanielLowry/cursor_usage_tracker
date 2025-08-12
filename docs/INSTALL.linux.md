# Linux install guide (Ubuntu/Debian)

This guide installs Node 20.x (via nvm or NodeSource), pnpm 9 via Corepack, and Docker Engine.

## Option A — nvm (recommended)
```bash
# Install nvm
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
# reload shell for this session
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"

# Install Node 20
nvm install 20
nvm alias default 20
node -v

# pnpm via Corepack
corepack enable
corepack prepare pnpm@9 --activate
pnpm -v

# Docker Engine (convenience script)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
newgrp docker

docker --version
```

## Option B — NodeSource (APT)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v

corepack enable
corepack prepare pnpm@9 --activate
pnpm -v

# Docker Engine (convenience script)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
newgrp docker

docker --version
```

Verification:
- `node -v` → v20.x.x
- `pnpm -v` → 9.x.x
- `docker --version` → Docker version X.Y.Z, build …

Notes:
- You may need to log out/in after adding your user to the `docker` group.
- The repo includes `.nvmrc` set to `20`.

## Repo setup and build
```bash
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