#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/AiSedlacek"
SCHEMA="packages/db/prisma/schema.prisma"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/aisedlacek}"
cd "$APP_DIR"

echo "=== Pulling latest code ==="
git pull origin main

echo "=== Installing dependencies ==="
# npm ci zajišťuje reprodukovatelné buildy z package-lock.json (supply-chain bezpečnost)
npm ci

echo "=== Generating Prisma client ==="
npx prisma generate --schema="$SCHEMA"

# Build před migrací: když build selže, databáze zůstane netknutá a dál běží
# stará verze (dřív se migrovalo první a při chybě buildu běžel starý kód nad
# novým schématem).
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

echo "=== Running database migrations ==="
# Migrace leží vedle schématu v packages/db/prisma/migrations. (Do 2026-10 byly
# v apps/web/prisma/migrations a tento příkaz žádné nenašel – neaplikoval nic.)
npx prisma migrate deploy --schema="$SCHEMA"

echo "=== Restarting PM2 processes ==="
pm2 restart ecosystem.config.cjs

echo "=== Done ==="
pm2 status
