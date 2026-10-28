#!/usr/bin/env bash
# Copy SPARK from this Mac to the server. Run from the project folder:
#
#   bash deploy/upload.sh root@1.2.3.4            # code only (updates)
#   bash deploy/upload.sh root@1.2.3.4 --with-data   # first time: also the database and WhatsApp session
#
# Secrets (.env, oauth-client.json, token.json) are copied too, over SSH only.
set -euo pipefail

TARGET="${1:-}"
WITH_DATA="${2:-}"
if [[ -z "$TARGET" ]]; then echo "Usage: bash deploy/upload.sh user@server [--with-data]"; exit 1; fi
cd "$(dirname "$0")/.."

EXCLUDES=(--exclude node_modules --exclude .DS_Store --exclude '*.log' --exclude /data/uploads)
if [[ "$WITH_DATA" != "--with-data" ]]; then
  EXCLUDES+=(--exclude /data)
  # .env has the server's address and token.json the server's own Google sign-in; keep both on updates.
  EXCLUDES+=(--exclude /.env --exclude /token.json)
fi

ssh "$TARGET" "mkdir -p /opt/spark"
rsync -az --delete "${EXCLUDES[@]}" --exclude /data/backups ./ "$TARGET:/opt/spark/"
echo "Uploaded to $TARGET:/opt/spark"
if [[ "$WITH_DATA" == "--with-data" ]]; then
  echo "First time? On the server run:  sudo bash /opt/spark/deploy/setup-ubuntu.sh <your-domain>"
else
  echo "Restarting:"
  ssh "$TARGET" "cd /opt/spark && chown -R spark:spark /opt/spark && sudo -u spark -H bash -c 'PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev --no-audit --no-fund' && systemctl restart spark && systemctl --no-pager --lines=3 status spark"
fi
