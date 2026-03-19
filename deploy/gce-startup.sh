#!/bin/bash
# Conduit Live Server — GCE Startup Script
# Installs Node.js, Chromium deps, Tailscale, clones repo, starts server
set -uo pipefail

LOG="/var/log/conduit-startup.log"
exec > >(tee -a "$LOG") 2>&1
echo "=== Conduit startup script began at $(date) ==="

# ── 0. Fix DNS (Tailscale can break resolv.conf on reboot) ──
echo "[0] Ensuring DNS works..."
if ! getent hosts google.com &>/dev/null; then
  echo "DNS broken, adding Google DNS fallback..."
  cp /etc/resolv.conf /etc/resolv.conf.bak 2>/dev/null || true
  {
    echo "nameserver 8.8.8.8"
    echo "nameserver 8.8.4.4"
    grep -v '^nameserver' /etc/resolv.conf 2>/dev/null || true
  } > /etc/resolv.conf.tmp && mv /etc/resolv.conf.tmp /etc/resolv.conf
  echo "DNS fix applied. Testing..."
  getent hosts google.com && echo "DNS working!" || echo "WARN: DNS still not working"
fi

# ── 1. System deps for Puppeteer/Chromium ──
echo "[1/9] Installing system dependencies..."
apt-get update -qq || true
apt-get install -y -qq \
  ca-certificates curl gnupg git \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
  libasound2 libxshmfence1 libx11-xcb1 libxss1 \
  fonts-liberation libappindicator3-1 xdg-utils wget || echo "WARN: some apt packages failed (may already be installed)"

# ── 2. Node.js 20 LTS ──
echo "[2/9] Installing Node.js 20..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo "Node $(node -v), npm $(npm -v)"

# ── 3. Tailscale ──
echo "[3/9] Installing Tailscale..."
if ! command -v tailscale &>/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

TAILSCALE_AUTH_KEY=$(curl -s -H "Metadata-Flavor: Google" \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/tailscale-auth-key" 2>/dev/null || echo "")

if [ -n "$TAILSCALE_AUTH_KEY" ]; then
  echo "Authenticating Tailscale..."
  tailscale up --authkey="$TAILSCALE_AUTH_KEY" --hostname=conduit-live --accept-routes || echo "WARN: tailscale up failed (may already be authenticated)"
  echo "Tailscale IP: $(tailscale ip -4 2>/dev/null || echo 'unknown')"
else
  echo "No Tailscale auth key in metadata. Checking existing auth..."
  if tailscale status &>/dev/null; then
    echo "Tailscale already authenticated. IP: $(tailscale ip -4 2>/dev/null || echo 'unknown')"
  else
    echo "WARNING: Tailscale not authenticated and no auth key provided."
  fi
fi

# ── 4. Create conduit user ──
echo "[4/9] Creating conduit user..."
if ! id conduit &>/dev/null; then
  useradd -r -m -s /bin/bash conduit
fi

# ── 5. Clone/update repo ──
echo "[5/9] Cloning/updating conduit repo..."
if [ ! -d /opt/conduit ]; then
  git clone https://github.com/eastseymour/conduit.git /opt/conduit
  chown -R conduit:conduit /opt/conduit
else
  cd /opt/conduit
  # Safe directory config for both root and conduit user
  git config --global --add safe.directory /opt/conduit 2>/dev/null || true
  sudo -u conduit git config --global --add safe.directory /opt/conduit 2>/dev/null || true
  sudo -u conduit git fetch origin main 2>&1 || git fetch origin main 2>&1
  sudo -u conduit git reset --hard origin/main 2>&1 || git reset --hard origin/main 2>&1
  chown -R conduit:conduit /opt/conduit
fi

# ── 6. Build SDK ──
echo "[6/9] Building SDK..."
cd /opt/conduit
sudo -u conduit npm install 2>&1 | tail -10
sudo -u conduit npm run build 2>&1 | tail -10
echo "SDK built."

# ── 7. Build demo app ──
echo "[7/9] Building demo app..."
cd /opt/conduit/example
sudo -u conduit npm install 2>&1 | tail -10
sudo -u conduit npm run build 2>&1 | tail -10
echo "Demo built."

# ── 8. Install server deps + verify Chrome ──
echo "[8/9] Installing server dependencies (including Puppeteer + Chrome)..."
cd /opt/conduit/server
# Full install (not --production) so puppeteer downloads Chrome
sudo -u conduit npm install 2>&1 | tail -10
echo "Server deps installed."

# Verify Chrome is available
echo "Verifying Puppeteer Chrome..."
CHROME_CHECK=$(sudo -u conduit npx -y puppeteer browsers install chrome 2>&1 | tail -3)
echo "$CHROME_CHECK"

# ── 9. Create and start systemd service ──
echo "[9/9] Setting up systemd service..."
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
Environment=HOME=/home/conduit

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable conduit-server
systemctl restart conduit-server

# Wait a moment and verify it started
sleep 3
if systemctl is-active --quiet conduit-server; then
  echo "✅ conduit-server is running!"
else
  echo "❌ conduit-server failed to start. Logs:"
  journalctl -u conduit-server --no-pager -n 30
fi

echo ""
echo "=== Conduit startup script completed at $(date) ==="
echo "Server should be running on port 3001"
if command -v tailscale &>/dev/null && tailscale status &>/dev/null; then
  TS_IP=$(tailscale ip -4 2>/dev/null || echo "unknown")
  echo "Tailscale IP: $TS_IP"
  echo ""
  echo "Access the demo:  http://conduit-live:3001/conduit/"
  echo "Health check:     http://$TS_IP:3001/api/health"
  echo "Or via MagicDNS:  http://conduit-live:3001/api/health"
fi
