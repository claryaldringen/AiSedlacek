#!/usr/bin/env bash
# Denní záloha AiSedlacek: Postgres dump + (volitelně) off-site kopie dumpů a uploadů.
#
# Instalace na serveru (jednorázově, jako root):
#   install -m 700 ops/backup/aisedlacek-backup.sh /usr/local/bin/aisedlacek-backup
#   cp ops/backup/aisedlacek-backup.{service,timer} /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now aisedlacek-backup.timer
#
# Off-site kopie (doporučeno – lokální dump nepřežije ztrátu disku VPS): nastavte
# BACKUP_REMOTE v /etc/default/aisedlacek-backup, např.
#   BACKUP_REMOTE=u123456@u123456.your-storagebox.de:aisedlacek
# (Hetzner Storage Box přes SSH klíč). Bez něj se zálohuje jen lokálně.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/AiSedlacek}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/aisedlacek}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"

# `|| true`: chybějící řádek nesmí skript (set -e + pipefail) ukončit dřív,
# než se vůbec udělá dump DB.
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$APP_DIR/.env" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true)"
UPLOAD_DIR="$(grep -E '^UPLOAD_DIR=' "$APP_DIR/.env" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true)"
if [ -z "$DATABASE_URL" ]; then
  echo "CHYBA: v $APP_DIR/.env chybí DATABASE_URL" >&2
  exit 1
fi
UPLOAD_DIR="${UPLOAD_DIR:-$APP_DIR/uploads}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

dump="$BACKUP_DIR/aisedlacek-$(date +%Y%m%d-%H%M%S).dump"
# Prisma URL může mít ?schema=…, kterému pg_dump nerozumí.
pg_dump --format=custom --file="$dump" "${DATABASE_URL%%\?*}"
echo "DB dump: $dump ($(du -h "$dump" | cut -f1))"

# Rotace lokálních dumpů (pre-deploy dumpy z deploy.sh včetně).
find "$BACKUP_DIR" -name '*.dump' -mtime +"$RETENTION_DAYS" -delete

if [ -n "$BACKUP_REMOTE" ]; then
  rsync -a --delete "$BACKUP_DIR/" "$BACKUP_REMOTE/db/"
  # Uploady jsou originály skenů – nemazat na cíli, i když zmizí lokálně.
  rsync -a "$UPLOAD_DIR/" "$BACKUP_REMOTE/uploads/"
  echo "Off-site kopie: $BACKUP_REMOTE"
else
  echo "VAROVÁNÍ: BACKUP_REMOTE není nastaven – záloha je jen na disku VPS a uploady se nezálohují." >&2
fi
