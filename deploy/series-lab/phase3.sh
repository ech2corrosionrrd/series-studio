#!/usr/bin/env bash
# Series Lab on https://lab.w3ir.io (SERVICE_HOST) — a STANDALONE deployment.
# Run ON THE SERVER as root:   bash /tmp/series-lab-phase3.sh /tmp/series-lab-src.tar
#
# Everything Lab needs lives under /opt/series-lab: its own source, image, data,
# secrets (lab.env) and backups. It never reads another project's data or .env.
# The only shared infrastructure it touches (unavoidable on one host) is the docker
# network and Caddy blocks that route SERVICE_HOST (and redirect the old LEGACY_HOST); SKIP_CADDY=1 only prints them.
#
#   1. unpacks the source into /opt/series-lab/src;
#   2. builds the image series-lab:<rev>;
#   3. creates Lab's OWN empty data dir (data-next) — the ledger starts from zero;
#   4. builds .env.series-lab from Lab's own secrets file lab.env + overrides. Default is a
#      locked staging: no payments, no Telegram, invite-only, no spend cap, SIWE domain SERVICE_HOST (lab.w3ir.io).
#      Public mode is opt-in per knob (all forwarded by upload.sh):
#        OPEN_ACCESS=1      any wallet may sign in (no SERIES_ALLOWED_WALLETS list)
#        ENABLE_PAYMENTS=1  keep SOLANA_PAY_RECIPIENT (public address) / RPC from lab.env
#        ENABLE_TELEGRAM=1  keep SERIES_TELEGRAM_* from lab.env
#   5. starts the container;
#   6. adds a SERVICE_HOST block to the reverse proxy (the old LEGACY_HOST becomes a 302 to it), validates, reloads (restores on failure);
#   7. installs Lab's own ledger backup (cron);
#   8. smoke test.
#
# Secrets: put them in /opt/series-lab/lab.env (chmod 600) — or run upload.sh with
# LAB_ENV_FILE=/path/to/.env to send your local file over ssh once. If lab.env is missing
# the script writes a template from .env.example and stops.
# Idempotent: re-running updates the image and config; data is never touched.
# Rollback: deploy/series-lab/phase3-rollback.sh · clean slate: reset-staging.sh
set -euo pipefail

SRC_TAR="${1:?usage: phase3.sh <source.tar>}"
BASE=/opt/series-lab
LAB_USER="${LAB_USER:-w3ir}"
CADDY_HOME="${CADDY_HOME:-/opt/w3ir}"                    # where the shared Caddyfile lives
CADDYFILE="$CADDY_HOME/deploy/Caddyfile"
CADDY_CONTAINER="${CADDY_CONTAINER:-nft-builder-caddy}"
NETWORK="${NETWORK:-w3ir_default}"
SERVICE_HOST="${SERVICE_HOST:-lab.w3ir.io}"            # the name people use
LEGACY_HOST="${LEGACY_HOST-next.w3ir.io}"               # old staging name: redirected to SERVICE_HOST ("" = none)
LAB_ENV="$BASE/lab.env"
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }

echo "==> 1. source"
mkdir -p "$BASE/src" "$BASE/data-next"
rm -rf "$BASE/src"/*
tar -xf "$SRC_TAR" -C "$BASE/src"
REV=$(cat "$BASE/src/REVISION" 2>/dev/null || date +%Y%m%d%H%M)
echo "revision $REV"

echo "==> 2. image series-lab:$REV"
docker build -q -t "series-lab:$REV" "$BASE/src"

echo "==> 3. data (Lab's own)"
if [ -s "$BASE/data-next/users.db" ]; then
  echo "data-next has a ledger — kept as is"
else
  echo "data-next is empty — Lab creates its own ledger on first start"
fi

echo "==> 4. environment"
if [ -n "${LAB_ENV_SRC:-}" ] && [ -f "$LAB_ENV_SRC" ]; then
  install -m 600 "$LAB_ENV_SRC" "$LAB_ENV"
  rm -f "$LAB_ENV_SRC"
  echo "installed $LAB_ENV from the uploaded file"
fi
if [ ! -f "$LAB_ENV" ]; then
  install -m 600 "$BASE/src/.env.example" "$LAB_ENV"
  echo "Created $LAB_ENV from .env.example."
  echo "Fill in AUTH_SESSION_SECRET, ADMIN_WALLETS and the engine keys, then run this script again."
  exit 1
fi
if ! grep -qE '^AUTH_SESSION_SECRET=.+' "$LAB_ENV"; then
  echo "AUTH_SESSION_SECRET is empty in $LAB_ENV — sessions would be insecure. Fill it in and re-run."
  exit 1
fi
OPEN_ACCESS="${OPEN_ACCESS:-0}"; ENABLE_PAYMENTS="${ENABLE_PAYMENTS:-0}"; ENABLE_TELEGRAM="${ENABLE_TELEGRAM:-0}"
OVERRIDES="VAULT_WALLET_ADDRESS AUTH_DOMAIN AUTH_URI SERIES_SPEND_CAP_USD SERIES_ALLOWED_WALLETS SERIES_ALLOWED_HOSTS APP_ENV"
[ "$ENABLE_PAYMENTS" = 1 ] || OVERRIDES="$OVERRIDES SOLANA_PAY_RECIPIENT SOLANA_PAY_TEST_PACK"
[ "$ENABLE_TELEGRAM" = 1 ] || OVERRIDES="$OVERRIDES TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID SERIES_TELEGRAM_BOT_TOKEN SERIES_TELEGRAM_CHAT_ID"
PATTERN=$(echo "$OVERRIDES" | sed 's/ /=|^/g')
grep -vE "^(${PATTERN}=)" "$LAB_ENV" > "$BASE/.env.series-lab.tmp"
ADMINS=$(grep -E '^ADMIN_WALLETS=' "$LAB_ENV" | cut -d= -f2- || true)
if [ "$OPEN_ACCESS" != 1 ] && [ -z "${SERIES_ALLOWED_WALLETS:-}${ADMINS}" ]; then
  # An empty invite list means "everyone" — never for a server that spends real API money.
  echo "No ADMIN_WALLETS in $LAB_ENV and no SERIES_ALLOWED_WALLETS given — refusing to open staging to everyone."
  echo "Re-run as: SERIES_ALLOWED_WALLETS=0xYourWallet,... bash $0 $SRC_TAR"
  exit 1
fi
if [ "$OPEN_ACCESS" = 1 ]; then
  [ -n "$ADMINS" ] || { echo "OPEN_ACCESS=1 needs ADMIN_WALLETS in $LAB_ENV (someone must administer the open service)."; exit 1; }
  grep -qE '^ALCHEMY_API_KEY=.+|^SOLANA_RPC_URL=.+' "$LAB_ENV" || echo "WARNING: no ALCHEMY_API_KEY/SOLANA_RPC_URL — the welcome-credit balance check cannot reach Solana."
fi
if [ "$ENABLE_PAYMENTS" = 1 ]; then
  grep -qE '^SOLANA_PAY_RECIPIENT=.+' "$LAB_ENV" || { echo "ENABLE_PAYMENTS=1 needs SOLANA_PAY_RECIPIENT (public USDC address) in $LAB_ENV."; exit 1; }
  grep -qE '^SOLANA_PAY_TEST_PACK=1' "$LAB_ENV" && echo "WARNING: SOLANA_PAY_TEST_PACK=1 in $LAB_ENV — remove it after the micro-test."
fi
{
cat <<EOF

# ---- Series Lab host overrides (phase3.sh): OPEN_ACCESS=$OPEN_ACCESS ENABLE_PAYMENTS=$ENABLE_PAYMENTS ENABLE_TELEGRAM=$ENABLE_TELEGRAM ----
APP_ENV=production
AUTH_DOMAIN=$SERVICE_HOST
AUTH_URI=https://$SERVICE_HOST
VAULT_WALLET_ADDRESS=
# Daily spend cap: off by default on the host (users pay with credits; a cap would refuse
# paying users with "at daily capacity"). Pass SERIES_SPEND_CAP_USD=<usd> to upload.sh to set one.
SERIES_SPEND_CAP_USD=${SERIES_SPEND_CAP_USD:-off}
# Public bind is 0.0.0.0; without this list the Host check is skipped.
SERIES_ALLOWED_HOSTS=$SERVICE_HOST
EOF
if [ "$OPEN_ACCESS" != 1 ]; then
  # invite-only (admins always allowed); add tester wallets comma-separated
  echo "SERIES_ALLOWED_WALLETS=${SERIES_ALLOWED_WALLETS:+${SERIES_ALLOWED_WALLETS},}$ADMINS"
fi
if [ "$ENABLE_PAYMENTS" != 1 ]; then
  printf '%s
' "# no payments from this deployment" "SOLANA_PAY_RECIPIENT=" "SOLANA_PAY_TEST_PACK="
fi
if [ "$ENABLE_TELEGRAM" != 1 ]; then
  printf '%s
' "# no operator notifications from this deployment" "TELEGRAM_BOT_TOKEN=" "TELEGRAM_CHAT_ID=" "SERIES_TELEGRAM_BOT_TOKEN=" "SERIES_TELEGRAM_CHAT_ID="
fi
} >> "$BASE/.env.series-lab.tmp"
install -m 600 -o "$LAB_USER" -g "$LAB_USER" "$BASE/.env.series-lab.tmp" "$BASE/.env.series-lab"
rm -f "$BASE/.env.series-lab.tmp"

cat > "$BASE/docker-compose.yml" <<EOF
# Generated by phase3.sh — Series Lab ($SERVICE_HOST)
name: series-lab
services:
  serieslab:
    image: series-lab:$REV
    container_name: serieslab
    env_file: .env.series-lab
    user: "1000:1000"
    volumes:
      - ./data-next:/data
    expose:
      - "5344"
    mem_limit: 512m
    restart: unless-stopped
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:5344/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 10s
      retries: 3
networks:
  default:
    name: $NETWORK
    external: true
EOF
chown -R "$LAB_USER:$LAB_USER" "$BASE"
# Container is uid 1000, not root. Secrets stay with $LAB_USER; only the data volume
# is given to the process. Existing root-owned ledgers need this chown once.
chown -R 1000:1000 "$BASE/data-next"

echo "==> 5. container"
docker compose -f "$BASE/docker-compose.yml" up -d
for i in $(seq 1 30); do
  if docker exec serieslab node -e "fetch('http://127.0.0.1:5344/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then echo "healthy"; break; fi
  sleep 2
  [ "$i" = 30 ] && { echo "container not healthy"; docker logs --tail 50 serieslab; exit 1; }
done

echo "==> 6. reverse proxy"
BLOCK=$(cat <<EOF

# Series Lab (deploy/series-lab/Caddyfile.staging in series-studio)
http://$SERVICE_HOST {
	reverse_proxy serieslab:5344
}
https://$SERVICE_HOST {
	import origin_tls
	import access_log
	reverse_proxy serieslab:5344
}
EOF
)
LEGACY_BLOCK=""
if [ -n "$LEGACY_HOST" ] && [ "$LEGACY_HOST" != "$SERVICE_HOST" ]; then
  LEGACY_BLOCK=$(cat <<EOF

# Series Lab: the old name sends people to the new one
http://$LEGACY_HOST {
	redir https://$SERVICE_HOST{uri} 302
}
https://$LEGACY_HOST {
	import origin_tls
	redir https://$SERVICE_HOST{uri} 302
}
EOF
)
fi
if [ "${SKIP_CADDY:-0}" = 1 ]; then
  echo "SKIP_CADDY=1 — add these blocks to your reverse proxy yourself:"
  echo "$BLOCK"
  echo "$LEGACY_BLOCK"
elif grep -q "^https://$SERVICE_HOST {" "$CADDYFILE"; then
  echo "$SERVICE_HOST block already present"
else
  cp -a "$CADDYFILE" "$BASE/Caddyfile.before-phase3"
  if [ -n "$LEGACY_HOST" ]; then
    # drop the old Lab blocks for the legacy name (and their comment); they come back as redirects below
    awk -v a="http://$LEGACY_HOST" -v b="https://$LEGACY_HOST" '
      { if (!skip && ($1==a || $1==b) && $2=="{") { skip=1; next }
        if (skip) { if ($0=="}") skip=0; next }
        if ($0 ~ /^# Series Lab staging/) next
        print }' "$BASE/Caddyfile.before-phase3" > "$CADDYFILE.new" && cat "$CADDYFILE.new" > "$CADDYFILE" && rm -f "$CADDYFILE.new"
  fi
  printf '%s
' "$BLOCK" >> "$CADDYFILE"
  [ -n "$LEGACY_BLOCK" ] && printf '%s
' "$LEGACY_BLOCK" >> "$CADDYFILE"
fi
if [ "${SKIP_CADDY:-0}" != 1 ]; then
  if docker exec "$CADDY_CONTAINER" caddy validate --config /etc/caddy-src/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
    docker exec "$CADDY_CONTAINER" caddy reload --config /etc/caddy-src/Caddyfile --adapter caddyfile
    echo "caddy reloaded"
  else
    echo "caddy validate FAILED — restoring previous Caddyfile"
    [ -f "$BASE/Caddyfile.before-phase3" ] && cp -a "$BASE/Caddyfile.before-phase3" "$CADDYFILE"
    exit 1
  fi
fi

echo "==> 7. ledger backup"
if [ -f "$BASE/src/deploy/series-lab/install-backup.sh" ]; then
  bash "$BASE/src/deploy/series-lab/install-backup.sh"
else
  echo "install-backup.sh missing — snapshot cron not installed"
fi

echo "==> 8. smoke"
curl -s -o /dev/null -w "$SERVICE_HOST via proxy /health: %{http_code}\n" -H "Host: $SERVICE_HOST" http://127.0.0.1/health
# Optional read-only check that another site behind the same proxy still answers:
#   SMOKE_OTHER=host/path  (e.g. SMOKE_OTHER=example.com/health)
if [ -n "${SMOKE_OTHER:-}" ]; then
  curl -s -o /dev/null -w "other site ${SMOKE_OTHER}: %{http_code}\n" -H "Host: ${SMOKE_OTHER%%/*}" "http://127.0.0.1/${SMOKE_OTHER#*/}"
fi
echo "done — DNS: next → this server (proxied) in Cloudflare"
echo "NOTE: the proxy block lives in the shared Caddyfile; keep a copy of it wherever that file is versioned."
