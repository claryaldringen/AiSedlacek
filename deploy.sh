#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/AiSedlacek"
SCHEMA="packages/db/prisma/schema.prisma"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/aisedlacek}"
cd "$APP_DIR"

# Rollback: DEPLOY_REF=<commit> ./deploy.sh nasadí konkrétní commit (detached).
# Bez DEPLOY_REF se nasazuje aktuální main.
DEPLOY_REF="${DEPLOY_REF:-}"
# Poslední úspěšně nasazený commit (zapisuje se po pm2 restart). Kontrola migrací
# podle něj pozná, které migrace přináší až tento deploy – i když předchozí běh
# spadl v půlce a HEAD už je posunutý.
DEPLOYED_HEAD_FILE="$(git rev-parse --git-path ais-deployed-head)"
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  self_before="$(sha256sum deploy.sh)"
  if [ -z "${PREV_HEAD:-}" ]; then
    PREV_HEAD="$(cat "$DEPLOYED_HEAD_FILE" 2>/dev/null || git rev-parse HEAD)"
  fi
  echo "=== Updating code ==="
  if [ -n "$DEPLOY_REF" ]; then
    git fetch origin
    # Relativní ref (HEAD~1) přeložit hned – po checkoutu by znamenal jiný commit.
    DEPLOY_REF="$(git rev-parse --verify "${DEPLOY_REF}^{commit}")"
    git checkout --detach "$DEPLOY_REF"
  else
    git checkout main
    git pull --ff-only origin main
  fi
  # Bash čte skript průběžně ze starého souboru (git ho nahradí novým), takže
  # změny deploy.sh by se jinak projevily až při dalším deployi. Starší verze
  # (rollback přes DEPLOY_REF) re-exec neznají a udělaly by znovu pull mainu –
  # v tom případě dokončí deploy tento skript.
  if [ "$(sha256sum deploy.sh)" != "$self_before" ]; then
    if grep -q 'DEPLOY_REEXEC' deploy.sh; then
      echo "=== deploy.sh changed – continuing with the new version ==="
      exec env DEPLOY_REEXEC=1 DEPLOY_REF="$DEPLOY_REF" PREV_HEAD="$PREV_HEAD" \
        bash "$APP_DIR/deploy.sh" "$@"
    fi
    echo "=== target deploy.sh is older – continuing with the current one ==="
    echo "POZOR: na disku teď zůstává starší deploy.sh (bez kontroly migrací a zálohy)." >&2
    echo "Další deploy i opakovaný rollback spouštěj z kopie aktuálního skriptu:" >&2
    echo "  git show origin/main:deploy.sh > /root/deploy-current.sh && bash /root/deploy-current.sh" >&2
  fi
fi
PREV_HEAD="${PREV_HEAD:-$(git rev-parse HEAD)}"

DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
# Prisma URL může mít ?schema=…, kterému psql/pg_dump nerozumí.
PG_URL="${DATABASE_URL%%\?*}"
DB_SCHEMA="$(sed -n 's/.*[?&]schema=\([^&]*\).*/\1/p' <<<"$DATABASE_URL")"
DB_SCHEMA="${DB_SCHEMA:-public}"

echo "=== Checking migration history ==="
# Pojistka ještě před npm ci a buildem (ty přepisují běžící aplikaci): historie
# migrací v DB musí navazovat na packages/db/prisma/migrations. Do 2026-10 se
# migrace na Hetzneru neaplikovaly (ležely jinde) a stav _prisma_migrations na
# produkci nebyl ověřený – migrate deploy by pak spadl uprostřed deploye (P3005,
# „already exists"), nebo znovu spustil starou datovou migraci.
# Jednorázový baseline: docs/deployment.md – Kontrola historie migrací.
# -X: bez ~/.psqlrc (např. \timing by změnil výstup a kontrolu tiše přeskočil).
psql_q() { psql -X "$PG_URL" -v ON_ERROR_STOP=1 -tAc "$1"; }
db_has_tables="$(psql_q "SELECT to_regclass('\"$DB_SCHEMA\".\"User\"') IS NOT NULL")"
case "$db_has_tables" in
  t | f) ;;
  *)
    echo "CHYBA: nečekaná odpověď DB při kontrole migrací: $db_has_tables" >&2
    exit 1
    ;;
esac
if [ "$db_has_tables" = "t" ]; then
  if [ "$(psql_q "SELECT to_regclass('\"$DB_SCHEMA\"._prisma_migrations') IS NOT NULL")" != "t" ]; then
    echo "CHYBA: DB má tabulky, ale chybí _prisma_migrations – nejdřív baseline (docs/deployment.md – Kontrola historie migrací)." >&2
    exit 1
  fi
  failed="$(psql_q "SELECT migration_name FROM \"$DB_SCHEMA\"._prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL")"
  if [ -n "$failed" ]; then
    echo "CHYBA: nedokončené migrace v DB: ${failed} – vyřešit ručně (prisma migrate resolve)." >&2
    exit 1
  fi
  applied="$(psql_q "SELECT migration_name FROM \"$DB_SCHEMA\"._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name")"
  if [ -z "$applied" ]; then
    echo "CHYBA: historie migrací je prázdná, ale DB má tabulky – nejdřív baseline (docs/deployment.md – Kontrola historie migrací)." >&2
    exit 1
  fi
  last_applied="$(tail -n1 <<<"$applied")"
  gaps=""
  for dir in packages/db/prisma/migrations/*/; do
    [ -d "$dir" ] || continue # starší commit (rollback) adresář nemá
    name="$(basename "$dir")"
    grep -qxF "$name" <<<"$applied" && continue
    # Migraci, kterou přináší až tento deploy, aplikuje migrate deploy – i když má
    # starší timestamp (vznikla na jiné větvi). Díra = migrace, která v repu byla
    # už v nasazeném commitu, a přesto v historii DB chybí, i když novější
    # migrace prošly: schéma se měnilo mimo migrace.
    git cat-file -e "$PREV_HEAD:packages/db/prisma/migrations/$name/migration.sql" 2>/dev/null ||
      continue
    [[ "$name" < "$last_applied" ]] && gaps+="$name "
  done
  if [ -n "$gaps" ]; then
    echo "CHYBA: v historii DB chybí starší migrace: ${gaps}– ověřit, že jejich objekty v DB existují, a teprve pak označit (docs/deployment.md – Kontrola historie migrací)." >&2
    exit 1
  fi
fi

echo "=== Backing up database ==="
# Každé OCR stálo peníze za API – před migrací vždy záloha (CLAUDE.md: data se
# nesmí ztratit). Dump běží před npm ci a buildem: když selže (plný disk), běžící
# aplikace zůstane netknutá. Zápisy během buildu v dumpu nejsou – při obnově
# z pre-deploy dumpu se ztratí jen ty.
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
pg_dump --format=custom --file="$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).dump" "$PG_URL"
# Ponechat 10 nejnovějších pre-deploy dumpů – disk serveru je sdílený a plný
# disk shodí Postgres (denní zálohy rotuje ops/backup/aisedlacek-backup.sh).
ls -1t "$BACKUP_DIR"/pre-deploy-*.dump 2>/dev/null | tail -n +11 | xargs -r rm --

echo "=== Installing dependencies ==="
# npm ci zajišťuje reprodukovatelné buildy z package-lock.json (supply-chain bezpečnost)
npm ci

echo "=== Generating Prisma client ==="
npx prisma generate --schema="$SCHEMA"

# Build před migrací: když build selže, databáze zůstane netknutá. Běžící
# aplikace ale může být rozbitá (npm ci už přepsal node_modules a build
# přepisuje .next/standalone) – rollback: DEPLOY_REF=<předchozí commit> ./deploy.sh.
# Pokud už proběhla migrace, starý kód poběží proti novému schématu – pak je
# skutečný rollback obnova pre-deploy dumpu (pg_restore).
echo "=== Building web app ==="
npx turbo build --filter=@ai-sedlacek/web

echo "=== Copying static assets to standalone ==="
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/public apps/web/.next/standalone/apps/web/public 2>/dev/null || true
cp -r apps/web/.next/standalone/node_modules apps/web/.next/standalone/apps/web/node_modules 2>/dev/null || true

echo "=== Running database migrations ==="
# Migrace leží vedle schématu v packages/db/prisma/migrations. (Do 2026-10 byly
# v apps/web/prisma/migrations a tento příkaz žádné nenašel – neaplikoval nic.)
npx prisma migrate deploy --schema="$SCHEMA"

echo "=== Restarting PM2 processes ==="
# --update-env: bez něj PM2 při restartu ponechá staré proměnné z env bloků
# ecosystem.config.cjs (např. NODE_ENV workeru).
pm2 restart ecosystem.config.cjs --update-env
git rev-parse HEAD >"$DEPLOYED_HEAD_FILE"

echo "=== Done ==="
pm2 status
