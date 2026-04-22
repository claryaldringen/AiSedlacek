# Migrace Vercel → Hetzner VPS

## Cíl

Přesunout celou aplikaci AiSedlacek z Vercelu na stávající Hetzner VPS (204.168.176.128).
Po migraci nebudou žádné závislosti na Vercel, Neon, ani Cloudflare R2.

## Server

- **OS:** Ubuntu 24.04 LTS
- **CPU:** 2 jádra, **RAM:** 3.7 GB, **Disk:** 38 GB (26 GB volných)
- **Nainstalováno:** Node.js 24, PostgreSQL 16, Caddy 2.11, PM2 6.0
- **Existující služby:** sfingee.com (:3000), vodnistav.cz/hospodaracice.cz (:3002), ai-sedlacek-worker (systemd)
- **Doména:** aisedlacek.com (DNS na Cloudflare)

## Architektura po migraci

```
aisedlacek.com (Cloudflare DNS → 204.168.176.128)
        │
     Caddy (port 443/80, auto TLS)
        │
        ├── /uploads/*  →  file_server /opt/AiSedlacek/uploads/
        │
        └── /*  →  reverse_proxy localhost:3003
                        │
                   Next.js standalone (PM2: ai-sedlacek-web)
                        │
                   PostgreSQL localhost:5432/aisedlacek
                        │
                   Worker (PM2: ai-sedlacek-worker)
                     polling DB pro ProcessingJob
```

## Rozhodnutí

| Oblast | Bylo | Bude |
|--------|------|------|
| **Hosting webu** | Vercel (serverless) | Hetzner VPS, Next.js standalone, PM2 |
| **Databáze** | Neon PostgreSQL (remote) | PostgreSQL 16 lokálně na VPS |
| **Úložiště obrázků** | Cloudflare R2 (S3 API) | Lokální filesystem `/opt/AiSedlacek/uploads/` |
| **Servírování obrázků** | R2 CDN / Next.js API route | Caddy file_server (staticky) |
| **Worker** | systemd service | PM2 (konzistence s ostatními PM2 procesy) |
| **TLS certifikát** | Vercel automaticky | Caddy automaticky (Let's Encrypt) |
| **Deploy** | git push → Vercel | git pull → build → pm2 restart (skript) |
| **Port** | — | 3003 (3000 a 3002 obsazené) |

## Změny v kódu

### 1. Next.js standalone output

`apps/web/next.config.ts` — přidat `output: 'standalone'`. Standalone build vytvoří self-contained server v `.next/standalone/` (~50 MB), který nepotřebuje celý `node_modules`.

### 2. Odstranit R2 storage provider

- Smazat `apps/web/lib/adapters/storage/r2-storage.ts`
- Smazat `@aws-sdk/client-s3` z `apps/web/package.json` a `apps/worker/package.json`
- Zjednodušit `apps/web/lib/adapters/storage/index.ts` — vždy vracet `LocalStorageProvider`
- Odstranit `isRemoteStorage()` funkci a všechny její volání
- `LocalStorageProvider` — změnit výchozí `uploadDir` na `/opt/AiSedlacek/uploads`

### 3. Obrázky přes Caddy místo API route

Caddy bude servírovat `/uploads/*` přímo ze souborového systému. API route `/api/images/[...path]` zůstane jako fallback, ale primárně se nepoužije — `LocalStorageProvider.upload()` bude vracet URL `/uploads/<filename>` místo `/api/images/<filename>`.

### 4. Odstranit Vercel-specifické exporty

- Smazat `export const maxDuration = X` ze všech API routes (chat, retranslate, generate-context, fix-document-contexts)
- Smazat `export const runtime = 'nodejs'` z billing webhook (je to default)
- Smazat `vercel.json`

### 5. Odstranit R2 env proměnné z turbo.json

Odebrat `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` z `globalEnv`.

### 6. PM2 ecosystem soubor

Vytvořit `ecosystem.config.cjs` v kořeni repozitáře:

```js
module.exports = {
  apps: [
    {
      name: 'ai-sedlacek-web',
      script: 'apps/web/.next/standalone/server.js',
      env: {
        PORT: 3003,
        HOSTNAME: '0.0.0.0',
      },
      env_file: '/opt/AiSedlacek/.env',
    },
    {
      name: 'ai-sedlacek-worker',
      script: 'apps/worker/src/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx/esm',
      env_file: '/opt/AiSedlacek/.env',
    },
  ],
};
```

### 7. Deploy skript

Vytvořit `deploy.sh` v kořeni repozitáře:

```bash
#!/bin/bash
set -e

cd /opt/AiSedlacek
git pull origin main
npm install
npx turbo build --filter=@ai-sedlacek/web
# Standalone build potřebuje static files zkopírované
cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static
cp -r apps/web/public apps/web/.next/standalone/apps/web/public
pm2 restart ecosystem.config.cjs
```

### 8. Worker — odstranit R2 závislost

Worker (apps/worker) také používá `@aws-sdk/client-s3` pro čtení obrázků z R2. Po migraci bude číst přímo z lokálního filesystému. Ověřit, že worker používá `getStorage()` z adaptéru a ne přímý S3 klient.

## Infrastruktura na serveru

### PostgreSQL

```bash
sudo -u postgres createuser aisedlacek
sudo -u postgres createdb -O aisedlacek aisedlacek
sudo -u postgres psql -c "ALTER USER aisedlacek PASSWORD '...';"
```

`DATABASE_URL=postgresql://aisedlacek:***@localhost:5432/aisedlacek`

### Migrace dat z Neon

```bash
# Na lokálním stroji nebo serveru s přístupem k Neonu:
pg_dump "postgresql://neondb_owner:...@neon.tech/neondb?sslmode=require" > neon_dump.sql
# Na serveru:
psql -U aisedlacek -d aisedlacek < neon_dump.sql
```

### Migrace obrázků z R2

Stáhnout všechny obrázky z R2 do `/opt/AiSedlacek/uploads/` pomocí rclone nebo AWS CLI:

```bash
# Jednorázově, před přepnutím:
rclone sync r2:ai-sedlacek /opt/AiSedlacek/uploads/
```

Pak aktualizovat `imageUrl` v DB tabulce `Page` — přepsat R2 URL na lokální `/uploads/...` cestu.

### Caddy

Přidat do `/etc/caddy/Caddyfile`:

```caddyfile
aisedlacek.com {
    handle /uploads/* {
        root * /opt/AiSedlacek
        file_server
        header Cache-Control "public, max-age=31536000, immutable"
    }

    handle {
        reverse_proxy localhost:3003
    }
}
```

### Systemd worker → PM2

```bash
systemctl stop ai-sedlacek-worker
systemctl disable ai-sedlacek-worker
pm2 start ecosystem.config.cjs
pm2 save
```

### DNS (Cloudflare)

Nastavit A záznam: `aisedlacek.com → 204.168.176.128` (proxy vypnutý, aby Caddy řešil TLS).

### .env na serveru

Aktualizovat `/opt/AiSedlacek/.env`:

```env
DATABASE_URL=postgresql://aisedlacek:***@localhost:5432/aisedlacek
ANTHROPIC_API_KEY=sk-ant-...
AUTH_SECRET=...
NEXTAUTH_URL=https://aisedlacek.com
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
FIO_API_TOKEN=...
TOKEN_MULTIPLIER=...
TOKEN_PRICE_PER_MILLION=...
UPLOAD_DIR=/opt/AiSedlacek/uploads
```

R2 proměnné se odstraní.

## Co se NESMAZÁŽE

- `apps/web/app/api/images/[...path]/route.ts` — zůstane jako fallback, ale URL z DB budou ukazovat na `/uploads/`, které obslouží Caddy
- `IStorageProvider` interface v `packages/shared` — zůstane, jen nebude mít R2 implementaci

## Pořadí migrace

1. Změny v kódu (standalone, remove R2, PM2 config, deploy skript)
2. Setup PostgreSQL na VPS + migrace dat z Neon
3. Migrace obrázků z R2 na VPS
4. Deploy aplikace na VPS (git pull, build, pm2 start)
5. Konfigurace Caddy
6. DNS přepnutí na Cloudflare
7. Ověření funkčnosti
8. Deaktivace Vercel projektu a systemd worker service
