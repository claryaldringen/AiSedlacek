#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/AiSedlacek"
SCHEMA="packages/db/prisma/schema.prisma"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/aisedlacek}"
cd "$APP_DIR"

# Rollback: DEPLOY_REF=<commit> ./deploy.sh nasadí konkrétní commit (detached).
# Bez DEPLOY_REF se nasazuje aktuální main.
DEPLOY_REF="${DEPLOY_REF:-}"
echo "=== Updating code ==="
if [ -n "$DEPLOY_REF" ]; then
  git fetch origin
  git checkout --detach "$DEPLOY_REF"
else
  git checkout main
  git pull --ff-only origin main
fi

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

echo "=== Backing up database ==="
# Každé OCR stálo peníze za API – před migrací vždy záloha (CLAUDE.md: data se
# nesmí ztratit). Prisma URL může mít ?schema=…, kterému pg_dump nerozumí.
DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
pg_dump --format=custom --file="$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).dump" "${DATABASE_URL%%\?*}"
# Ponechat 10 nejnovějších pre-deploy dumpů – disk serveru je sdílený a plný
# disk shodí Postgres (denní zálohy rotuje ops/backup/aisedlacek-backup.sh).
ls -1t "$BACKUP_DIR"/pre-deploy-*.dump 2>/dev/null | tail -n +11 | xargs -r rm --

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
