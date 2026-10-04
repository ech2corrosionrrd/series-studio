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

VERIFY_SRC="$HERE/../../scripts/verify-backup.mjs"
[ -f "$VERIFY_SRC" ] || VERIFY_SRC="$HERE/verify-backup.mjs"
[ -f "$VERIFY_SRC" ] || { echo "verify-backup.mjs not found next to install-backup.sh"; exit 1; }

install -d -m 755 "$BASE" "$BASE/backups/hourly" "$BASE/backups/daily" "$BASE/backups/weekly" "$BASE/logs"
install -m 755 "$HERE/backup.sh" "$BASE/backup.sh"
install -m 755 "$HERE/verify-backup.sh" "$BASE/verify-backup.sh"
install -m 644 "$MJS" "$BASE/backup-db.mjs"
install -m 644 "$VERIFY_SRC" "$BASE/verify-backup.mjs"

if [ ! -f "$BASE/backup.env" ]; then
  cat > "$BASE/backup.env" <<'EOF'
# Offsite copy of the credit ledger. Empty remote = snapshots stay on this server.
# Create the remote once: rclone config  (name it, then set BACKUP_RCLONE_REMOTE=name:bucket)
# BACKUP_PASSPHRASE is required whenever the remote is set. Do not commit this file.
# Easiest: run deploy/series-lab/setup-offsite.sh (creates the remote and proves a round-trip).
BACKUP_RCLONE_REMOTE=
BACKUP_PASSPHRASE=
# Alerts when a snapshot is missing, stale or does not open (optional).
SERIES_TELEGRAM_BOT_TOKEN=
SERIES_TELEGRAM_CHAT_ID=
EOF
  chmod 600 "$BASE/backup.env"
  echo "wrote $BASE/backup.env (offsite still off until BACKUP_RCLONE_REMOTE is set)"
fi

cat > /etc/cron.d/series-lab-backup <<EOF
# Series Lab ledger snapshots. Env: $BASE/backup.env
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# hourly: ledger only (payments), 48 copies
5 * * * * root BACKUP_MODE=hourly $BASE/backup.sh >> $BASE/logs/backup.log 2>&1
# daily: ledger + wallet data + offsite copy
15 3 * * * root $BASE/backup.sh >> $BASE/logs/backup.log 2>&1
# every 6 h: newest hourly snapshot must be fresh (a dead cron is otherwise silent)
20 */6 * * * root $BASE/verify-backup.sh fresh >> $BASE/logs/verify.log 2>&1
# every 6 h: disk below DISK_WARN_PCT (default 80%), Telegram alert otherwise
25 */6 * * * root $BASE/verify-backup.sh disk >> $BASE/logs/verify.log 2>&1
# weekly restore drill: newest daily snapshot must really open
0 5 * * 0 root $BASE/verify-backup.sh drill >> $BASE/logs/verify.log 2>&1
EOF
chmod 644 /etc/cron.d/series-lab-backup

echo "cron installed: hourly ledger, 03:15 UTC full, freshness and disk every 6 h, drill on Sundays"
"$BASE/backup.sh"
BACKUP_MODE=hourly "$BASE/backup.sh"
"$BASE/verify-backup.sh" drill
