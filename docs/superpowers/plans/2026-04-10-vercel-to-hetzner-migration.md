# Vercel → Hetzner VPS Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the entire AiSedlacek application (web, worker, DB, storage) from Vercel/Neon/R2 to a self-hosted Hetzner VPS with local PostgreSQL and filesystem storage.

**Architecture:** Next.js standalone build served via PM2 behind Caddy reverse proxy. Worker runs as a second PM2 process from the same repo. PostgreSQL 16 and image storage are local on the VPS. Caddy handles TLS (Let's Encrypt) and serves uploaded images as static files.

**Tech Stack:** Next.js 15 (standalone), PM2, Caddy 2.11, PostgreSQL 16, Ubuntu 24.04

**Server:** `204.168.176.128` (root SSH), existing services on ports 3000 and 3002, AiSedlacek web will use port 3003.

---

## File Structure

### Files to Create
| File | Responsibility |
|------|---------------|
| `ecosystem.config.cjs` | PM2 process definitions for web + worker |
| `deploy.sh` | Build & restart script for the VPS |

### Files to Modify
| File | Change |
|------|--------|
| `apps/web/next.config.ts` | Add `output: 'standalone'` |
| `apps/web/lib/adapters/storage/index.ts` | Remove R2 branch, always return LocalStorageProvider |
| `apps/web/lib/adapters/storage/local-storage.ts` | Read `UPLOAD_DIR` from env, return `/uploads/` URLs |
| `apps/worker/src/lib/storage.ts` | Remove R2 branch, always return LocalStorageProvider |
| `apps/worker/src/lib/local-storage.ts` | Read `UPLOAD_DIR` from env |
| `apps/web/app/api/images/[...path]/route.ts` | Remove `isRemoteStorage()` check |
| `apps/web/app/api/documents/[id]/chat/route.ts` | Remove `maxDuration` export |
| `apps/web/app/api/documents/[id]/retranslate/route.ts` | Remove `maxDuration` export |
| `apps/web/app/api/collections/[id]/generate-context/route.ts` | Remove `maxDuration` export |
| `apps/web/app/api/collections/[id]/fix-document-contexts/route.ts` | Remove `maxDuration` export |
| `apps/web/app/api/collections/[id]/translate-context/route.ts` | Remove `maxDuration` export |
| `apps/web/app/api/billing/webhook/route.ts` | Remove `runtime` export |
| `turbo.json` | Remove R2 env vars from `globalEnv` |
| `apps/web/.env.example` | Update for self-hosted setup |

### Files to Delete
| File | Reason |
|------|--------|
| `vercel.json` | Vercel-specific config |
| `apps/web/lib/adapters/storage/r2-storage.ts` | R2 no longer used |
| `apps/worker/src/lib/r2-storage.ts` | R2 no longer used |

### Packages to Remove
| Package | From |
|---------|------|
| `@aws-sdk/client-s3` | `apps/web/package.json`, `apps/worker/package.json` |

---

## Task 1: Next.js standalone output

**Files:**
- Modify: `apps/web/next.config.ts:15-22`

- [ ] **Step 1: Add `output: 'standalone'` to Next.js config**

In `apps/web/next.config.ts`, add the `output` property:

```typescript
const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@ai-sedlacek/shared', '@ai-sedlacek/ocr'],
  serverExternalPackages: ['sharp', 'tesseract.js'],
  env: {
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_BUILD_HASH: gitHash,
  },
};
```

- [ ] **Step 2: Verify build works**

Run: `npx turbo build --filter=@ai-sedlacek/web`

Expected: Build succeeds, `.next/standalone/` directory is created inside `apps/web/`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/next.config.ts
git commit -m "feat: přepnout Next.js na standalone output pro self-hosting"
```

---

## Task 2: Remove R2 storage provider from web

**Files:**
- Delete: `apps/web/lib/adapters/storage/r2-storage.ts`
- Modify: `apps/web/lib/adapters/storage/index.ts`
- Modify: `apps/web/lib/adapters/storage/local-storage.ts`
- Modify: `apps/web/app/api/images/[...path]/route.ts`

- [ ] **Step 1: Update LocalStorageProvider to use UPLOAD_DIR env var and return `/uploads/` URLs**

In `apps/web/lib/adapters/storage/local-storage.ts`, change the constructor default and URL pattern:

```typescript
import type { IStorageProvider, StorageResult } from '@ai-sedlacek/shared';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export class LocalStorageProvider implements IStorageProvider {
  private readonly uploadDir: string;

  constructor(uploadDir?: string) {
    this.uploadDir = uploadDir ?? process.env['UPLOAD_DIR'] ?? 'tmp/uploads';
  }

  async upload(file: Buffer, filename: string): Promise<StorageResult> {
    await fs.mkdir(this.uploadDir, { recursive: true });
    const safeName = filename.replace(/[/\\]/g, '_');
    const uniqueName = `${crypto.randomUUID()}-${safeName}`;
    const filePath = path.join(this.uploadDir, uniqueName);
    await fs.writeFile(filePath, file);
    return { url: `/uploads/${uniqueName}`, path: uniqueName };
  }

  async read(filePath: string): Promise<Buffer> {
    return fs.readFile(path.join(this.uploadDir, filePath));
  }

  getUrl(filePath: string): string {
    return `/uploads/${filePath}`;
  }

  async delete(filePath: string): Promise<void> {
    await fs.unlink(path.join(this.uploadDir, filePath));
  }
}
```

Key changes:
- Constructor reads `UPLOAD_DIR` env var (falls back to `tmp/uploads` for dev)
- URLs now return `/uploads/<filename>` instead of `/api/images/<filename>` — Caddy will serve these as static files

- [ ] **Step 2: Simplify storage factory — remove R2 branch and `isRemoteStorage`**

Replace `apps/web/lib/adapters/storage/index.ts` with:

```typescript
import type { IStorageProvider } from '@ai-sedlacek/shared';
import { LocalStorageProvider } from './local-storage';

let cached: IStorageProvider | null = null;

export function getStorage(): IStorageProvider {
  if (cached) return cached;
  cached = new LocalStorageProvider();
  return cached;
}
```

- [ ] **Step 3: Update image serving route — remove `isRemoteStorage` check**

Replace `apps/web/app/api/images/[...path]/route.ts` with:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getStorage } from '@/lib/adapters/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const segments = (await params).path;
  const filePath = segments.join('/');

  try {
    const storage = getStorage();
    const buffer = await storage.read(filePath);

    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : 'application/octet-stream';

    return new NextResponse(new Uint8Array(buffer), {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' },
    });
  } catch {
    return NextResponse.json({ error: 'Soubor nenalezen' }, { status: 404 });
  }
}
```

- [ ] **Step 4: Delete R2 storage provider**

Delete `apps/web/lib/adapters/storage/r2-storage.ts`.

- [ ] **Step 5: Remove `@aws-sdk/client-s3` from web**

Run: `cd apps/web && npm uninstall @aws-sdk/client-s3`

- [ ] **Step 6: Verify no broken imports**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add -A apps/web/lib/adapters/storage/ apps/web/app/api/images/ apps/web/package.json package-lock.json
git commit -m "refactor: odstranit R2 storage provider z webu, použít lokální filesystem"
```

---

## Task 3: Remove R2 storage provider from worker

**Files:**
- Delete: `apps/worker/src/lib/r2-storage.ts`
- Modify: `apps/worker/src/lib/storage.ts`
- Modify: `apps/worker/src/lib/local-storage.ts`

- [ ] **Step 1: Update worker's LocalStorageProvider — same changes as web**

In `apps/worker/src/lib/local-storage.ts`:

```typescript
import type { IStorageProvider, StorageResult } from '@ai-sedlacek/shared';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export class LocalStorageProvider implements IStorageProvider {
  private readonly uploadDir: string;

  constructor(uploadDir?: string) {
    this.uploadDir = uploadDir ?? process.env['UPLOAD_DIR'] ?? 'tmp/uploads';
  }

  async upload(file: Buffer, filename: string): Promise<StorageResult> {
    await fs.mkdir(this.uploadDir, { recursive: true });
    const safeName = filename.replace(/[/\\]/g, '_');
    const uniqueName = `${crypto.randomUUID()}-${safeName}`;
    const filePath = path.join(this.uploadDir, uniqueName);
    await fs.writeFile(filePath, file);
    return { url: `/uploads/${uniqueName}`, path: uniqueName };
  }

  async read(filePath: string): Promise<Buffer> {
    return fs.readFile(path.join(this.uploadDir, filePath));
  }

  getUrl(filePath: string): string {
    return `/uploads/${filePath}`;
  }

  async delete(filePath: string): Promise<void> {
    await fs.unlink(path.join(this.uploadDir, filePath));
  }
}
```

- [ ] **Step 2: Simplify worker storage factory**

Replace `apps/worker/src/lib/storage.ts` with:

```typescript
import type { IStorageProvider } from '@ai-sedlacek/shared';
import { LocalStorageProvider } from './local-storage';

let cached: IStorageProvider | null = null;

export function getStorage(): IStorageProvider {
  if (cached) return cached;
  cached = new LocalStorageProvider();
  return cached;
}
```

- [ ] **Step 3: Delete R2 storage provider and remove S3 dependency**

Delete `apps/worker/src/lib/r2-storage.ts`.

Run: `cd apps/worker && npm uninstall @aws-sdk/client-s3`

- [ ] **Step 4: Update `loadImageAndHash` — handle both old `/api/images/` and new `/uploads/` prefixes**

In `apps/worker/src/lib/processing-helpers.ts`, update the path extraction (around line 190):

```typescript
export async function loadImageAndHash(
  imageUrl: string,
): Promise<{ imageBuffer: Buffer; imageHash: string }> {
  const storage = getStorage();
  let storagePath = imageUrl;
  if (storagePath.startsWith('/api/images/')) {
    storagePath = storagePath.replace('/api/images/', '');
  } else if (storagePath.startsWith('/uploads/')) {
    storagePath = storagePath.replace('/uploads/', '');
  }
  const imageBuffer = await storage.read(storagePath);
  const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
  return { imageBuffer, imageHash };
}
```

This handles both old URLs (from migrated DB data) and new URLs.

- [ ] **Step 5: Verify typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/worker`

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add -A apps/worker/src/lib/ apps/worker/package.json package-lock.json
git commit -m "refactor: odstranit R2 storage provider z workeru, použít lokální filesystem"
```

---

## Task 4: Remove Vercel-specific config and exports

**Files:**
- Delete: `vercel.json`
- Modify: `apps/web/app/api/documents/[id]/chat/route.ts:3`
- Modify: `apps/web/app/api/documents/[id]/retranslate/route.ts:3`
- Modify: `apps/web/app/api/collections/[id]/generate-context/route.ts:7`
- Modify: `apps/web/app/api/collections/[id]/fix-document-contexts/route.ts:7`
- Modify: `apps/web/app/api/collections/[id]/translate-context/route.ts:6`
- Modify: `apps/web/app/api/billing/webhook/route.ts:5`
- Modify: `turbo.json:13-19`
- Modify: `apps/web/.env.example`

- [ ] **Step 1: Delete vercel.json**

Delete `vercel.json` from project root.

- [ ] **Step 2: Remove `maxDuration` exports from all API routes**

In each file, delete the `export const maxDuration = ...;` line:

- `apps/web/app/api/documents/[id]/chat/route.ts` — line 3: `export const maxDuration = 120;`
- `apps/web/app/api/documents/[id]/retranslate/route.ts` — line 3: `export const maxDuration = 10;`
- `apps/web/app/api/collections/[id]/generate-context/route.ts` — line 7: `export const maxDuration = 10;`
- `apps/web/app/api/collections/[id]/fix-document-contexts/route.ts` — line 7: `export const maxDuration = 10;`
- `apps/web/app/api/collections/[id]/translate-context/route.ts` — line 6: `export const maxDuration = 10;`

- [ ] **Step 3: Remove `runtime` export from billing webhook**

In `apps/web/app/api/billing/webhook/route.ts`, delete line 5: `export const runtime = 'nodejs';`

- [ ] **Step 4: Remove R2 env vars from turbo.json**

In `turbo.json`, remove these entries from `globalEnv`:
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_URL`

Add `UPLOAD_DIR` to `globalEnv`.

Resulting `globalEnv`:
```json
"globalEnv": [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "AUTH_SECRET",
  "NEXTAUTH_URL",
  "LLM_PROVIDER",
  "MAX_FILE_SIZE_MB",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "FIO_API_TOKEN",
  "TOKEN_MULTIPLIER",
  "TOKEN_PRICE_PER_MILLION",
  "UPLOAD_DIR"
]
```

- [ ] **Step 5: Update .env.example**

Replace `apps/web/.env.example` with:

```env
# === Databáze (povinné) ===
DATABASE_URL=postgresql://aisedlacek:password@localhost:5432/aisedlacek

# === Claude API (povinné pro produkci) ===
# ANTHROPIC_API_KEY=

# === Úložiště obrázků ===
# Výchozí: tmp/uploads (pro lokální vývoj)
# Produkce: /opt/AiSedlacek/uploads
# UPLOAD_DIR=/opt/AiSedlacek/uploads

# === Auth ===
# AUTH_SECRET=
# NEXTAUTH_URL=https://aisedlacek.com

# === Stripe (volitelné) ===
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=

# === FIO banka (volitelné) ===
# FIO_API_TOKEN=

# === Obecné ===
MAX_FILE_SIZE_MB=20
```

- [ ] **Step 6: Verify typecheck and lint**

Run: `npx turbo typecheck && npx turbo lint`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add vercel.json turbo.json apps/web/.env.example apps/web/app/api/
git commit -m "refactor: odstranit Vercel-specifickou konfiguraci a R2 env proměnné"
```

---

## Task 5: PM2 ecosystem config

**Files:**
- Create: `ecosystem.config.cjs`

- [ ] **Step 1: Create `ecosystem.config.cjs` in project root**

```javascript
module.exports = {
  apps: [
    {
      name: 'ai-sedlacek-web',
      cwd: '/opt/AiSedlacek',
      script: 'apps/web/.next/standalone/server.js',
      env: {
        PORT: 3003,
        HOSTNAME: '0.0.0.0',
      },
      node_args: '--env-file=/opt/AiSedlacek/.env',
      max_memory_restart: '500M',
    },
    {
      name: 'ai-sedlacek-worker',
      cwd: '/opt/AiSedlacek',
      script: 'apps/worker/src/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx/esm --env-file=/opt/AiSedlacek/.env',
      max_memory_restart: '500M',
    },
  ],
};
```

- [ ] **Step 2: Commit**

```bash
git add ecosystem.config.cjs
git commit -m "feat: přidat PM2 ecosystem config pro web + worker"
```

---

## Task 6: Deploy script

**Files:**
- Create: `deploy.sh`

- [ ] **Step 1: Create `deploy.sh` in project root**

```bash
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
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x deploy.sh`

- [ ] **Step 3: Commit**

```bash
git add deploy.sh
git commit -m "feat: přidat deploy skript pro Hetzner VPS"
```

---

## Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md to reflect new architecture**

Key changes in CLAUDE.md:
- Replace "Backend: Next.js API Routes (serverless na Vercelu)" → "Backend: Next.js API Routes (standalone na Hetzner VPS)"
- Replace "Úložiště souborů: Lokální filesystem (`tmp/uploads/`) – plánovaná migrace na Vercel Blob" → "Úložiště souborů: Lokální filesystem (`/opt/AiSedlacek/uploads/` v produkci, `tmp/uploads/` v dev)"
- Replace storage provider info — remove R2/Vercel Blob mentions
- Update deployment section: remove `vercel --prod`, add `ssh root@204.168.176.128 /opt/AiSedlacek/deploy.sh`
- Update env variables section — remove R2 vars, add `UPLOAD_DIR`
- Remove any references to "plánovaná migrace na Vercel Blob"
- Update validation command if needed

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: aktualizovat CLAUDE.md pro self-hosted Hetzner architekturu"
```

---

## Task 8: Setup PostgreSQL on VPS

This task is executed on the server via SSH.

- [ ] **Step 1: Create database user and database**

```bash
ssh root@204.168.176.128 "sudo -u postgres psql -c \"CREATE USER aisedlacek WITH PASSWORD 'GENERATE_SECURE_PASSWORD';\""
ssh root@204.168.176.128 "sudo -u postgres psql -c \"CREATE DATABASE aisedlacek OWNER aisedlacek;\""
```

- [ ] **Step 2: Update `.env` on server**

SSH into server and update `/opt/AiSedlacek/.env`:

```env
DATABASE_URL=postgresql://aisedlacek:PASSWORD@localhost:5432/aisedlacek
ANTHROPIC_API_KEY=sk-ant-...
AUTH_SECRET=...
NEXTAUTH_URL=https://aisedlacek.com
UPLOAD_DIR=/opt/AiSedlacek/uploads
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
FIO_API_TOKEN=...
TOKEN_MULTIPLIER=...
TOKEN_PRICE_PER_MILLION=...
```

Remove all R2 variables.

- [ ] **Step 3: Create uploads directory**

```bash
ssh root@204.168.176.128 "mkdir -p /opt/AiSedlacek/uploads"
```

---

## Task 9: Migrate data from Neon to local PostgreSQL

- [ ] **Step 1: Dump Neon database**

Get the Neon connection string from the current worker `.env`, then dump:

```bash
ssh root@204.168.176.128 "pg_dump 'postgresql://neondb_owner:...@ep-snowy-sea-agr3m4m1-pooler.c-2.eu-central-1.aws.neon.tech/neondb?sslmode=require' --no-owner --no-privileges > /tmp/neon_dump.sql"
```

- [ ] **Step 2: Restore into local PostgreSQL**

```bash
ssh root@204.168.176.128 "psql -U aisedlacek -d aisedlacek < /tmp/neon_dump.sql"
```

- [ ] **Step 3: Verify data**

```bash
ssh root@204.168.176.128 "psql -U aisedlacek -d aisedlacek -c 'SELECT count(*) FROM \"Page\";'"
```

Expected: Same count as on Neon.

---

## Task 10: Migrate images from R2 to local filesystem

- [ ] **Step 1: Install rclone on VPS (if not installed)**

```bash
ssh root@204.168.176.128 "which rclone || curl https://rclone.org/install.sh | bash"
```

- [ ] **Step 2: Configure rclone for R2**

```bash
ssh root@204.168.176.128 "cat > /root/.config/rclone/rclone.conf << 'EOF'
[r2]
type = s3
provider = Cloudflare
access_key_id = ACCESS_KEY_FROM_ENV
secret_access_key = SECRET_KEY_FROM_ENV
endpoint = https://ACCOUNT_ID.r2.cloudflarestorage.com
EOF"
```

Use the R2 credentials from the existing `/opt/AiSedlacek/.env`.

- [ ] **Step 3: Sync all images from R2 to local uploads**

```bash
ssh root@204.168.176.128 "rclone sync r2:ai-sedlacek /opt/AiSedlacek/uploads/ --progress"
```

- [ ] **Step 4: Update image URLs in database**

After images are on disk, update `imageUrl` and `thumbnailUrl` in the `Page` table. R2 URLs look like `https://pub-xxx.r2.dev/uuid-filename.jpg` — we need to extract the key (filename) and change to `/uploads/uuid-filename.jpg`:

```bash
ssh root@204.168.176.128 "psql -U aisedlacek -d aisedlacek << 'SQL'
-- Update imageUrl: extract filename from R2 URL or /api/images/ path
UPDATE \"Page\"
SET \"imageUrl\" = '/uploads/' || regexp_replace(\"imageUrl\", '^.*/([^/]+)$', '\1')
WHERE \"imageUrl\" NOT LIKE '/uploads/%';

-- Update thumbnailUrl similarly
UPDATE \"Page\"
SET \"thumbnailUrl\" = '/uploads/' || regexp_replace(\"thumbnailUrl\", '^.*/([^/]+)$', '\1')
WHERE \"thumbnailUrl\" IS NOT NULL AND \"thumbnailUrl\" NOT LIKE '/uploads/%';
SQL"
```

- [ ] **Step 5: Verify a sample image URL resolves to a file on disk**

```bash
ssh root@204.168.176.128 "psql -U aisedlacek -d aisedlacek -c \"SELECT \\\"imageUrl\\\" FROM \\\"Page\\\" LIMIT 3;\" && ls /opt/AiSedlacek/uploads/ | head -5"
```

---

## Task 11: Deploy application to VPS

- [ ] **Step 1: Push code changes to git**

```bash
git push origin main
```

- [ ] **Step 2: Pull and build on server**

```bash
ssh root@204.168.176.128 "cd /opt/AiSedlacek && git pull origin main"
ssh root@204.168.176.128 "cd /opt/AiSedlacek && npm install"
ssh root@204.168.176.128 "cd /opt/AiSedlacek && npx prisma generate --schema=packages/db/prisma/schema.prisma"
ssh root@204.168.176.128 "cd /opt/AiSedlacek && npx turbo build --filter=@ai-sedlacek/web"
ssh root@204.168.176.128 "cd /opt/AiSedlacek && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static"
ssh root@204.168.176.128 "cd /opt/AiSedlacek && cp -r apps/web/public apps/web/.next/standalone/apps/web/public 2>/dev/null || true"
```

- [ ] **Step 3: Stop old systemd worker**

```bash
ssh root@204.168.176.128 "systemctl stop ai-sedlacek-worker && systemctl disable ai-sedlacek-worker"
```

- [ ] **Step 4: Start PM2 processes**

```bash
ssh root@204.168.176.128 "cd /opt/AiSedlacek && pm2 start ecosystem.config.cjs && pm2 save"
```

- [ ] **Step 5: Verify both processes are running**

```bash
ssh root@204.168.176.128 "pm2 status"
```

Expected: `ai-sedlacek-web` and `ai-sedlacek-worker` both online.

- [ ] **Step 6: Test web app locally on server**

```bash
ssh root@204.168.176.128 "curl -s -o /dev/null -w '%{http_code}' http://localhost:3003"
```

Expected: `200` (or `302` if auth redirect).

---

## Task 12: Configure Caddy

- [ ] **Step 1: Add aisedlacek.com block to Caddyfile**

```bash
ssh root@204.168.176.128 "cat >> /etc/caddy/Caddyfile << 'EOF'

aisedlacek.com {
    handle /uploads/* {
        root * /opt/AiSedlacek
        file_server
        header Cache-Control \"public, max-age=31536000, immutable\"
    }

    handle {
        reverse_proxy localhost:3003
    }
}
EOF"
```

- [ ] **Step 2: Validate and reload Caddy**

```bash
ssh root@204.168.176.128 "caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy"
```

Expected: Config valid, Caddy reloaded.

---

## Task 13: DNS and final verification

- [ ] **Step 1: Set DNS on Cloudflare**

In Cloudflare dashboard for `aisedlacek.com`:
- A record: `@` → `204.168.176.128`, proxy OFF (grey cloud, so Caddy handles TLS)

Note: Caddy needs to be the TLS terminator — Cloudflare proxy must be off.

- [ ] **Step 2: Wait for DNS propagation and test**

```bash
dig aisedlacek.com +short
# Expected: 204.168.176.128

curl -I https://aisedlacek.com
# Expected: 200 OK with Caddy server header
```

- [ ] **Step 3: Test image serving**

Open a page with an uploaded image in the browser. The image URL should be `https://aisedlacek.com/uploads/uuid-filename.jpg` and served directly by Caddy.

- [ ] **Step 4: Test OCR processing**

Upload a test image and trigger processing. Verify:
- Upload stores file in `/opt/AiSedlacek/uploads/`
- Worker picks up the job and processes it
- Result is displayed with image visible

- [ ] **Step 5: Test worker health**

```bash
ssh root@204.168.176.128 "pm2 logs ai-sedlacek-worker --lines 20"
```

Expected: Worker polling logs, no errors.
