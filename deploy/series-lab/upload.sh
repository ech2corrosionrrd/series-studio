#!/usr/bin/env bash
# From the PC (repo root): upload the current commit + phase3 scripts to the server
# and run Ф3.   [SERIES_ALLOWED_WALLETS=0x..,..] [REFRESH_DATA=1] bash deploy/series-lab/upload.sh [root@HOST_IP]
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
# Forward the staging knobs (ssh does not pass local environment variables).
ssh "$HOST" "SERIES_ALLOWED_WALLETS='${SERIES_ALLOWED_WALLETS:-}' REFRESH_DATA='${REFRESH_DATA:-0}' SERIES_SPEND_CAP_USD='${SERIES_SPEND_CAP_USD:-}' bash /tmp/series-lab-phase3.sh /tmp/series-lab-src.tar"
rm -rf "$TMP"
