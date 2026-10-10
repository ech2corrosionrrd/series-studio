#!/usr/bin/env bash
# Restore drill + freshness check for the newest ledger snapshot.
#   verify-backup.sh drill    weekly: newest daily snapshot must open, pass integrity_check,
#                             contain the core tables
#   verify-backup.sh fresh    daily: newest HOURLY snapshot must be younger than
#                             VERIFY_MAX_AGE_HOURS (default 3) — catches a silently dead cron
#   verify-backup.sh disk     the disk holding the data (DISK_PATH, default $BASE) must be below
#                             DISK_WARN_PCT (default 80) full: wallets upload PNG layers and
#                             generate images, a full disk would stop the ledger
#   verify-backup.sh offsite  daily: the last full run must have uploaded the cloud copy and not
#                             longer ago than VERIFY_OFFSITE_MAX_HOURS (default 30). Silent when
#                             no BACKUP_RCLONE_REMOTE is set (offsite is deliberately off)
#   verify-backup.sh cloud    weekly: download the NEWEST cloud copy, decrypt it with
#                             BACKUP_PASSPHRASE and run the same drill on it. Proves the copy in
#                             the cloud really opens (wrong passphrase, broken upload, dead keys)
# On a problem: exit 1 and, if set in backup.env, a Telegram alert
# (SERIES_TELEGRAM_BOT_TOKEN + SERIES_TELEGRAM_CHAT_ID).
set -uo pipefail

MODE=${1:-drill}
BASE=${SERIES_LAB_BASE:-/opt/series-lab}
ENV_FILE=${BACKUP_ENV:-$BASE/backup.env}
MJS=${VERIFY_MJS:-$BASE/verify-backup.mjs}
DEST=${BACKUP_DIR:-$BASE/backups}
DATA=${SERIES_LAB_DATA_DIR:-$BASE/data-next}

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

# Hours since an ISO time (2026-10-10T07:30:07Z); empty when it cannot be parsed.
age_hours() {
  local ts
  ts=$(date -u -d "$1" +%s 2>/dev/null) || return 0
  echo $(( ( $(date -u +%s) - ts ) / 3600 ))
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

if [ "$MODE" = offsite ]; then
  if [ -z "${BACKUP_RCLONE_REMOTE:-}" ]; then
    note "offsite: not configured (BACKUP_RCLONE_REMOTE empty), nothing to check"
    exit 0
  fi
  status="$DATA/backup-status.json"
  [ -f "$status" ] || { alert "offsite: $status is missing, no backup has reported yet"; exit 1; }
  off=$(grep -o '"offsite":[a-z]*' "$status" | cut -d: -f2)
  oat=$(grep -o '"offsiteAt":"[^"]*"' "$status" | cut -d'"' -f4)
  max=${VERIFY_OFFSITE_MAX_HOURS:-30}
  if [ "$off" != true ]; then
    alert "offsite: the last full backup did NOT reach the cloud (remote $BACKUP_RCLONE_REMOTE). Check logs/backup.log"
    exit 1
  fi
  age=$(age_hours "$oat")
  if [ -z "$age" ]; then
    alert "offsite: no time of the last cloud copy in $status"
    exit 1
  fi
  if [ "$age" -ge "$max" ]; then
    alert "offsite: the last cloud copy is ${age} h old (limit ${max} h). The daily cron may be dead"
    exit 1
  fi
  note "offsite ok: last cloud copy ${age} h ago (limit ${max} h)"
  exit 0
fi

lab=""
find_lab() {
  local c
  for c in serieslab series-lab; do
    if docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null | grep -qx true; then lab=$c; return 0; fi
  done
  return 1
}

# check_db <users.db> <label> <max age hours, 0 = no age check>
# The container's node has node:sqlite; the host may not have node at all.
check_db() {
  local db=$1 label=$2 max=$3 tmp=/tmp/series-lab-verify.db out rc
  find_lab || { alert "$MODE: Series Lab container is not running"; return 1; }
  docker cp "$db" "$lab:$tmp"
  out=$(docker exec -i -e VERIFY_DB="$tmp" -e VERIFY_MAX_AGE_HOURS="$max" "$lab" node --input-type=module - < "$MJS" 2>&1)
  rc=$?
  docker exec "$lab" rm -f "$tmp" >/dev/null 2>&1 || true
  # docker cp keeps the host mtime, so the age check measures the snapshot, not the copy.
  if [ $rc -ne 0 ]; then
    alert "$MODE failed for $label: $out"
    return 1
  fi
  note "$MODE ok ($label): $out"
}

if [ "$MODE" = cloud ]; then
  remote=${BACKUP_RCLONE_REMOTE:-}
  if [ -z "$remote" ]; then
    note "cloud: not configured (BACKUP_RCLONE_REMOTE empty), nothing to check"
    exit 0
  fi
  [ -n "${BACKUP_PASSPHRASE:-}" ] || { alert "cloud: BACKUP_PASSPHRASE is empty, cannot open cloud copies"; exit 1; }
  rclone_bin=${RCLONE_BIN:-$(command -v rclone || true)}
  [ -n "$rclone_bin" ] || { alert "cloud: rclone not found"; exit 1; }
  name=$("$rclone_bin" lsf "$remote" --include 'users-*.tar.gz.enc' 2>/dev/null | sort | tail -1)
  [ -n "$name" ] || { alert "cloud: no users-*.tar.gz.enc in $remote (keys dead or nothing uploaded)"; exit 1; }
  stamp=${name#users-}; stamp=${stamp%.tar.gz.enc}
  # users-20261010-0730 -> 2026-10-10T07:30:00Z
  iso="${stamp:0:4}-${stamp:4:2}-${stamp:6:2}T${stamp:9:2}:${stamp:11:2}:00Z"
  age=$(age_hours "$iso")
  maxcloud=${VERIFY_CLOUD_MAX_AGE_HOURS:-50}
  if [ -n "$age" ] && [ "$age" -ge "$maxcloud" ]; then
    alert "cloud: the newest cloud copy $name is ${age} h old (limit ${maxcloud} h)"
    exit 1
  fi
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  got=""
  # a just-written object can answer 403 for a few seconds, and copyto (not copy) is the form
  # that works for one file on Hetzner; retry with a pause
  for _ in 1 2 3 4 5 6; do
    if "$rclone_bin" copyto "$remote/$name" "$tmp/$name" 2>/dev/null && [ -s "$tmp/$name" ]; then got=1; break; fi
    sleep 5
  done
  [ -n "$got" ] || { alert "cloud: cannot download $name from $remote"; exit 1; }
  mkdir "$tmp/open"
  if ! BACKUP_PASSPHRASE="$BACKUP_PASSPHRASE" openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in "$tmp/$name" 2>/dev/null | tar -C "$tmp/open" -xzf - 2>/dev/null; then
    alert "cloud: $name does not decrypt with the current BACKUP_PASSPHRASE"
    exit 1
  fi
  db=""
  for cand in "$tmp/open/users.db" "$tmp/open/series-lab/users.db"; do
    [ -f "$cand" ] && { db=$cand; break; }
  done
  [ -n "$db" ] || { alert "cloud: users.db not found inside $name"; exit 1; }
  check_db "$db" "cloud:$name" 0 || exit 1
  exit 0
fi

case "$MODE" in
  drill) sub=daily;  max=0 ;;
  fresh) sub=hourly; max=${VERIFY_MAX_AGE_HOURS:-3} ;;
  *) echo "usage: $0 drill|fresh|disk|offsite|cloud"; exit 2 ;;
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

check_db "$db" "$(basename "$snap")" "$max" || exit 1
