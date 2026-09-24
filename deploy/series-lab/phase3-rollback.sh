#!/usr/bin/env bash
# Undo Ф3 on the server (run as root). Промт is not touched except the Caddy
# block for next.w3ir.io, which is removed. Data copy is kept unless PURGE=1.
set -euo pipefail
BASE=/opt/series-lab
CADDYFILE=/opt/w3ir/deploy/Caddyfile

if [ -f "$BASE/Caddyfile.before-phase3" ]; then
  cp -a "$BASE/Caddyfile.before-phase3" "$CADDYFILE"
  docker exec nft-builder-caddy caddy reload --config /etc/caddy-src/Caddyfile --adapter caddyfile && echo "caddy restored"
fi
[ -f "$BASE/docker-compose.yml" ] && docker compose -f "$BASE/docker-compose.yml" down && echo "serieslab stopped"
if [ "${PURGE:-0}" = 1 ]; then rm -rf "$BASE" && echo "removed $BASE"; fi
