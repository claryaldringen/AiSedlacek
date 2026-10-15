#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/AiSedlacek"
SCHEMA="packages/db/prisma/schema.prisma"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/aisedlacek}"
cd "$APP_DIR"

# Rollback: DEPLOY_REF=<commit> ./deploy.sh nasadí konkrétní commit (detached).
# Bez DEPLOY_REF se nasazuje aktuální main.
DEPLOY_REF="${DEPLOY_REF:-}"
if [ -z "${DEPLOY_REEXEC:-}" ]; then
  self_before="$(sha256sum deploy.sh)"
  echo "=== Updating code ==="
  if [ -n "$DEPLOY_REF" ]; then
    git fetch origin
    git checkout --detach "$DEPLOY_REF"
  else
    git checkout main
    git pull --ff-only origin main
  fi
  # Bash čte skript průběžně ze starého souboru (git ho nahradí novým), takže
  # změny deploy.sh by se jinak projevily až při dalším deployi.
  if [ "$(sha256sum deploy.sh)" != "$self_before" ]; then
    echo "=== deploy.sh changed – continuing with the new version ==="
    exec env DEPLOY_REEXEC=1 bash "$APP_DIR/deploy.sh" "$@"
  fi
fi

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
psql_q() { psql "$PG_URL" -v ON_ERROR_STOP=1 -tAc "$1"; }
if [ "$(psql_q "SELECT to_regclass('\"$DB_SCHEMA\".\"User\"') IS NOT NULL")" = "t" ]; then
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
    name="$(basename "$dir")"
    grep -qxF "$name" <<<"$applied" && continue
    # Chybějící migrace starší než poslední aplikovaná = schéma se měnilo mimo
    # migrace; migrate deploy by ji pustil nad hotovými tabulkami.
    [[ "$name" < "$last_applied" ]] && gaps+="$name "
  done
  if [ -n "$gaps" ]; then
    echo "CHYBA: v historii DB chybí starší migrace: ${gaps}– ověřit a označit (docs/deployment.md – Kontrola historie migrací)." >&2
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

echo "=== Done ==="
pm2 status
