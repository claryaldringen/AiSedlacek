# Deployment

> Stav ověřený na serveru 2026-10-14. Dřívější verze tohoto dokumentu popisovala
> architekturu z jara 2026 (Vercel + Neon + Cloudflare R2 + systemd), která už neplatí.

## Architektura

```
                 Internet (80/443)
                        │
                     Caddy  ── /uploads/*  → file_server /opt/AiSedlacek/uploads
                        │
                        └── ostatní → reverse_proxy 127.0.0.1:3003
                                          │
                          PM2: ai-sedlacek-web (Next.js standalone)
                                          │
                     PostgreSQL 16 (localhost:5432, DB `aisedlacek`)
                                          │
                          PM2: ai-sedlacek-worker (polling DB fronty ProcessingJob)
```

Vše běží na jednom Hetzner VPS, který je **sdílený s dalšími aplikacemi**
(sfingee, sweptmind, hospodaracice, mstores, …) – změny Caddy, PM2 a Postgresu
mají dopad i na ně.

## Server

- **IP:** 204.168.176.128, Ubuntu 24.04, 8 GB RAM, 2 GB swap, disk 38 GB
- **Firewall:** `ufw` – povoleno jen 22, 80, 443 (porty aplikací zvenku nedostupné)
- **SSH:** `ssh root@204.168.176.128`
- **Aplikace:** `/opt/AiSedlacek` (git checkout větve `main`)
- **Uploady:** `/opt/AiSedlacek/uploads` (`UPLOAD_DIR`), servíruje je přímo Caddy
- **Env:** `/opt/AiSedlacek/.env` – sdílí web i worker (načítá se přes `--env-file` v `ecosystem.config.cjs`)

## Procesy (PM2)

Definice v `ecosystem.config.cjs`:

| Proces | Co běží | Poznámka |
|---|---|---|
| `ai-sedlacek-web` | `apps/web/.next/standalone/apps/web/server.js` | port 3003 |
| `ai-sedlacek-worker` | `apps/worker/src/index.ts` přes `tsx` | polling DB á 3 s, max. 5 souběžných jobů |

```bash
pm2 status
pm2 logs ai-sedlacek-web --lines 200
pm2 logs ai-sedlacek-worker --lines 200
pm2 restart ai-sedlacek-worker
```

## Deploy nové verze

```bash
ssh root@204.168.176.128 /opt/AiSedlacek/deploy.sh
```

`deploy.sh` udělá: `git pull` → `npm ci` → `prisma generate` → build webu →
**pg_dump do `/var/backups/aisedlacek/pre-deploy-*.dump`** → `prisma migrate deploy`
→ `pm2 restart`. Build běží před migrací, takže neprošlý build nechá databázi netknutou.

> **Pozor:** restart workeru přeruší rozpracované joby; po startu je worker
> znovu zařadí. Deployovat ideálně ve chvíli, kdy neběží velké OCR dávky.

## Databáze a migrace

- Jediné schéma: `packages/db/prisma/schema.prisma`, migrace v `packages/db/prisma/migrations`.
- Produkce: **pouze** `npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma`
  (dělá `deploy.sh`).
- **Nikdy** proti produkci nespouštět `prisma migrate dev`, `prisma migrate reset`
  ani `prisma db push` – mohou navrhnout reset nebo obejít historii migrací.
- Stav migrací: `npx prisma migrate status --schema=packages/db/prisma/schema.prisma`
  (s produkčním `DATABASE_URL`, jen čtení).
- Nová migrace vzniká lokálně: `npm run db:migrate:dev -w @ai-sedlacek/db`.

## Zálohy

Do 2026-10-14 AiSedlacek **neměl žádné zálohy**. Připravené jsou v `ops/backup/`:

```bash
# jednorázová instalace na serveru (root)
install -m 700 ops/backup/aisedlacek-backup.sh /usr/local/bin/aisedlacek-backup
cp ops/backup/aisedlacek-backup.{service,timer} /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now aisedlacek-backup.timer

# off-site kopie (doporučeno) – např. Hetzner Storage Box
echo 'BACKUP_REMOTE=uXXXXXX@uXXXXXX.your-storagebox.de:aisedlacek' > /etc/default/aisedlacek-backup
```

- Denně v 03:30 `pg_dump` do `/var/backups/aisedlacek`, rotace 14 dní.
- S `BACKUP_REMOTE` se dumpy i uploady synchronizují mimo VPS (uploady se na
  cíli nemažou). Bez něj je záloha jen na stejném disku a uploady se nezálohují.
- Obnova: `pg_restore --clean --if-exists -d "$DATABASE_URL" <soubor.dump>`
  (obnovu je dobré si jednou vyzkoušet na kopii DB).

## Caddy

Konfigurace `/etc/caddy/Caddyfile` (sdílená všemi aplikacemi na serveru). Blok
`aisedlacek.com` – doporučené hlavičky pro `/uploads/*` viz
[docs/caddy-uploads.md](caddy-uploads.md).

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

## Proměnné prostředí (`/opt/AiSedlacek/.env`)

| Proměnná | Povinná | Popis |
|---|---|---|
| `DATABASE_URL` | ano | `postgresql://…@localhost:5432/aisedlacek` |
| `ANTHROPIC_API_KEY` | ano | Claude API |
| `AUTH_SECRET`, `AUTH_TRUST_HOST`, `NEXTAUTH_URL` | ano | NextAuth v5 (`https://aisedlacek.com`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | ano | Google OAuth |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | ne | GitHub OAuth (v produkci zatím nenastaveno) |
| `RESEND_API_KEY`, `EMAIL_FROM` | **ano** | Odesílání e-mailů. **Bez nich nefunguje registrace e-mailem** (ověřovací odkaz skončí jen v logu) ani reset hesla. V produkci k 2026-10-14 chybí. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ano | Platby kartou |
| `FIO_API_TOKEN` | ne | Dobíjení převodem (bez něj se Fio v UI skryje) |
| `TOKEN_MULTIPLIER`, `TOKEN_PRICE_PER_MILLION` | ne | Ceník kreditů (výchozí ×2 a 50 Kč / 1M tokenů – nezávisle na modelu) |
| `UPLOAD_DIR` | ano | `/opt/AiSedlacek/uploads` (absolutní cesta) |
| `LLM_PROVIDER` | ne | `claude` (výchozí). `claude-cli` jen pro lokální vývoj – v produkci worker odmítne start. |
| `MAX_FILE_SIZE_MB` | ne | Limit uploadu (výchozí 20) |
