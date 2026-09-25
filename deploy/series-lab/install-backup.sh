#!/usr/bin/env bash
# Install the ledger backup on the Hetzner host and take one snapshot now.
# Run as root on the server. phase3.sh calls this after the container is up.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }

HERE=$(cd "$(dirname "$0")" && pwd)
BASE=${SERIES_LAB_BASE:-/opt/series-lab}
if [ -f "$HERE/../../scripts/backup-db.mjs" ]; then
  MJS="$HERE/../../scripts/backup-db.mjs"
elif [ -f "$HERE/backup-db.mjs" ]; then
  MJS="$HERE/backup-db.mjs"
else
  echo "backup-db.mjs not found next to install-backup.sh"
  exit 1
fi

install -d -m 755 "$BASE" "$BASE/backups/daily" "$BASE/backups/weekly" "$BASE/logs"
install -m 755 "$HERE/backup.sh" "$BASE/backup.sh"
install -m 644 "$MJS" "$BASE/backup-db.mjs"

if [ ! -f "$BASE/backup.env" ]; then
  cat > "$BASE/backup.env" <<'EOF'
# Offsite copy of the credit ledger. Empty remote = snapshots stay on this server.
# Create the remote once: rclone config  (name it, then set BACKUP_RCLONE_REMOTE=name:bucket)
# BACKUP_PASSPHRASE is required whenever the remote is set. Do not commit this file.
BACKUP_RCLONE_REMOTE=
BACKUP_PASSPHRASE=
EOF
  chmod 600 "$BASE/backup.env"
  echo "wrote $BASE/backup.env (offsite still off until BACKUP_RCLONE_REMOTE is set)"
fi

cat > /etc/cron.d/series-lab-backup <<EOF
# Series Lab ledger snapshots. Env: $BASE/backup.env
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
15 3 * * * root $BASE/backup.sh >> $BASE/logs/backup.log 2>&1
EOF
chmod 644 /etc/cron.d/series-lab-backup

echo "cron installed: 03:15 UTC daily"
"$BASE/backup.sh"
