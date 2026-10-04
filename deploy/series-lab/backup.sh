#!/usr/bin/env bash
# Consistent snapshots of Series Lab's OWN data: the credit ledger (users.db),
# per-wallet data and small JSON sidecars. Nothing from any other project.
# Online backup (not cp) so the WAL is not torn.
#
# Local retention: 48 hourly (ledger only, BACKUP_MODE=hourly) + 7 daily + 4 weekly
# under /opt/series-lab/backups/. Hourly exists because the ledger holds payments.
# Offsite: set BACKUP_RCLONE_REMOTE and BACKUP_PASSPHRASE in backup.env.
# Without those, snapshots stay on this server (same disk as the live db).
set -euo pipefail

BASE=${SERIES_LAB_BASE:-/opt/series-lab}
DATA=${SERIES_LAB_DATA_DIR:-$BASE/data-next}
ENV_FILE=${BACKUP_ENV:-$BASE/backup.env}
MJS=${BACKUP_MJS:-$BASE/backup-db.mjs}
DEST=${BACKUP_DIR:-$BASE/backups}
STAMP=$(date -u +%Y%m%d-%H%M)
DAY=$(date -u +%u)

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

mkdir -p "$DEST/hourly" "$DEST/daily" "$DEST/weekly" "$BASE/logs"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

note() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

container_up() {
  docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null | grep -qx true
}

backup_node() {
  local container=$1 src=$2 out=$3
  docker exec -i -e BACKUP_SRC="$src" -e BACKUP_DEST=/tmp/series-lab-users-backup.db "$container" \
    node --input-type=module - < "$MJS"
  docker cp "$container:/tmp/series-lab-users-backup.db" "$out"
  docker exec "$container" rm -f /tmp/series-lab-users-backup.db
}

lab=""
if container_up serieslab; then lab=serieslab
elif container_up series-lab; then lab=series-lab
fi
[ -n "$lab" ] || { note "Series Lab container is not running — nothing to back up"; exit 1; }

prune() {
  local parent=$1 keep=$2 listing
  listing=$(ls -1dt "$parent"/*/ 2>/dev/null || true)
  [ -n "$listing" ] || return 0
  printf '%s\n' "$listing" | tail -n +"$((keep + 1))" | while read -r old; do
    [ -n "$old" ] || continue
    rm -rf "$old"
    note "pruned $old"
  done
}

if [ "${BACKUP_MODE:-full}" = hourly ]; then
  hslot="$DEST/hourly/$STAMP"
  mkdir -p "$hslot"
  backup_node "$lab" /data/users.db "$hslot/users.db"
  chmod 700 "$DEST/hourly" "$hslot"
  note "hourly ledger snapshot $hslot"
  prune "$DEST/hourly" 48
  exit 0
fi

mkdir -p "$WORK/series-lab"
note "snapshot Series Lab users.db ($lab)"
backup_node "$lab" /data/users.db "$WORK/series-lab/users.db"
for f in genesis_mints.json vault_catalog.json; do
  [ -f "$DATA/$f" ] && cp -a "$DATA/$f" "$WORK/series-lab/$f"
done
[ -d "$DATA/users" ] && cp -a "$DATA/users" "$WORK/series-lab/users"

slot="$DEST/daily/$STAMP"
mkdir -p "$slot"
cp -a "$WORK/." "$slot/"
chmod 700 "$DEST" "$DEST/daily" "$slot"
note "saved $slot"

if [ "$DAY" = 7 ]; then
  wslot="$DEST/weekly/$STAMP"
  mkdir -p "$wslot"
  cp -a "$slot/." "$wslot/"
  chmod 700 "$DEST/weekly" "$wslot"
  note "weekly $wslot"
fi

prune "$DEST/daily" 7
prune "$DEST/weekly" 4

remote=${BACKUP_RCLONE_REMOTE:-}
if [ -z "$remote" ]; then
  note "offsite skipped (BACKUP_RCLONE_REMOTE empty) — copies are on this disk only"
  exit 0
fi
if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  note "offsite refused: BACKUP_RCLONE_REMOTE is set but BACKUP_PASSPHRASE is empty"
  exit 1
fi
command -v openssl >/dev/null || { note "openssl missing"; exit 1; }
rclone_bin=${RCLONE_BIN:-}
if [ -z "$rclone_bin" ]; then
  if command -v rclone >/dev/null; then rclone_bin=$(command -v rclone)
  elif [ -x /home/w3ir/bin/rclone ]; then rclone_bin=/home/w3ir/bin/rclone
  else note "rclone not found"; exit 1
  fi
fi
archive="$WORK/users-$STAMP.tar.gz.enc"
tar -C "$slot" -czf - . | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -out "$archive"
"$rclone_bin" copy "$archive" "$remote" --retries 3
note "offsite uploaded $(basename "$archive") -> $remote"
