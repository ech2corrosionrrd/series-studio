#!/usr/bin/env bash
# From the PC (repo root): upload the current commit + phase3 scripts to the server
# and run Ф3.   bash deploy/series-lab/upload.sh [root@2.28.7.128]
set -euo pipefail
HOST="${1:-root@2.28.7.128}"
REV=$(git rev-parse --short HEAD)
TMP=$(mktemp -d)
git archive --format=tar HEAD > "$TMP/src.tar"
mkdir -p "$TMP/rev" && echo "$REV" > "$TMP/rev/REVISION"
tar -rf "$TMP/src.tar" -C "$TMP/rev" REVISION
scp -q "$TMP/src.tar" "$HOST:/tmp/series-lab-src.tar"
scp -q deploy/series-lab/phase3.sh "$HOST:/tmp/series-lab-phase3.sh"
scp -q deploy/series-lab/phase3-rollback.sh "$HOST:/tmp/series-lab-phase3-rollback.sh"
ssh "$HOST" "bash /tmp/series-lab-phase3.sh /tmp/series-lab-src.tar"
rm -rf "$TMP"
