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

## První deploy verze z 2026-10 (jednorázově)

Na serveru běží commit `fcf24c2`. Starý `deploy.sh` neumí zálohu ani kontrolu
migrací a bash by ho dočetl i po `git pull` – proto nejdřív ručně připravit
server a teprve pak spustit nový skript:

1. `cd /opt/AiSedlacek && git status` – lokálně upravený `package-lock.json`
   vrátit (`git checkout -- package-lock.json`), jinak `git pull --ff-only` spadne.
2. Ruční záloha mimo rotovaný adresář (denní zálohy mažou `*.dump` starší 14 dní):
   `mkdir -p /var/backups/aisedlacek-manual && pg_dump --format=custom --file=/var/backups/aisedlacek-manual/pre-2026-10.dump "<DATABASE_URL bez ?schema>"`.
3. `pm2 stop ai-sedlacek-worker` (joby počkají ve frontě – worker běží přes tsx přímo
   ze zdrojáků a s novým kódem nad starými `node_modules` by padal; `deploy.sh` ho
   na konci znovu spustí), pak `git pull --ff-only origin main` – od teď poběží nový `deploy.sh`.
4. Kontrola historie migrací a případný baseline – viz
   [Kontrola historie migrací](#kontrola-historie-migrací-a-jednorázový-baseline).
5. Caddy: hlavičky pro `/uploads/*` a limity `request_body` z
   [caddy-uploads.md](caddy-uploads.md) (**povinné**), `caddy validate`, reload.
6. `.env`: doplnit `RESEND_API_KEY` a `EMAIL_FROM` (bez nich nefunguje registrace e-mailem).
7. `./deploy.sh`, pak `pm2 env <id workeru> | grep NODE_ENV` → `production`.
8. Zálohy: instalace `ops/backup/` (viz [Zálohy](#zálohy)).
9. CLI: vydat `ai-sedlacek-cli@0.2.0` na npm (`npm publish -w ai-sedlacek-cli`).
   Starší CLI dál funguje, jen `ais push` u dokumentu s víc překlady a nahrání víc než
   200 URL najednou vyžadují novou verzi (server to v chybě řekne).

**Rollback prvního deploye:** `DEPLOY_REF=fcf24c2 ./deploy.sh` – nový skript ho dokončí
sám (starší `deploy.sh` re-exec nezná a stáhl by znovu `main`). Verze z 2026-10 nepřidává
žádnou migraci, takže obnova DB není potřeba (jen pokud se při baseline něco pokazilo –
pak ruční dump z kroku 2).

## Deploy nové verze

```bash
ssh root@204.168.176.128 /opt/AiSedlacek/deploy.sh
```

`deploy.sh` udělá: `git pull` (při změně sebe sama pokračuje novou verzí) → kontrola
historie migrací → **pg_dump do `/var/backups/aisedlacek/pre-deploy-*.dump`** →
`npm ci` → `prisma generate` → build webu → `prisma migrate deploy` → `pm2 restart`.
Kontrola i záloha běží před `npm ci`, takže když selžou, běžící aplikace zůstane
netknutá. Build běží před migrací, takže neprošlý build nechá databázi netknutou
– běžící aplikace ale může být rozbitá (`npm ci` a build už přepsaly soubory). Rollback:
`DEPLOY_REF=<předchozí commit> /opt/AiSedlacek/deploy.sh`; pokud už proběhla migrace,
je potřeba obnovit pre-deploy dump (`pg_restore`) – dump vzniká před buildem, takže
zápisy z doby buildu v něm nejsou: po obnově dosrovnat platby (Stripe dashboard, Fio
výpis) a zkontrolovat OCR joby dokončené během deploye. Ponechává se 10 posledních
pre-deploy dumpů.

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

### Kontrola historie migrací a jednorázový baseline

`deploy.sh` před `npm ci` ověří, že historie v `_prisma_migrations` navazuje na
`packages/db/prisma/migrations`, a jinak skončí chybou dřív, než sáhne na běžící aplikaci:
tabulka chybí nebo je prázdná, některá migrace je nedokončená (failed), nebo v historii
chybí migrace starší než poslední aplikovaná (schéma se měnilo mimo migrace).

**Před prvním deployem verze z 2026-10 je tahle kontrola povinná ručně** – do té doby
deploy migrace z repa vůbec nenacházel (ležely v `apps/web/prisma/migrations`), takže
stav produkční historie není ověřený:

```bash
cd /opt/AiSedlacek
PG_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"; PG_URL="${PG_URL%%\?*}"
psql "$PG_URL" -c 'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY 1'
git pull --ff-only origin main && ls packages/db/prisma/migrations
```

- Migrace, jejichž objekty v DB už existují, ale chybí v historii, jen označit:
  `npx prisma migrate resolve --applied <název> --schema=packages/db/prisma/schema.prisma`.
- **Datovou migraci `20260325120000_backfill_email_verified` nespouštět znovu** – pokud
  v historii chybí, jen ji označit (`resolve --applied`); jinak by označila všechny
  dosud neověřené e-mailové registrace jako ověřené.
- Kontrola driftu (jen čtení): `npx prisma migrate diff --from-url "$PG_URL"
  --to-schema-datamodel packages/db/prisma/schema.prisma --script` – po baseline má
  být prázdný výstup (verze z 2026-10 nepřidává žádnou novou migraci).
- Teprve pak `./deploy.sh`.

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
| ~~`TOKEN_MULTIPLIER`, `TOKEN_PRICE_PER_MILLION`~~ | – | Od 2026-10 se nepoužívají. Ceník je v kódu (`packages/shared/src/pricing.ts`): uživatel platí skutečný náklad API daného modelu × marže 2 (kurz 23 Kč/USD), 1M kreditů = 50 Kč. |
| `UPLOAD_DIR` | ano | `/opt/AiSedlacek/uploads` (absolutní cesta) |
| `LLM_PROVIDER` | ne | `claude` (výchozí). `claude-cli` jen pro lokální vývoj – v produkci worker odmítne start. |
| `MAX_FILE_SIZE_MB` | ne | Limit uploadu (výchozí 20) |
