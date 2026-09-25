#!/usr/bin/env bash
# Clean slate for the Series Lab staging. Touches ONLY /opt/series-lab (Lab's own directory):
# stops the container, deletes the ledger + wallet data (data-next) and the generated
# .env.series-lab, so the next phase3.sh run starts from an empty ledger and Lab's own lab.env.
# It does not touch any other project on the host.
#
#   CONFIRM=yes bash /tmp/series-lab-reset-staging.sh          (as root, on the server)
#   CONFIRM=yes KEEP_BACKUP=1 ...                              (take a Lab snapshot first)
set -euo pipefail
BASE=/opt/series-lab
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[ -d "$BASE" ] || { echo "$BASE does not exist — nothing to reset"; exit 0; }
if [ "${CONFIRM:-}" != yes ]; then
  echo "This deletes $BASE/data-next (ledger + wallet data) and $BASE/.env.series-lab."
  echo "Re-run with CONFIRM=yes to proceed (KEEP_BACKUP=1 takes a snapshot first)."
  exit 1
fi
if [ "${KEEP_BACKUP:-0}" = 1 ] && [ -x "$BASE/backup.sh" ]; then
  "$BASE/backup.sh" || echo "backup failed — continuing (you asked for the reset)"
fi
[ -f "$BASE/docker-compose.yml" ] && docker compose -f "$BASE/docker-compose.yml" down && echo "serieslab stopped"
rm -rf "$BASE/data-next"
rm -f "$BASE/.env.series-lab"
echo "reset done."
echo "Next: make sure $BASE/lab.env holds Lab's own secrets (or use LAB_ENV_FILE with upload.sh), then run upload.sh."
