#!/usr/bin/env bash
# One-time server setup for SPARK on a fresh Ubuntu 22.04 / 24.04 machine (x86_64 or ARM).
# Installs Node 22, Caddy (HTTPS), a "spark" user and a systemd service. Run as root after uploading the code to /opt/spark (see deploy/upload.sh):
#
#   sudo bash /opt/spark/deploy/setup-ubuntu.sh spark.example.com
#
# Safe to run again: it updates what is already there.
set -euo pipefail

DOMAIN="${1:-}"
APP_DIR=/opt/spark
APP_USER=spark

if [[ $EUID -ne 0 ]]; then echo "Run as root: sudo bash $0 <domain>"; exit 1; fi
if [[ -z "$DOMAIN" ]]; then echo "Usage: sudo bash $0 <domain>   (e.g. spark.example.com)"; exit 1; fi
if [[ ! -f "$APP_DIR/server.js" ]]; then echo "Upload the code to $APP_DIR first (deploy/upload.sh)."; exit 1; fi

echo "==> System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https sqlite3 rsync

echo "==> Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Caddy (automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> App user and files"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$APP_USER" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR/data"
if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/deploy/env.example" "$APP_DIR/.env"
fi
# Point the app at the domain (keeps everything else in .env as it is).
sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$DOMAIN|" "$APP_DIR/.env"
grep -q '^PORT=' "$APP_DIR/.env" && sed -i 's|^PORT=.*|PORT=3000|' "$APP_DIR/.env" || echo 'PORT=3000' >> "$APP_DIR/.env"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env" "$APP_DIR/oauth-client.json" "$APP_DIR/data/token.json" "$APP_DIR/token.json" "$APP_DIR/service-account.json" 2>/dev/null || true

echo "==> npm packages"
sudo -u "$APP_USER" -H bash -c "cd $APP_DIR && npm ci --omit=dev --no-audit --no-fund"

echo "==> Service"
install -m 644 "$APP_DIR/deploy/spark.service" /etc/systemd/system/spark.service
systemctl daemon-reload
systemctl enable spark
systemctl restart spark

echo "==> HTTPS for $DOMAIN"
sed "s|__DOMAIN__|$DOMAIN|g" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "==> Firewall (if ufw is on)"
if command -v ufw >/dev/null && ufw status | grep -q active; then
  ufw allow OpenSSH; ufw allow 80/tcp; ufw allow 443/tcp
fi

sleep 3
echo
systemctl --no-pager --lines=5 status spark || true
echo
echo "Done. Next:"
echo "  1. Google Cloud Console -> Credentials -> the OAuth client -> add redirect URI: https://$DOMAIN/oauth2callback"
echo "  2. Open https://$DOMAIN/admin, sign in with Google, and scan the WhatsApp QR under Settings."
echo "  Logs: journalctl -u spark -f"
