#!/usr/bin/env bash
# Deploy index.html to planet.madmentat.ru (CT 105 on Proxmox)
# Usage: bash deploy.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="${DIR}/index.html"

echo "[madPlanet] 1/3 Build index.html..."
bash "${DIR}/build.sh" "$SRC"

HASH=$(sha256sum "$SRC" | cut -d' ' -f1)
SIZE=$(wc -c < "$SRC")
echo "[madPlanet] 2/3 Deploy $SIZE bytes, SHA256=$HASH ..."

TARGET="/webserver/madPlanet/index.html"
pct exec 105 -- bash -c "cat > '$TARGET' && chown www-data:www-data '$TARGET'" < "$SRC"

REMOTE_HASH=$(pct exec 105 -- sha256sum "$TARGET" | cut -d' ' -f1)
if [ "$REMOTE_HASH" != "$HASH" ]; then
  echo "DEPLOY HASH MISMATCH: local=$HASH remote=$REMOTE_HASH"
  exit 1
fi

echo "[madPlanet] 3/3 Verify..."
CODE=$(curl -sk --resolve planet.madmentat.ru:443:127.0.0.1 -o /dev/null -w '%{http_code} %{size_download}' https://planet.madmentat.ru/ 2>/dev/null)
echo "[madPlanet] DONE: https://planet.madmentat.ru  ($CODE)"
echo "[madPlanet] Hash verified: $REMOTE_HASH"
