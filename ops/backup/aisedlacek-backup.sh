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
#
# Off-site kopie je jen přírůstková: nové dumpy a uploady se doplní, na cíli se nic
# nemaže ani nepřepisuje – smazání nebo poškození lokálních souborů se tak na
# off-site kopii nepropíše. Úklid starých dumpů na cíli je proto potřeba řešit
# tam (retence / snapshoty úložiště), skript ho nedělá.
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

# Percent-dekódování části URL (heslo s @, :, / apod. je v DATABASE_URL zakódované).
urldecode() {
  local s="${1//\\/\\\\}"
  printf '%b' "${s//%/\\x}"
}

# Hodnota pro .pgpass – dvojtečka a zpětné lomítko se escapují zpětným lomítkem.
pgpass_escape() {
  local s="${1//\\/\\\\}"
  printf '%s' "${s//:/\\:}"
}

# Přihlašovací údaje pro pg_dump NE v argumentech (na sdíleném VPS by heslo
# viděl každý uživatel v `ps`) a ani v proměnné PGPASSWORD: z DATABASE_URL se
# rozloží do PGHOST/PGPORT/PGUSER/PGDATABASE a heslo jde do dočasného souboru
# .pgpass (práva 600, PGPASSFILE), který se po skončení smaže.
url="${DATABASE_URL#postgresql://}"
url="${url#postgres://}"
url="${url%%\?*}" # Prisma přidává ?schema=…, kterému pg_dump nerozumí
creds=""
hostpart="$url"
if [[ "$url" == *@* ]]; then
  creds="${url%@*}"
  hostpart="${url##*@}"
fi
db_user="${creds%%:*}"
db_pass=""
if [[ "$creds" == *:* ]]; then db_pass="${creds#*:}"; fi
hostport="${hostpart%%/*}"
db_name=""
if [[ "$hostpart" == */* ]]; then db_name="${hostpart#*/}"; fi
if [[ "$hostport" == \[* ]]; then
  # IPv6: [::1]:5432
  db_host="${hostport%%]*}"
  db_host="${db_host#\[}"
  db_port="${hostport##*]}"
  db_port="${db_port#:}"
else
  db_host="${hostport%%:*}"
  db_port=""
  if [[ "$hostport" == *:* ]]; then db_port="${hostport##*:}"; fi
fi

pg_env=(PGHOST="${db_host:-localhost}" PGPORT="${db_port:-5432}")
if [ -n "$db_user" ]; then pg_env+=(PGUSER="$(urldecode "$db_user")"); fi
if [ -n "$db_name" ]; then pg_env+=(PGDATABASE="$(urldecode "$db_name")"); fi

work_dir="$(mktemp -d)"
partial=""
# Úklid při jakémkoli konci: dočasný .pgpass a rozepsaný (nepovedený) dump.
cleanup() {
  rm -rf "$work_dir"
  if [ -n "$partial" ] && [ -e "$partial" ]; then rm -f "$partial"; fi
}
trap cleanup EXIT
chmod 700 "$work_dir"
if [ -n "$db_pass" ]; then
  (
    umask 077
    printf '*:*:*:%s:%s\n' \
      "$(pgpass_escape "$(urldecode "$db_user")")" \
      "$(pgpass_escape "$(urldecode "$db_pass")")" >"$work_dir/pgpass"
  )
  pg_env+=(PGPASSFILE="$work_dir/pgpass")
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Všechny nástroje Postgresu z jedné (nejnovější nainstalované) verze. pg_wrapper
# na Debianu/Ubuntu vybírá verzi podle cíle: pg_dump přes TCP bere nejnovějšího
# klienta (17), pg_restore čtoucí jen soubor verzi lokálního clusteru (16) – a ta
# dump novější verze nepřečte („unsupported version (1.16) in file header"), takže
# by ověření každou noc selhalo a dump se zahodil. Stejně jako deploy.sh.
PG_BIN=""
if pg_latest="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n1)" && [ -n "$pg_latest" ]; then
  PG_BIN="$pg_latest/"
fi

# Ověření dumpu plným přečtením: pg_restore --list čte jen obsah (TOC) na
# začátku souboru, poškozená nebo useknutá data za ním by prošla. Výstup do
# /dev/null projde celý soubor včetně dat všech tabulek (bez připojení k DB).
# Chybový výstup pg_restore jde do journalu (důvod selhání), jen stdout se zahazuje.
verify_dump() {
  "${PG_BIN}pg_restore" --file=/dev/null "$1" >/dev/null
}

# Rozepsané dumpy po přerušeném běhu (SIGKILL, pád serveru, restart) na začátku
# smazat: služba je oneshot, takže žádný jiný běh tohoto skriptu je nepíše.
# Jen vlastní prefix – pre-deploy dump z deploy.sh může zrovna běžet.
find "$BACKUP_DIR" -maxdepth 1 -name 'aisedlacek-*.dump.partial' -delete

# Dump se píše do .partial a na .dump se přejmenuje až po ověření – nepovedený
# dump (přerušený zápis, plný disk) tak nikdy neleží jako *.dump a neodejde
# off-site (tam by ho --ignore-existing už nikdy nenahradil).
# `env -u PGPASSWORD`: zděděná PGPASSWORD z prostředí roota má v libpq přednost
# před PGPASSFILE – záloha by pak padala na „password authentication failed".
dump="$BACKUP_DIR/aisedlacek-$(date +%Y%m%d-%H%M%S).dump"
partial="$dump.partial"
env -u PGPASSWORD "${pg_env[@]}" "${PG_BIN}pg_dump" --format=custom --file="$partial"
if ! verify_dump "$partial"; then
  echo "CHYBA: dump $partial nejde celý přečíst (pg_restore) – zahazuji ho" >&2
  exit 1
fi
mv "$partial" "$dump"
partial=""
echo "DB dump: $dump ($(du -h "$dump" | cut -f1))"

# Rotace lokálních dumpů (pre-deploy dumpy z deploy.sh včetně) a starých
# rozepsaných dumpů, které po sobě nechal přerušený deploy.
find "$BACKUP_DIR" \( -name '*.dump' -o -name '*.dump.partial' \) -mtime +"$RETENTION_DAYS" -delete

if [ -n "$BACKUP_REMOTE" ]; then
  # Off-site jdou jen *.dump ověřené plným přečtením (i pre-deploy dumpy
  # z deploy.sh): poškozený soubor by tam s --ignore-existing zůstal navždy.
  ship_list="$work_dir/ship.list"
  : >"$ship_list"
  for f in "$BACKUP_DIR"/*.dump; do
    [ -e "$f" ] || continue
    if verify_dump "$f"; then
      printf '%s\n' "$(basename "$f")" >>"$ship_list"
    else
      echo "VAROVÁNÍ: $f není platný dump – off-site se neposílá" >&2
    fi
  done
  # Jen doplnit nové soubory: bez --delete (lokální rotace ani smazání se na cíl
  # nepropíše) a s --ignore-existing (už odeslaný dump ani upload se nepřepíše
  # lokálně poškozenou verzí). Názvy dumpů i uploadů jsou unikátní a soubory se
  # po zápisu nemění.
  rsync -a --ignore-existing --files-from="$ship_list" "$BACKUP_DIR/" "$BACKUP_REMOTE/db/"
  # Uploady jsou originály skenů (<uuid>.<přípona>, nikdy se nepřepisují).
  rsync -a --ignore-existing "$UPLOAD_DIR/" "$BACKUP_REMOTE/uploads/"
  echo "Off-site kopie: $BACKUP_REMOTE"
else
  echo "VAROVÁNÍ: BACKUP_REMOTE není nastaven – záloha je jen na disku VPS a uploady se nezálohují." >&2
fi
