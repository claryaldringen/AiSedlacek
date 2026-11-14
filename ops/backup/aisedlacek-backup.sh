#!/usr/bin/env bash
# Denní záloha AiSedlacek: Postgres dump + (volitelně) off-site kopie dumpů a uploadů.
#
# Instalace na serveru (jednorázově, jako root):
#   install -m 700 ops/backup/aisedlacek-backup.sh /usr/local/bin/aisedlacek-backup
#   cp ops/backup/aisedlacek-backup.{service,timer} /etc/systemd/system/
#   systemctl daemon-reload && systemctl enable --now aisedlacek-backup.timer
#
# Off-site kopie (doporučeno – lokální dump nepřežije ztrátu disku VPS): nastavte
# BACKUP_REMOTE v /etc/default/aisedlacek-backup, buď cíl pro rsync přes SSH
#   BACKUP_REMOTE=u123456@u123456.your-storagebox.de:aisedlacek
# (Hetzner Storage Box přes SSH klíč), nebo remote rclone s prefixem `rclone:`
#   BACKUP_REMOTE=rclone:r2crypt:
#   RCLONE_CONFIG=/etc/aisedlacek-backup/rclone.conf
# (produkce od 2026-11: šifrovaný remote nad Cloudflare R2, viz docs/deployment.md).
# Bez BACKUP_REMOTE se zálohuje jen lokálně.
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

# Nástroje Postgresu ve verzi SERVERU (major ze server_version_num). pg_wrapper na
# Debianu/Ubuntu vybírá verzi podle cíle: pg_dump přes TCP nejnovějšího klienta (17),
# pg_restore ze souboru verzi lokálního clusteru (16), která dump verze 17 nepřečte
# („unsupported version (1.16) in file header"); pg_restore 17 zase do serveru 16
# obnovuje s chybou (`SET transaction_timeout`). Ve verzi serveru dump přečte
# i výchozí `pg_restore` a obnova projde čistě. Chybí-li nástroje verze serveru,
# vezme se nejnovější nainstalovaná verze; mimo Debian (bez /usr/lib/postgresql) PATH.
pg_bin_for_server() { # $1 = server_version_num (např. 160015)
  local major="" dir=""
  if [[ "$1" =~ ^[0-9]{5,}$ ]]; then major=$(($1 / 10000)); fi
  if [ -n "$major" ] && [ -x "/usr/lib/postgresql/$major/bin/pg_dump" ] &&
    [ -x "/usr/lib/postgresql/$major/bin/pg_restore" ]; then
    printf '%s/' "/usr/lib/postgresql/$major/bin"
    return 0
  fi
  if dir="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n1)" && [ -n "$dir" ]; then
    printf '%s/' "$dir"
  fi
}
pg_server_num="$(env -u PGPASSWORD "${pg_env[@]}" psql -X -tAc 'SHOW server_version_num' 2>/dev/null || true)"
PG_BIN="$(pg_bin_for_server "$pg_server_num")"
echo "Nástroje Postgresu: ${PG_BIN:-PATH} (server ${pg_server_num:-neznámý})"

# Ověření dumpu plným přečtením: pg_restore --list čte jen obsah (TOC) na
# začátku souboru, poškozená nebo useknutá data za ním by prošla. Výstup do
# /dev/null projde celý soubor včetně dat všech tabulek (bez připojení k DB).
# Chybový výstup pg_restore jde do journalu (důvod selhání), jen stdout se zahazuje.
# Dump z novější verze pg_dump (např. pre-deploy dumpy z 2026-11-14 ve formátu 17)
# nástroje verze serveru nepřečtou – pak zkusit nejnovější nainstalovaný pg_restore.
PG_LATEST=""
if pg_latest="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n1)" && [ -n "$pg_latest" ]; then
  PG_LATEST="$pg_latest/"
fi
verify_dump() {
  "${PG_BIN}pg_restore" --file=/dev/null "$1" >/dev/null && return 0
  [ -n "$PG_LATEST" ] && [ "$PG_LATEST" != "$PG_BIN" ] &&
    "${PG_LATEST}pg_restore" --file=/dev/null "$1" >/dev/null
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

# Osiřelé rozepsané uploady (`<uuid>.<přípona>.partial` – web/worker spadl
# uprostřed atomického zápisu) uklidit; mladší než hodina se můžou právě zapisovat.
if [ -d "$UPLOAD_DIR" ]; then
  # Jen tvar z atomického zápisu (`<uuid>.<přípona>.partial`) – starší uploady se
  # jménem od klienta (`<uuid>-<jméno>`) mohou končit na .partial legitimně.
  find "$UPLOAD_DIR" -maxdepth 1 -type f -regextype posix-extended \
    -regex '.*/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]+\.partial' \
    -mmin +60 -delete
fi

# Rotace lokálních dumpů (pre-deploy dumpy z deploy.sh včetně) a starých
# rozepsaných dumpů, které po sobě nechal přerušený deploy.
find "$BACKUP_DIR" \( -name '*.dump' -o -name '*.dump.partial' \) -mtime +"$RETENTION_DAYS" -delete

if [ -n "$BACKUP_REMOTE" ]; then
  # Jen doplnit nové soubory: bez mazání (lokální rotace ani smazání se na cíl
  # nepropíše) a s --ignore-existing (už odeslaný dump ani upload se nepřepíše
  # lokálně poškozenou verzí). Názvy dumpů i uploadů jsou unikátní a soubory se
  # po zápisu nemění; rozepsané uploady (`*.partial`, atomický zápis) se vynechávají.
  if [[ "$BACKUP_REMOTE" == rclone:* ]]; then
    remote="${BACKUP_REMOTE#rclone:}"
    # Remote musí být `<jméno>:[cesta]` z konfigurace rclone – překlep (bez
    # dvojtečky) by rclone vzal jako lokální cestu a „off-site" kopie by skončila
    # na disku sdíleného VPS.
    if ! command -v rclone >/dev/null; then
      echo "CHYBA: BACKUP_REMOTE=$BACKUP_REMOTE, ale rclone není nainstalovaný" >&2
      exit 1
    fi
    if ! [[ "$remote" =~ ^[A-Za-z0-9_.-]+: ]] || ! rclone listremotes | grep -qxF "${remote%%:*}:"; then
      echo "CHYBA: BACKUP_REMOTE=$BACKUP_REMOTE – remote '${remote%%:*}:' v konfiguraci rclone (RCLONE_CONFIG=${RCLONE_CONFIG:-výchozí}) není" >&2
      exit 1
    fi
    if [[ "$remote" == *: ]]; then remote_base="$remote"; else remote_base="${remote%/}/"; fi
  fi
  # $1 = zdrojový adresář, $2 = podadresář cíle, $3 = seznam souborů (volitelně).
  ship_dir() {
    local files=()
    if [[ "$BACKUP_REMOTE" == rclone:* ]]; then
      # rclone nedovolí --files-from spolu s dalšími filtry; seznam stejně obsahuje
      # jen ověřené *.dump, takže vyloučení *.partial stačí bez něj (uploady).
      if [ -n "${3:-}" ]; then files=(--files-from "$3"); else files=(--exclude '*.partial'); fi
      rclone copy --ignore-existing "${files[@]}" "$1" "$remote_base$2"
    else
      if [ -n "${3:-}" ]; then files=(--files-from="$3"); fi
      rsync -a --timeout=600 --ignore-existing --exclude='*.partial' ${files[@]+"${files[@]}"} "$1/" "$BACKUP_REMOTE/$2/"
    fi
  }

  # Které dumpy cíl už má: u rclone přímo z cíle (jeden List, názvy dešifrované) –
  # platí i po změně bucketu, hesel nebo ručním smazání v cíli. U rsync z lokálního
  # seznamu vázaného na cíl (.offsite-sent.<hash cíle>).
  sent_list="$BACKUP_DIR/.offsite-sent.$(printf '%s' "$BACKUP_REMOTE" | sha256sum | cut -c1-12)"
  remote_has="$work_dir/remote.list"
  if [[ "$BACKUP_REMOTE" == rclone:* ]]; then
    # Prázdný cíl jen u „directory not found" (exit 3, první běh); jiná chyba
    # (token, IP filtr, síť) skončí hned s hláškou – ne zbytečným ověřováním všeho.
    lsf_rc=0
    rclone lsf --files-only "${remote_base}db" >"$remote_has" || lsf_rc=$?
    if [ "$lsf_rc" -eq 3 ]; then
      : >"$remote_has"
    elif [ "$lsf_rc" -ne 0 ]; then
      echo "CHYBA: výpis off-site cíle ${remote_base}db selhal (rclone exit $lsf_rc)" >&2
      exit 1
    fi
  else
    touch "$sent_list"
    cp "$sent_list" "$remote_has"
  fi

  # Off-site jdou jen *.dump ověřené plným přečtením (i pre-deploy dumpy
  # z deploy.sh): poškozený soubor by tam s --ignore-existing zůstal navždy.
  # Ověřují se jen dumpy, které cíl ještě nemá – ne každou noc všech ~24.
  ship_list="$work_dir/ship.list"
  : >"$ship_list"
  for f in "$BACKUP_DIR"/*.dump; do
    [ -e "$f" ] || continue
    name="$(basename "$f")"
    if grep -qxF "$name" "$remote_has"; then continue; fi
    if verify_dump "$f"; then
      printf '%s\n' "$name" >>"$ship_list"
    else
      echo "VAROVÁNÍ: $f není platný dump – off-site se neposílá" >&2
    fi
  done
  if [ -s "$ship_list" ]; then
    ship_dir "$BACKUP_DIR" db "$ship_list"
  fi
  if [[ "$BACKUP_REMOTE" != rclone:* ]]; then
    # Seznam odeslaných: doplnit nové, vypustit lokálně už smazané (rotované).
    cat "$ship_list" >>"$sent_list"
    while IFS= read -r name; do
      if [ -e "$BACKUP_DIR/$name" ]; then printf '%s\n' "$name"; fi
    done <"$sent_list" | sort -u >"$work_dir/sent.pruned"
    cat "$work_dir/sent.pruned" >"$sent_list"
  fi
  # Uploady jsou originály skenů (<uuid>.<přípona>, nikdy se nepřepisují).
  ship_dir "$UPLOAD_DIR" uploads
  echo "Off-site kopie: $BACKUP_REMOTE ($(wc -l <"$ship_list" | tr -d ' ') nových dumpů)"
else
  echo "VAROVÁNÍ: BACKUP_REMOTE není nastaven – záloha je jen na disku VPS a uploady se nezálohují." >&2
fi

# Volitelný heartbeat (např. push monitor Uptime Kuma) – jen po úspěšném běhu;
# když ping nepřijde, monitor upozorní, že záloha neproběhla nebo selhala.
if [ -n "${BACKUP_HEARTBEAT_URL:-}" ]; then
  # URL (nese token monitoru) přes stdin, ne v argumentech – jinak ji vidí `ps`.
  printf 'url = "%s"\n' "$BACKUP_HEARTBEAT_URL" | curl -fsS --max-time 30 -o /dev/null -K - ||
    echo "VAROVÁNÍ: heartbeat zálohy se nepodařilo odeslat" >&2
fi
