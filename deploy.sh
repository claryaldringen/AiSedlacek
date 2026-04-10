#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/AiSedlacek"
cd "$APP_DIR"

echo "=== Pulling latest code ==="
git pull origin main

echo "=== Installing dependencies ==="
npm install

echo "=== Generating Prisma client ==="
npx prisma generate --schema=packages/db/prisma/schema.prisma

echo "=== Running database migrations ==="
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma

echo "=== Building web app ==="
npx turbo build --filter=@ai-sedlacek/web

echo "=== Copying static assets to standalone ==="
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/public apps/web/.next/standalone/apps/web/public 2>/dev/null || true

echo "=== Restarting PM2 processes ==="
pm2 restart ecosystem.config.cjs

echo "=== Done ==="
pm2 status
