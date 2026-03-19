#!/bin/bash
# Conduit Live Server — GCE Startup Script
# Installs Node.js, Chromium deps, Tailscale, clones repo, starts server
set -euo pipefail

LOG="/var/log/conduit-startup.log"
exec > >(tee -a "$LOG") 2>&1
echo "=== Conduit startup script began at $(date) ==="

# ── 1. System deps for Puppeteer/Chromium ──
echo "[1/7] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
  ca-certificates curl gnupg git \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
  libasound2 libxshmfence1 libx11-xcb1 libxss1 \
  fonts-liberation libappindicator3-1 xdg-utils wget

# ── 2. Node.js 20 LTS ──
echo "[2/7] Installing Node.js 20..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo "Node $(node -v), npm $(npm -v)"

# ── 3. Tailscale ──
echo "[3/7] Installing Tailscale..."
if ! command -v tailscale &>/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

TAILSCALE_AUTH_KEY=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/tailscale-auth-key" 2>/dev/null || echo "")

if [ -n "$TAILSCALE_AUTH_KEY" ]; then
  echo "Authenticating Tailscale..."
  tailscale up --authkey="$TAILSCALE_AUTH_KEY" --hostname=conduit-live --accept-routes
  echo "Tailscale IP: $(tailscale ip -4)"
else
  echo "WARNING: No Tailscale auth key found in metadata. Skipping Tailscale auth."
fi

# ── 4. Create conduit user ──
echo "[4/7] Creating conduit user..."
if ! id conduit &>/dev/null; then
  useradd -r -m -s /bin/bash conduit
fi

# ── 5. Clone repo ──
echo "[5/7] Cloning conduit repo..."
if [ ! -d /opt/conduit ]; then
  git clone https://github.com/eastseymour/conduit.git /opt/conduit
else
  cd /opt/conduit && git pull origin main || true
fi
chown -R conduit:conduit /opt/conduit

# ── 6. Install server deps ──
echo "[6/7] Installing server dependencies..."
cd /opt/conduit/server
sudo -u conduit npm install --production 2>&1 | tail -5
echo "Server deps installed."

# ── 7. Create and start systemd service ──
echo "[7/7] Setting up systemd service..."
cat > /etc/systemd/system/conduit-server.service << 'SVCEOF'
[Unit]
Description=Conduit Live Testing Server (Puppeteer)
After=network.target

[Service]
Type=simple
User=conduit
Group=conduit
WorkingDirectory=/opt/conduit/server
ExecStart=/usr/bin/npx tsx server.ts
Restart=on-failure
RestartSec=5
Environment=PORT=3001
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=2048
# Give Chrome enough /dev/shm
Environment=PUPPETEER_CACHE_DIR=/opt/conduit/.cache/puppeteer

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable conduit-server
systemctl start conduit-server

echo ""
echo "=== Conduit startup script completed at $(date) ==="
echo "Server should be running on port 3001"
if command -v tailscale &>/dev/null && tailscale status &>/dev/null; then
  echo "Tailscale IP: $(tailscale ip -4)"
  echo "Access: http://$(tailscale ip -4):3001/api/health"
fi
