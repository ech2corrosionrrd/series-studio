#!/usr/bin/env bash
# Restore drill + freshness check for the newest ledger snapshot.
#   verify-backup.sh drill   weekly: newest daily snapshot must open, pass integrity_check,
#                            contain the core tables
#   verify-backup.sh fresh   daily: newest HOURLY snapshot must be younger than
#                            VERIFY_MAX_AGE_HOURS (default 3) — catches a silently dead cron
#   verify-backup.sh disk    the disk holding the data (DISK_PATH, default $BASE) must be below
#                            DISK_WARN_PCT (default 80) full: wallets upload PNG layers and
#                            generate images, a full disk would stop the ledger
# On a problem: exit 1 and, if set in backup.env, a Telegram alert
# (SERIES_TELEGRAM_BOT_TOKEN + SERIES_TELEGRAM_CHAT_ID).
set -uo pipefail

MODE=${1:-drill}
BASE=${SERIES_LAB_BASE:-/opt/series-lab}
ENV_FILE=${BACKUP_ENV:-$BASE/backup.env}
MJS=${VERIFY_MJS:-$BASE/verify-backup.mjs}
DEST=${BACKUP_DIR:-$BASE/backups}

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

note() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

alert() {
  note "ALERT $*"
  if [ -n "${SERIES_TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${SERIES_TELEGRAM_CHAT_ID:-}" ]; then
    curl -fsS --max-time 15 "https://api.telegram.org/bot${SERIES_TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${SERIES_TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=Series Lab backup: $*" >/dev/null || note "telegram alert failed"
  fi
}

if [ "$MODE" = disk ]; then
  path=${DISK_PATH:-$BASE}
  limit=${DISK_WARN_PCT:-80}
  used=$(df -P "$path" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')
  [ -n "$used" ] || { alert "disk: cannot read usage of $path"; exit 1; }
  if [ "$used" -ge "$limit" ]; then
    alert "disk: $path is ${used}% full (limit ${limit}%) — free space or grow the disk"
    exit 1
  fi
  note "disk ok: $path ${used}% (limit ${limit}%)"
  exit 0
fi

case "$MODE" in
  drill) sub=daily;  max=0 ;;
  fresh) sub=hourly; max=${VERIFY_MAX_AGE_HOURS:-3} ;;
  *) echo "usage: $0 drill|fresh|disk"; exit 2 ;;
esac

snap=$(ls -1dt "$DEST/$sub"/*/ 2>/dev/null | head -1)
snap=${snap%/}
# hourly slots hold users.db directly; daily/weekly slots keep it under series-lab/
db=""
for cand in "$snap/users.db" "$snap/series-lab/users.db"; do
  [ -n "$snap" ] && [ -f "$cand" ] && { db=$cand; break; }
done
if [ -z "$db" ]; then
  alert "$MODE: no $sub snapshot with users.db in $DEST/$sub"
  exit 1
fi

lab=""
for c in serieslab series-lab; do
  if docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null | grep -qx true; then lab=$c; break; fi
done
[ -n "$lab" ] || { alert "$MODE: Series Lab container is not running"; exit 1; }

# The container's node has node:sqlite; the host may not have node at all.
tmp=/tmp/series-lab-verify.db
docker cp "$db" "$lab:$tmp"
out=$(docker exec -i -e VERIFY_DB="$tmp" -e VERIFY_MAX_AGE_HOURS="$max" "$lab" node --input-type=module - < "$MJS" 2>&1)
rc=$?
docker exec "$lab" rm -f "$tmp" >/dev/null 2>&1 || true

# docker cp keeps the host mtime, so the age check measures the snapshot, not the copy.
if [ $rc -ne 0 ]; then
  alert "$MODE failed for $(basename "$snap"): $out"
  exit 1
fi
note "$MODE ok ($(basename "$snap")): $out"
