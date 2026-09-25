#!/usr/bin/env bash
# Consistent snapshots of the credit ledger.
# Live money is still Промт's users.db until Ф4; Series Lab's copy is included
# when that container is up. Online backup (not cp) so WAL is not torn.
#
# Local retention: 7 daily + 4 weekly under /opt/series-lab/backups/.
# Offsite: set BACKUP_RCLONE_REMOTE and BACKUP_PASSPHRASE in backup.env.
# Without those, snapshots stay on this server (same disk as the live db).
set -euo pipefail

BASE=${SERIES_LAB_BASE:-/opt/series-lab}
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

mkdir -p "$DEST/daily" "$DEST/weekly" "$BASE/logs"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

note() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

backup_python() {
  local container=$1 src=$2 out=$3
  docker exec -e SRC="$src" -e DEST=/tmp/series-lab-users-backup.db "$container" \
    python -c 'import os,sqlite3,sys
s=sqlite3.connect(os.environ["SRC"])
d=sqlite3.connect(os.environ["DEST"])
s.backup(d); d.close(); s.close()
c=sqlite3.connect(os.environ["DEST"])
r=c.execute("PRAGMA integrity_check").fetchone()[0]
c.close()
sys.exit(0 if r=="ok" else 1)'
  docker cp "$container:/tmp/series-lab-users-backup.db" "$out"
  docker exec "$container" rm -f /tmp/series-lab-users-backup.db
}

backup_node() {
  local container=$1 src=$2 out=$3
  docker exec -i -e BACKUP_SRC="$src" -e BACKUP_DEST=/tmp/series-lab-users-backup.db "$container" \
    node --input-type=module - < "$MJS"
  docker cp "$container:/tmp/series-lab-users-backup.db" "$out"
  docker exec "$container" rm -f /tmp/series-lab-users-backup.db
}

container_up() {
  docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null | grep -qx true
}

copy_sidecars() {
  local from=$1 to=$2
  local f
  for f in genesis_mints.json vault_catalog.json; do
    [ -f "$from/$f" ] && cp -a "$from/$f" "$to/$f"
  done
}

saved=0

if container_up nft-builder-api; then
  mkdir -p "$WORK/promt"
  note "snapshot Промт users.db"
  backup_python nft-builder-api /app/data/users.db "$WORK/promt/users.db"
  copy_sidecars /opt/w3ir/data "$WORK/promt"
  saved=1
else
  note "skip Промт: container nft-builder-api is not running"
fi

lab=""
if container_up serieslab; then lab=serieslab
elif container_up series-lab; then lab=series-lab
fi
if [ -n "$lab" ]; then
  mkdir -p "$WORK/series-lab"
  note "snapshot Series Lab users.db ($lab)"
  backup_node "$lab" /data/users.db "$WORK/series-lab/users.db"
  [ -d /opt/series-lab/data-next ] && copy_sidecars /opt/series-lab/data-next "$WORK/series-lab"
  saved=1
else
  note "skip Series Lab: container is not running"
fi

[ "$saved" = 1 ] || { note "nothing to back up"; exit 1; }

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
