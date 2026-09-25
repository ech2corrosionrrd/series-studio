#!/usr/bin/env bash
# From the PC (repo root): upload the current commit + scripts to the server and run the
# standalone staging deploy (phase3.sh).
#
#   [SERIES_ALLOWED_WALLETS=0x..,..] [SERIES_SPEND_CAP_USD=5] [LAB_ENV_FILE=./.env] [SKIP_CADDY=1] \
#     bash deploy/series-lab/upload.sh [root@HOST_IP]
#
# LAB_ENV_FILE (optional) is sent over ssh once and installed as /opt/series-lab/lab.env (chmod 600).
# Without it, put your secrets into /opt/series-lab/lab.env on the server yourself.
set -euo pipefail
HOST="${1:-root@HOST_IP}"
REV=$(git rev-parse --short HEAD)
TMP=$(mktemp -d)
git archive --format=tar HEAD > "$TMP/src.tar"
mkdir -p "$TMP/rev" && echo "$REV" > "$TMP/rev/REVISION"
tar -rf "$TMP/src.tar" -C "$TMP/rev" REVISION
scp -q "$TMP/src.tar" "$HOST:/tmp/series-lab-src.tar"
scp -q deploy/series-lab/phase3.sh "$HOST:/tmp/series-lab-phase3.sh"
scp -q deploy/series-lab/phase3-rollback.sh "$HOST:/tmp/series-lab-phase3-rollback.sh"
scp -q deploy/series-lab/reset-staging.sh "$HOST:/tmp/series-lab-reset-staging.sh"
LAB_ENV_SRC=""
if [ -n "${LAB_ENV_FILE:-}" ]; then
  scp -q "$LAB_ENV_FILE" "$HOST:/tmp/series-lab-lab.env"
  LAB_ENV_SRC=/tmp/series-lab-lab.env
fi
# Forward the staging knobs (ssh does not pass local environment variables).
ssh "$HOST" "SERIES_ALLOWED_WALLETS='${SERIES_ALLOWED_WALLETS:-}' SERIES_SPEND_CAP_USD='${SERIES_SPEND_CAP_USD:-}' SKIP_CADDY='${SKIP_CADDY:-0}' LAB_ENV_SRC='${LAB_ENV_SRC}' bash /tmp/series-lab-phase3.sh /tmp/series-lab-src.tar"
rm -rf "$TMP"
