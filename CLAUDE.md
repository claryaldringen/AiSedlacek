# Čtečka starých textů – CLAUDE.md

## Účel projektu

Webová aplikace (https://aisedlacek.com) pro čtení a překlad historických rukopisů. Uživatel
nahraje sken/fotografii dokumentu (nebo ho importuje z URL / IIIF) a aplikace provede:

1. **OCR + překlad** – Claude Vision přečte text z obrázku a přeloží ho do moderního jazyka
2. **Kontext** – historický kontext ke stránce i k celému svazku
3. **Glosář** – vysvětlení archaických a odborných termínů
4. **Verzování** – každá úprava se ukládá, lze obnovit předchozí verze
5. **Chat nad dokumentem**, veřejné sdílení (`/view/<slug>`), workspaces, kreditový billing

Primární jazyky zdrojových textů: **stará horní němčina**, **staročeština**, **latina**.
Jazyky překladu: `cs`, `en`, `de`, `fr`, `la` (`TRANSLATION_LANGUAGES` v `packages/shared`).

---

## Technologický stack

- **Monorepo:** Turborepo – `apps/web`, `apps/worker`, `apps/cli`, `packages/db`, `packages/ocr`, `packages/shared`
- **Web:** Next.js 15 (App Router, standalone), React 19, Tailwind CSS v4, next-intl (`en` výchozí, `cs`)
- **Auth:** NextAuth v5 (JWT session) – Google, GitHub, e-mail + heslo s ověřením e-mailu; API tokeny pro CLI (Bearer)
- **Worker:** Node + `tsx`, polling DB fronty `ProcessingJob` á 3 s, max. 5 souběžných jobů
- **Databáze:** PostgreSQL 16 + Prisma 6 (jediné schéma `packages/db/prisma/schema.prisma`)
- **LLM:** Claude API – modely v `packages/shared/src/models.ts` (`OCR_MODEL` = Opus 4.6 pro OCR,
  `TEXT_MODEL` = Sonnet 4.6 pro retranslaci, chat, kontexty, metadata)
- **Obrázky:** Sharp (validace formátu z obsahu, náhledy, příprava pro API), soubory na lokálním disku (`UPLOAD_DIR`)
- **Billing:** append-only ledger `TokenTransaction`, Stripe Checkout + webhook, Fio (převod s VS), QR platby
- **E-maily:** Resend (bez `RESEND_API_KEY` jen konzolový výpis – v produkci nutné nastavit)
- **Deployment:** Hetzner VPS (sdílený s dalšími aplikacemi), PM2 + Caddy – viz [docs/deployment.md](docs/deployment.md)

---

## Architektura

### Zpracování dokumentu

```
Upload (POST /api/pages/upload, /import-url, CLI /upload-url)
  → validace formátu z obsahu (magic bytes + sharp), max 20 MB, limit 100 Mpx
  → uložení <uuid>.<přípona> do UPLOAD_DIR + náhled 400 px, detekce prázdné stránky
  → Page (status: pending | blank)
        │
        ▼
POST /api/pages/process
  → ověří vlastnictví stránek i svazku, zůstatek kreditu, souběžné joby (409)
  → založí ProcessingJob (status: queued), vrátí jobId; UI polluje /api/pages/process/status
        │
        ▼
Worker (apps/worker) – handler podle ProcessingJob.type
  ocr              → process-pages.ts: příprava (dedup jen v rámci uživatele, přeskočení
                     prázdných/přeložených), dávky ~6 stránek → processWithClaudeBatch
                     (packages/ocr), obrázky se načítají až pro konkrétní dávku,
                     odečet kreditu hned po volání (deterministické referenceId),
                     uložení Document + Translation + GlossaryEntry + DocumentVersion.
                     jobData {"regenerate": true} = přepsat existující dokument na místě
                     (předchozí obsah jako verze ai_regenerate, nic se nemaže).
  retranslate      → inkrementální překlad po editaci transkripce (Sonnet)
  generate-context, fix-contexts, translate-context → kontexty svazku/stránek
        │
        ▼
UI: DocumentPanel / ResultViewer – obrázek + editovatelná transkripce, překlad,
    kontext, glosář, historie verzí, chat (SSE)
```

Lokální OCR bez placeného API: `LLM_PROVIDER=claude-cli` (jen worker, jen vývoj – v produkci
worker odmítne start) a agentní tok CLI `ais prompt` → `ais submit` (`POST /api/pages/[id]/result`).

### Klíčové vlastnosti UI

- **Workspaces** – domácí, sdílené (invite kód) a veřejný; kolekce (svazky) se do nich zařazují
- **Správa svazků** – drag & drop, grid/list, klávesové zkratky, hromadné OCR s průběhem
- **Kontext svazku** – generování AI, import z URL, oprava kontextů stránek, překlad
- **Inline editace** – markdown editor; chyby uložení se zobrazí a editor zůstane otevřený
- **Verzování** – každá změna ukládá předchozí stav (pole `transcription`, `context`, `translation:<lang>`)
- **Veřejné sdílení** – `/view/<slug>` pro svazek i stránku; archivované stránky se nezobrazují
- **Billing** – `/workspace/billing`, zůstatek kreditů, Stripe/Fio/QR

---

## Datový model (Prisma / PostgreSQL)

```
User 1──N Collection 1──N Page 1──1 Document 1──N Translation
  │            │                       ├──N GlossaryEntry
  │            └──N WorkspaceItem      └──N DocumentVersion
  ├──N WorkspaceMember N──1 Workspace
  ├──N ProcessingJob
  ├──N TokenTransaction        (ledger – zůstatek = součet)
  ├──N ApiToken                (CLI, ukládá se jen SHA-256)
  └──  Account / Session / VerificationToken / PasswordResetToken (NextAuth)
PublicSlug (slug → collection | page)
```

| Model | Poznámka |
|-------|----------|
| **Page** | `status`: pending, processing, done, error, blank, archived („smazaná" zpracovaná stránka). Klient smí nastavit jen pending/blank/archived. `hash` (SHA-256 obrázku), `thumbnailUrl`, `isPublic`, `slug`, `order` |
| **Document** | unikátní je `pageId` (1:1 se stránkou), `hash` je jen index. `rawResponse` (u dávek výstup celé dávky – nevracet v API), `batchId`, tokeny, model |
| **Translation** | unikátní `[documentId, language]`, volitelně vlastní `context` a `glossaryJson` |
| **DocumentVersion** | `version` auto-increment per dokument (retry na kolizi), `source`: ai_initial, ai_retranslate, ai_regenerate, manual_edit |
| **ProcessingJob** | `type`: ocr, retranslate, generate-context, fix-contexts, translate-context; `jobData` (JSON) |
| **TokenTransaction** | idempotence přes `@@unique([userId, referenceId])` |

---

## API (přehled)

Všechny routy v `apps/web/app/api/`. Autentizace přes session cookie; routy se `resolveUserId`
přijímají i Bearer token z CLI. Vlastnictví se ověřuje v každé routě (`getOwnedCollection`
v `lib/infrastructure/authz.ts`, u stránek/dokumentů přes `page.userId`).

| Oblast | Routy |
|--------|-------|
| auth | `[...nextauth]`, `register`, `verify-email`, `send-verification`, `check-verification`, `forgot-password`, `reset-password`, `cli/token`, `cli/me` |
| pages | `GET/upload`, `upload-url` (CLI), `import-url`, `prefetch`, `discover-urls`, `detect-blank`, `search`, `[id]` (GET/PATCH/DELETE), `[id]/result` (agentní OCR), `process` (POST/GET), `process/status`, `process/cancel`, `process/interrupted` |
| documents | `[id]` (GET/PATCH/DELETE), `[id]/retranslate`, `[id]/reparse`, `[id]/versions`, `[id]/chat` (SSE) |
| collections | `GET` (`?workspaceId=` povinné)/`POST`, `[id]`, `[id]/generate-context`, `[id]/fetch-context`, `[id]/translate-context`, `[id]/fix-document-contexts`, `[id]/extract-metadata` |
| billing | `balance`, `checkout`, `webhook` (Stripe, ověřený podpis), `fio-check`, `qr` |
| ostatní | `workspaces`, `workspaces/[id]`, `workspaces/[id]/items`, `workspaces/join`, `public/[slug]`, `user/locale`, `prompts`, `images/[...path]` (legacy URL) |

Uploady servíruje v produkci přímo Caddy na `/uploads/*` (viz [docs/caddy-uploads.md](docs/caddy-uploads.md)).
Server-side fetch uživatelských URL vždy přes `safeFetch` (`lib/infrastructure/safe-fetch.ts` – SSRF ochrana).

---

## Struktura projektu

```
├── apps/
│   ├── web/                    # Next.js
│   │   ├── app/[locale]/       # stránky: (public), login, workspace, workspace/billing, view/[slug], …
│   │   ├── app/auth/cli/       # autorizace `ais login` (mimo [locale])
│   │   ├── app/api/            # API routes (viz výše)
│   │   ├── components/         # DocumentPanel, ResultViewer, FileGrid, DocumentChat, ImportDialog, …
│   │   ├── hooks/              # useProcessingJob, useJobPolling, useDesktopSelection, …
│   │   ├── lib/auth.ts         # NextAuth konfigurace
│   │   ├── lib/pricing.ts      # ceník modelů pro zobrazení nákladů (ne pro účtování)
│   │   ├── lib/adapters/       # storage (local-storage), email (resend, console)
│   │   ├── lib/infrastructure/ # authz, billing, safe-fetch, image-validation, rate-limit, versioning, …
│   │   ├── i18n/, messages/    # next-intl (en, cs)
│   │   └── middleware.ts       # locale + přesměrování nepřihlášených (API je mimo middleware)
│   ├── worker/                 # zpracování ProcessingJob (handlers/, lib/)
│   └── cli/                    # `ais` – login, upload, list, pull, push, diff, prompt, submit, …
├── packages/
│   ├── db/                     # Prisma schéma + migrace, billing, versioning, client
│   ├── ocr/                    # volání Claude (process.ts), parsování (parse.ts), příprava obrázků
│   └── shared/                 # typy, prompty, modely (models.ts), jazyky, rozhraní storage/email
├── ops/backup/                 # skript a systemd timer pro zálohy DB a uploadů
├── docs/                       # deployment, caddy-uploads, prompty, OCR enginy, plány
├── deploy.sh                   # deploy na VPS (build → pg_dump → migrate deploy → pm2 restart)
└── ecosystem.config.cjs        # PM2 procesy
```

---

## Proměnné prostředí

Kompletní tabulka v [docs/deployment.md](docs/deployment.md#proměnné-prostředí-optaisedlacekenv).
Lokálně: `apps/web/.env.local` a `apps/worker/.env`. Minimum pro vývoj: `DATABASE_URL`,
`ANTHROPIC_API_KEY`, `AUTH_SECRET`, `NEXTAUTH_URL`, `UPLOAD_DIR` (absolutní cesta, sdílená
webem i workerem).

---

## Spuštění

```bash
# === Lokální vývoj ===
npm install
npx prisma generate --schema=packages/db/prisma/schema.prisma
npm run db:migrate:dev -w @ai-sedlacek/db      # nová migrace / aplikace migrací lokálně
npx turbo dev                                  # web na :3003
npm run dev -w @ai-sedlacek/worker             # worker (zvlášť)

# === Validace (musí být zelená – běží i v CI, .github/workflows/ci.yml) ===
npx turbo typecheck lint format:check test

# === Deployment ===
ssh root@204.168.176.128 /opt/AiSedlacek/deploy.sh
```

---

## Claude Code – workflow

### Pravidla pro Claude Code

- **Vždy čti celý CLAUDE.md** před začátkem práce na jakémkoliv úkolu.
- **Ptej se před implementací**, pokud úkol vyžaduje architektonické rozhodnutí.
- **Commity v češtině**, konvenční formát: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`.
- **Žádné hardcoded API klíče.** Vše přes proměnné prostředí.
- **Loguj každý krok pipeline** – model, čas zpracování, tokeny.
- **Migrace musí být bezstrátové.** Nikdy nepoužívej `prisma migrate reset` ani `prisma db push`
  proti produkci. Každé zpracování stojí peníze za API volání – data se nesmí ztratit. Vždy
  používej inkrementální migrace (`prisma migrate dev` lokálně, `prisma migrate deploy`
  v produkci přes `deploy.sh`), které zachovají existující data.
- **Model ID jen v `packages/shared/src/models.ts`** – nikde jinde natvrdo.
- **Nikdy nemazat `Document`** kvůli regeneraci – přepisuje se na místě s verzemi (`regenerate`).

### Architektura vrstev

- Doménová rozhraní a sdílené typy v `packages/shared` (`IStorageProvider`, `IEmailProvider`, prompty, modely).
- Volání Claude a parsování výstupu v `packages/ocr`; DB přístup, billing a verzování v `packages/db`.
- API routes a worker handlery volají Prismu napřímo; sdílená logika patří do `packages/*`,
  ne do kopie ve webu i workeru.

---

## Plánovaný vývoj

- **Upgrade modelů** (Claude 5 – Opus/Sonnet/Haiku 5.5), structured outputs, Batch API a prompt
  caching – viz sekce „Příležitosti OCR/LLM" v `CODE-REVIEW-2026-10-14.md`. Předpoklad: zlatý
  vzorek stránek pro měření kvality.
- **Ensemble OCR / Transkribus / Kraken** – zatím neimplementováno, viz [docs/ocr-engines.md](docs/ocr-engines.md).
- **Export** – PDF/DOCX s paralelním zobrazením originálu a překladu.

> Prompty: [docs/prompts.md](docs/prompts.md) (zdroj pravdy je `packages/shared/src/prompts.ts`) ·
> Testovací data: [docs/test-data.md](docs/test-data.md)
