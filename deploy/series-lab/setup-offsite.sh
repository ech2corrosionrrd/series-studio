#!/usr/bin/env bash
# Turn on the offsite copy of the ledger in one go. Does everything except typing the keys:
# creates the rclone remote, PROVES it is reachable, uploads a real encrypted snapshot,
# downloads it back and decrypts it, and only then writes BACKUP_RCLONE_REMOTE into backup.env.
# Keys are read hidden (not as arguments: those leak into `ps` and shell history).
#
# Run ON THE SERVER as root (backup.sh runs from root's cron):
#   bash /opt/series-lab/src/deploy/series-lab/setup-offsite.sh
#
# Target: any S3-compatible storage with API keys (Hetzner Object Storage, Backblaze B2,
# Cloudflare R2). Avoid OAuth remotes (Proton, Drive): the token expires and the backup dies
# silently. Idempotent. A remote that fails the check is DELETED, never left half-working.
set -euo pipefail

BASE=${SERIES_LAB_BASE:-/opt/series-lab}
ENV_FILE=${BACKUP_ENV:-$BASE/backup.env}
RCLONE=${RCLONE_BIN:-$(command -v rclone || true)}
REMOTE=${REMOTE:-series-offsite}
BUCKET=${BUCKET:-series-lab-backups}
PROVIDER=${PROVIDER:-Other}                         # Other | Hetzner | Cloudflare | Backblaze...
ENDPOINT=${ENDPOINT:-}                              # e.g. fsn1.your-objectstorage.com
REGION=${REGION:-}                                  # Hetzner requires it (fsn1, nbg1, hel1); old rclone has no Hetzner provider: use PROVIDER=Other
DEST=${BACKUP_DIR:-$BASE/backups}

die() { echo "ERROR: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root"
[ -x "$RCLONE" ] || die "rclone not found (set RCLONE_BIN)"
command -v openssl >/dev/null || die "openssl missing"
[ -n "$ENDPOINT" ] || die "set ENDPOINT, e.g. ENDPOINT=fsn1.your-objectstorage.com PROVIDER=Hetzner"
[ -f "$ENV_FILE" ] || die "$ENV_FILE missing — run install-backup.sh first"

SNAP=$(ls -1dt "$DEST"/daily/*/ 2>/dev/null | head -1 || true)
SNAP=${SNAP%/}
[ -n "$SNAP" ] && { [ -f "$SNAP/users.db" ] || [ -f "$SNAP/series-lab/users.db" ]; } || die "no daily snapshot in $DEST/daily — run backup.sh first"

echo "== 1/4 credentials (hidden input)"
read -rsp "Access key ID:     " AKEY; echo
read -rsp "Secret access key: " SKEY; echo
[ -n "$AKEY" ] && [ -n "$SKEY" ] || die "empty key — nothing changed"
PASS=$(openssl rand -base64 33)

echo "== 2/4 remote '$REMOTE'"
"$RCLONE" config delete "$REMOTE" 2>/dev/null || true
"$RCLONE" config create "$REMOTE" s3 provider="$PROVIDER" endpoint="$ENDPOINT" \
  ${REGION:+region="$REGION"} access_key_id="$AKEY" secret_access_key="$SKEY" >/dev/null
unset AKEY SKEY
if ! "$RCLONE" lsd "$REMOTE:" --max-depth 1 >/dev/null 2>&1; then
  "$RCLONE" config delete "$REMOTE" 2>/dev/null || true
  die "remote unreachable — config DELETED (wrong keys, endpoint or no storage yet)"
fi
"$RCLONE" mkdir "$REMOTE:$BUCKET" 2>/dev/null || true

echo "== 3/4 upload + round-trip"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
NAME=probe-$(date -u +%Y%m%d-%H%M).tar.gz.enc
export PASS
tar -C "$SNAP" -czf - . | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:PASS -out "$TMP/$NAME"
"$RCLONE" copy "$TMP/$NAME" "$REMOTE:$BUCKET/" --retries 3
mkdir "$TMP/back"
# copyto, not copy (Hetzner answers 403 to copy's directory probe of a single file); a just-written
# object may also answer 403 for a few seconds, so retry with a pause
for _ in 1 2 3 4 5 6; do
  "$RCLONE" copyto "$REMOTE:$BUCKET/$NAME" "$TMP/back/$NAME" 2>/dev/null && [ -s "$TMP/back/$NAME" ] && break
  sleep 5
done
[ -f "$TMP/back/$NAME" ] || die "copy cannot be read back from the cloud"
mkdir "$TMP/open"
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:PASS -in "$TMP/back/$NAME" | tar -C "$TMP/open" -xzf -
[ -s "$TMP/open/series-lab/users.db" ] || [ -s "$TMP/open/users.db" ] || die "round-trip failed: users.db not found after decrypt"
echo "   round-trip ok"

echo "== 4/4 enabling in $ENV_FILE"
sed -i '/^BACKUP_RCLONE_REMOTE=/d;/^BACKUP_PASSPHRASE=/d' "$ENV_FILE"
{
  echo "BACKUP_RCLONE_REMOTE=$REMOTE:$BUCKET"
  echo "BACKUP_PASSPHRASE=$PASS"
} >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "done. The passphrase was written ONLY to $ENV_FILE — copy it to your password manager NOW:"
echo "without it the cloud copies cannot be decrypted. (Read it: grep BACKUP_PASSPHRASE $ENV_FILE)"
