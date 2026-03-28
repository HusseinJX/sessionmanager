#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu droplet (22.04 / 24.04)
# Run as root: bash setup.sh <domain> [token]
set -euo pipefail

DOMAIN="${1:?Usage: setup.sh <domain> [token]}"
TOKEN="${2:-$(openssl rand -hex 24)}"

echo "=== SessionManager Droplet Setup ==="
echo "Domain: $DOMAIN"
echo "Token:  $TOKEN"
echo ""

# 1. Install Docker
if ! command -v docker &>/dev/null; then
  echo ">>> Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi

# 2. Install Docker Compose plugin (if not already bundled)
if ! docker compose version &>/dev/null; then
  echo ">>> Installing Docker Compose plugin..."
  apt-get update && apt-get install -y docker-compose-plugin
fi

# 3. Firewall
echo ">>> Configuring firewall..."
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# 4. Clone / pull repo
APP_DIR="/opt/sessionmanager"
if [ -d "$APP_DIR/.git" ]; then
  echo ">>> Pulling latest..."
  cd "$APP_DIR" && git pull
else
  echo ">>> Cloning repo..."
  # Replace with your repo URL
  echo "WARNING: No git remote configured. Copy files to $APP_DIR manually or set up git."
  mkdir -p "$APP_DIR"
fi

cd "$APP_DIR"

# 5. Write .env
cat > .env <<EOF
SM_TOKEN=$TOKEN
DOMAIN=$DOMAIN
EOF

echo ">>> .env written"

# 6. Build and start
echo ">>> Building and starting..."
docker compose up -d --build

echo ""
echo "=== Done ==="
echo "Web UI:  https://$DOMAIN"
echo "Token:   $TOKEN"
echo ""
echo "Caddy will auto-provision a Let's Encrypt certificate."
echo "Make sure DNS for $DOMAIN points to this droplet's IP first."
