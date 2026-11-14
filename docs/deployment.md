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
   `install -d -m 700 /var/backups/aisedlacek-manual && (umask 077; sudo -u postgres pg_dump --format=custom aisedlacek > /var/backups/aisedlacek-manual/pre-2026-10.dump)`
   (peer autentizace přes lokální socket – heslo DB není v argumentech, viz [Ruční přístup k DB](#ruční-přístup-k-db))
   (dump obsahuje hashe hesel a OAuth tokeny – jen pro roota).
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
9. CLI: vydat `ai-sedlacek-cli@0.2.0` na npm – tagem `cli-v0.2.0`, viz [Vydání CLI](#vydání-cli).
   Starší CLI dál funguje, jen `ais push` u dokumentu s víc překlady a nahrání víc než
   200 URL najednou vyžadují novou verzi (server to v chybě řekne).

**Přerušení před krokem 7** (např. baseline ukáže nečekaný stav):
`git checkout --detach fcf24c2 && pm2 start ai-sedlacek-worker` – zpět na starý kód nad
starými `node_modules`.

**Rollback prvního deploye:** po checkoutu `fcf24c2` leží na disku starý `deploy.sh`, který
`DEPLOY_REF` nezná a stáhl by zpět `main` bez kontroly a zálohy. Rollback (i jeho opakování)
proto vždy z kopie aktuálního skriptu mimo repo:

```bash
git show origin/main:deploy.sh > /root/deploy-current.sh
DEPLOY_REF=fcf24c2 bash /root/deploy-current.sh
```

Verze z 2026-10 nepřidává žádnou migraci, takže obnova DB není potřeba (jen pokud se při
baseline něco pokazilo – pak ruční dump z kroku 2). **Další deploy po rollbacku** znovu
podle tohoto postupu od kroku 3 (stop workeru, `git checkout main && git pull --ff-only
origin main`, kontrola historie migrací, `./deploy.sh`), případně
`bash /root/deploy-current.sh`.

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
pre-deploy dumpů; dump se zapisuje jako `*.dump.partial` a na `*.dump` se přejmenuje až
po úspěšném `pg_dump` a plném přečtení (`pg_restore --file=/dev/null`), takže useknutý dump
deploy zastaví a nezůstane po něm nic.

`deploy.sh` předává `psql` a `pg_dump` heslo DB přes dočasný `.pgpass`, ne v argumentech
(na sdíleném VPS by ho jinak viděl v `ps` každý uživatel). **Rollback na commit starší než
tato oprava** (2026-11) ale spustí `deploy.sh` toho commitu, který heslo v argumentech
předává – po dobu takového rollbacku je heslo v `ps` vidět.

> **Pozor:** restart workeru přeruší rozpracované joby; po startu je worker
> znovu zařadí. Deployovat ideálně ve chvíli, kdy neběží velké OCR dávky.

### Verze s rezervací kreditu (otevřené nálezy review 2026-10)

Běžný `deploy.sh`, ruční kroky jen tyto:

- Migrace (všechny jen přidávají tabulky nebo nullable sloupce, data se nemění):
  `20261114120000_add_credit_hold`, `20261114130000_add_charge_records`,
  `20261114140000_add_job_error_code`, `20261114150000_add_cli_auth_code`.
- Web a worker nasazovat spolu (deploy restartuje oba) – worker po startu uvolní
  rezervace kreditu jobů přerušených deployem.
- Po deployi znovu nainstalovat zálohovací skript (viz [Zálohy](#zálohy)).
- **Hned po deployi** vydat CLI 0.3.0 (viz [CLI 0.3.0](#cli-030--přihlášení-bez-tokenu-v-url))
  – stránka `/auth/cli` od deploye radí uživatelům 0.2.0 aktualizovat.

Změna chování pro uživatele: před každým voláním modelu se rezervuje **maximální** možná
cena (celý `max_tokens` sazbou primárního modelu), nevyužitá část se po dokončení vrací.
OCR potřebuje volných zhruba 24 Kč kreditu na jednu stránku, 43 Kč na 3 a 70 Kč na dávku
6 stránek (skutečná cena ~3,60 Kč za stránku); při nižším zůstatku se dávky zmenší,
případně zpracování nezačne s hláškou, kolik kreditu chybí.

**Po nasazení změřit skutečnou spotřebu a stropy zmenšit.** Rezervace = `max_tokens`
(`THINKING_TOKENS_RESERVE` + `BATCH_OUTPUT_TOKENS_PER_PAGE` × stránky v `packages/ocr`),
takže menší rezervace znamená menší `max_tokens` – ten nesmí odpověď oříznout. K 2026-11-14
neexistují data pro Opus 5.5 s adaptivním thinkingem (od 2026-10 neproběhl žádný job);
Opus 4.6 měl výstup na stránku p99 ≈ 3 000, max 3 415 tokenů. Po prvních desítkách dávek:

```sql
WITH b AS (
  SELECT "batchId", min(model) AS model, count(*) AS pages, sum("outputTokens") AS out
  FROM "Document" WHERE "batchId" IS NOT NULL AND "outputTokens" > 0 GROUP BY "batchId")
SELECT model, pages, count(*) AS batches,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY out) AS p99_out, max(out) AS max_out
FROM b GROUP BY model, pages ORDER BY model, pages;
```

`out` dávky zahrnuje i thinking. Strop `max_tokens` nastavit s rezervou nad maximum.

## Vydání CLI

CLI (`ai-sedlacek-cli`, příkaz `ais`) vydává na npm workflow
`.github/workflows/publish-cli.yml` po pushi tagu `cli-vX.Y.Z`. Publikuje se přes npm
**Trusted Publishing** (OIDC): v GitHubu není žádný `NPM_TOKEN` a npm k balíčku připojí
provenance (odkaz na konkrétní běh workflow).

Postup vydání:

1. Zvýšit verzi v `apps/cli/package.json` a `apps/cli/src/version.ts` (test hlídá shodu),
   PR přes `/ais-review`, merge do `main`.
2. `git fetch origin && git tag cli-vX.Y.Z origin/main && git push origin cli-vX.Y.Z` –
   workflow ověří, že tag je na `main` a odpovídá verzi, spustí typecheck/lint/testy CLI,
   sestaví tarball (`npm ci --ignore-scripts`) a v odděleném jobu (jediném s
   `id-token: write`, bez instalace závislostí) ho publikuje.
3. Když workflow selže **před** publikací (např. ještě nenastavený trusted publisher):
   opravit, smazat tag na GitHubu i lokálně (`git push origin :refs/tags/cli-vX.Y.Z &&
   git tag -d cli-vX.Y.Z`) a otagovat znovu podle bodu 2 (včetně `git fetch`). Publikovanou
   verzi už znovu vydat nejde – další oprava = nová verze.

Jednorázové nastavení (vlastník balíčku na npmjs.com):

- `ai-sedlacek-cli` → **Settings → Trusted Publisher → GitHub Actions**:
  Organization or user `claryaldringen`, Repository `AiSedlacek`,
  Workflow filename `publish-cli.yml`, Environment `npm`.
- Po prvním úspěšném vydání: **Settings → Publishing access → Require two-factor
  authentication and disallow tokens** (trusted publishing funguje dál, klasické tokeny ne).
- GitHub prostředí `npm` je omezené jen na tagy `cli-v*` (Settings → Environments → `npm`
  → Deployment branches and tags); volitelně tam lze přidat povinné schválení před publikací.

### CLI 0.3.0 – přihlášení bez tokenu v URL

Verze 0.3.0 (připravená, zatím nevydaná) předává při `ais login` místo tokenu jen
jednorázový kód s PKCE; token si vyzvedne `POST /api/auth/cli/exchange`. Pořadí:

1. Nasadit server (migrace `…_add_cli_auth_code` přidá tabulku `CliAuthCode`).
2. **Hned potom, bez odkladu,** otagovat `cli-v0.3.0` podle postupu výše – stránka
   `/auth/cli` od deploye uživatelům 0.2.0 radí aktualizovat.

Starší CLI (≤ 0.2.0) dál funguje – autorizační stránka mu bez PKCE výzvy předá token
postaru a doporučí aktualizaci. CLI 0.3.0 token v callbacku **nepřijme** (podvržený
callback s cizím tokenem by uživatele přihlásil k cizímu účtu – login CSRF), funguje
proto jen proti serveru s výměnou kódu; proto se vydává až po deployi serveru.

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
chybí migrace starší než poslední aplikovaná, která byla v repu už v naposledy úspěšně
nasazeném commitu (`.git/ais-deployed-head`, zapisuje `deploy.sh` po restartu) – schéma se
měnilo mimo migrace. Nové migrace přinesené tímto deployem (i se starším timestampem
z jiné větve) aplikuje `prisma migrate deploy`.

Když skript hlásí chybějící migraci, **nejdřív ověřit, jestli její objekty v DB existují**:
existují → `prisma migrate resolve --applied <název>`; neexistují (migrace se nikdy
neaplikovala) → neoznačovat, nechat ji aplikovat: `PREV_HEAD=<commit bez této migrace> ./deploy.sh`.

**Před prvním deployem verze z 2026-10 je tahle kontrola povinná ručně** – do té doby
deploy migrace z repa vůbec nenacházel (ležely v `apps/web/prisma/migrations`), takže
stav produkční historie není ověřený:

```bash
cd /opt/AiSedlacek
sudo -u postgres psql -X -d aisedlacek -c 'SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY 1'
git pull --ff-only origin main && ls packages/db/prisma/migrations
```

- Migrace, jejichž objekty v DB už existují, ale chybí v historii, jen označit:
  `npx prisma migrate resolve --applied <název> --schema=packages/db/prisma/schema.prisma`.
- **Datovou migraci `20260325120000_backfill_email_verified` nespouštět znovu** – pokud
  v historii chybí, jen ji označit (`resolve --applied`); jinak by označila všechny
  dosud neověřené e-mailové registrace jako ověřené.
- Kontrola driftu (jen čtení): `DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')" npx prisma migrate diff --from-schema-datasource packages/db/prisma/schema.prisma
  --to-schema-datamodel packages/db/prisma/schema.prisma --script` (URL jde Prismě
  v prostředí, ne v argumentech) – po baseline má být prázdný výstup (verze z 2026-10
  nepřidává žádnou novou migraci).
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

- Denně v 03:30 `pg_dump` do `/var/backups/aisedlacek`, rotace 14 dní. Dump se píše do
  `*.dump.partial` a na `*.dump` se přejmenuje až po ověření plným přečtením
  (`pg_restore --file=/dev/null` – `--list` čte jen obsah a useknutý dump propustí);
  nepovedený dump se smaže. Vlastní `.partial` po přerušeném běhu se smažou na začátku
  dalšího běhu, staré pre-deploy `.partial` uklidí rotace.
- Přihlašovací údaje k DB jdou do `pg_dump` přes `PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE`
  a dočasný `.pgpass` (práva 600, po skončení se smaže) – heslo není v argumentech
  procesu, takže ho ostatní uživatelé sdíleného VPS nevidí v `ps`. Zděděná `PGPASSWORD`
  se pro `pg_dump` ruší (`env -u PGPASSWORD`), jinak by měla přednost před `.pgpass`.
- S `BACKUP_REMOTE` se dumpy i uploady kopírují mimo VPS **jen přírůstkově**
  (`rsync --ignore-existing`, bez `--delete`): na cíli se nic nemaže ani nepřepisuje,
  takže smazání nebo poškození lokálních souborů se na off-site kopii nepropíše.
  Off-site jdou jen `*.dump`, které projdou plným přečtením (i pre-deploy dumpy).
  Starých dumpů na cíli proto přibývá – retenci je potřeba nastavit na cílovém úložišti
  (např. snapshoty Storage Boxu nebo občasný ruční úklid). Bez `BACKUP_REMOTE` je záloha
  jen na stejném disku a uploady se nezálohují.
- **Po změně skriptu ho na serveru znovu nainstalovat** (deploy ho nekopíruje):
  `install -m 700 ops/backup/aisedlacek-backup.sh /usr/local/bin/aisedlacek-backup`.
- Obnova: `sudo -u postgres pg_restore --clean --if-exists -d aisedlacek < <soubor.dump>`
  (dumpy patří rootovi s právy 600, proto přes stdin; obnovu je dobré si jednou vyzkoušet
  na kopii DB).

### Ruční přístup k DB

Na serveru vždy přes peer autentizaci lokálního socketu – `sudo -u postgres psql -X -d
aisedlacek`, `sudo -u postgres pg_dump …`. Nikdy nepředávat `DATABASE_URL` (s heslem)
jako argument `psql`/`pg_dump`/`pg_restore`: server je sdílený a argumenty procesů vidí
v `ps` každý uživatel.

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
| `RESEND_API_KEY`, `EMAIL_FROM` | **ano** | Odesílání e-mailů přes Resend. **Bez nich nefunguje registrace e-mailem** (ověřovací odkaz skončí jen v logu) ani reset hesla. V produkci od 2026-11-14: `EMAIL_FROM="AI Sedláček <noreply@aisedlacek.com>"`, doména `aisedlacek.com` ověřená v Resendu (region EU, DNS v Cloudflare: CNAME `send` a `rsend`, TXT `resend._domainkey` a `_dmarc`), klíč jen pro odesílání z této domény. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | ano | Platby kartou |
| `FIO_API_TOKEN` | ne | Dobíjení převodem (bez něj se Fio v UI skryje) |
| ~~`TOKEN_MULTIPLIER`, `TOKEN_PRICE_PER_MILLION`~~ | – | Od 2026-10 se nepoužívají. Ceník je v kódu (`packages/shared/src/pricing.ts`): uživatel platí skutečný náklad API daného modelu × marže 2 (kurz 23 Kč/USD), 1M kreditů = 50 Kč. |
| `UPLOAD_DIR` | ano | `/opt/AiSedlacek/uploads` (absolutní cesta) |
| `LLM_PROVIDER` | ne | `claude` (výchozí). `claude-cli` jen pro lokální vývoj – v produkci worker odmítne start. |
| `MAX_FILE_SIZE_MB` | ne | Limit uploadu (výchozí 20) |
