#!/usr/bin/env bash
# Undo the Series Lab staging deploy on the server (run as root). Nothing else on the host is
# touched except the proxy block for next.w3ir.io, which is removed. Data is kept unless PURGE=1.
set -euo pipefail
BASE=/opt/series-lab
CADDY_HOME="${CADDY_HOME:-/opt/w3ir}"
CADDYFILE="$CADDY_HOME/deploy/Caddyfile"
CADDY_CONTAINER="${CADDY_CONTAINER:-nft-builder-caddy}"

if [ -f "$BASE/Caddyfile.before-phase3" ]; then
  cp -a "$BASE/Caddyfile.before-phase3" "$CADDYFILE"
  docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy-src/Caddyfile --adapter caddyfile && echo "caddy restored"
fi
[ -f "$BASE/docker-compose.yml" ] && docker compose -f "$BASE/docker-compose.yml" down && echo "serieslab stopped"
if [ "${PURGE:-0}" = 1 ]; then rm -rf "$BASE" && echo "removed $BASE"; fi
