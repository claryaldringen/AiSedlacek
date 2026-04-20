# CLI klient (`ais`) — Design Spec

**Datum:** 2026-04-20
**Autor:** Martin + Claude

## Účel

CLI klient pro čtečku starých textů, který umožní uživatelům využít vlastní Claude Code subscription pro OCR zpracování. CLI komunikuje se serverem na Hetzneru pro persistenci dat a se lokálním `claude` CLI pro OCR.

## Klíčová rozhodnutí

- **Architektura:** Nový `apps/cli` balíček v monorepu, importuje z `packages/ocr`, `packages/shared`
- **OCR transport:** Lokálně přes `claude` CLI subprocess (uživatelův subscription)
- **Persistance:** Server (Hetzner) — CLI je klient, ne standalone nástroj
- **Editace:** Pull/push model s lokálními soubory v `.ais-workspace/` (Claude Code friendly)
- **Auth:** OAuth browser flow → dlouhodobý API token
- **Upload:** Primárně URL (obrázky z online knihoven), sekundárně lokální soubory

---

## Příkazy

### Autentizace

```
ais login           # OAuth browser flow → token do ~/.config/ai-sedlacek/auth.json
ais logout          # Smaže lokální token + revokuje na serveru
ais whoami          # Info o přihlášeném uživateli
```

### Kolekce

```
ais collections                    # Seznam kolekcí
ais collections create "Název"     # Nová kolekce
ais collections delete <id>
```

### Upload

```
ais upload https://digitalniknihovna.cz/scan1.jpg       # URL (server stáhne)
ais upload https://example.com/a.jpg https://example.com/b.jpg
ais upload urls.txt                                       # Soubor se seznamem URL
ais upload foto.jpg                                       # Lokální soubor (multipart)
ais upload *.jpg --collection <id>                        # Do konkrétní kolekce
```

**Flow pro URL:**
1. CLI pošle URL na server (`POST /api/pages/upload-url`)
2. Server stáhne obrázek, uloží do storage, vytvoří Page (status: `pending`)
3. Vrátí `pageId`

**Flow pro lokální soubor:**
1. CLI pošle multipart na server (`POST /api/pages/upload`)
2. Stejný endpoint jako web

### OCR zpracování

```
ais process <pageId...>            # Zpracuj konkrétní stránky
ais process --collection <id>      # Zpracuj celou kolekci
ais process --all                  # Zpracuj vše s status=pending
```

**Flow:**
1. CLI načte metadata stránek ze serveru (`GET /api/pages/:id`)
2. Stáhne obrázky, které nemá lokálně (`GET /api/images/...`)
3. Sharp resize pokud > 5 MB (reuse `packages/ocr/prepare-image.ts`)
4. Pro každou stránku spustí `claude` CLI subprocess:
   - Předá obrázek jako temp soubor
   - System prompt + JSON schema z `packages/shared/prompts.ts`
   - Parsuje strukturovaný JSON výstup přes `packages/ocr/parse.ts`
5. Pošle výsledky na server: `POST /api/pages/:id/result`
6. Server uloží Document + Translation + GlossaryEntry + DocumentVersion (source: `ai_initial`)
7. CLI vypíše progress: `[2/3] Stránka #43 hotová (de-old → cs)`

**Reuse z `packages/ocr`:**
- `processWithClaudeBatchCli()` — subprocess management
- `prepareImage()` — Sharp resize
- `parseOcrResponse()` — JSON parsing z LLM výstupu
- Prompty z `packages/shared/prompts.ts`

**Chybové stavy:**
- `claude` CLI není nainstalované → srozumitelná chyba s odkazem na instalaci
- Timeout / selhání Claude → stránka zůstane `pending`, CLI reportuje chybu
- Server nedostupný po OCR → výsledky se uloží lokálně do `.ais-workspace/`, push při dalším `ais push`

### Prohlížení

```
ais list                           # Stránky (tabulka: id, název, status, kolekce)
ais list --collection <id>
ais show <pageId>                  # Transkripce + překlad + kontext + glosář
```

### Editace (pull/push)

```
ais pull <pageId...>               # Stáhne do .ais-workspace/<id>/
ais pull --collection <id>         # Stáhne celou kolekci
ais push                           # Pushne všechny změněné soubory
ais push <pageId>                  # Pushne konkrétní stránku
ais diff                           # Ukáže co se lokálně změnilo vs server
ais diff <pageId>                  # Konkrétní stránka
```

**Pull:**
1. CLI stáhne ze serveru: transkripci, překlad, kontext, glosář, metadata
2. Vytvoří/aktualizuje lokální soubory:
   ```
   .ais-workspace/
   └── 42/
       ├── transcription.md
       ├── translation.md
       ├── context.md
       ├── glossary.md          # term: definition (po řádcích)
       └── .meta.json           # { documentId, pageId, serverVersion, pulledAt, hashes }
   ```
3. `.meta.json` uchovává SHA256 hashe souborů v momentě pullu — pro detekci lokálních změn

**Push:**
1. CLI porovná aktuální hash souborů s hashy v `.meta.json`
2. Změněné soubory pošle na server (`PATCH /api/documents/:id`)
3. Server vytvoří DocumentVersion (source: `manual_edit`)
4. CLI aktualizuje `.meta.json` s novými hashy

**Konflikty:**
Pokud se dokument změnil na serveru od posledního pullu, `ais push` odmítne push:
```
Konflikt: stránka #42 se změnila na serveru od posledního pull.
Spusť `ais pull 42` pro stažení aktuální verze, nebo `ais push 42 --force` pro přepsání.
```

---

## Autentizace

### OAuth browser flow

1. CLI vygeneruje náhodný `state` + `code_verifier` (PKCE)
2. Spustí lokální HTTP server na `localhost:<random-port>`
3. Otevře prohlížeč na `https://sedlacek.ai/auth/cli?state=...&redirect=http://localhost:<port>/callback`
4. Uživatel se přihlásí (nebo už je přihlášený) → server přesměruje zpět na localhost s auth kódem
5. CLI vymění kód za dlouhodobý API token (`POST /api/auth/cli/token`)
6. Token se uloží do `~/.config/ai-sedlacek/auth.json`
7. Lokální HTTP server se ukončí

### Token management

- Token je dlouhodobý (nevyprší, dokud ho uživatel nerevokuje)
- `ais logout` smaže lokální token + revokuje na serveru
- Každý CLI request posílá token v `Authorization: Bearer <token>` hlavičce

---

## Struktura `apps/cli`

```
apps/cli/
├── src/
│   ├── index.ts              # Entry point, Commander setup
│   ├── bin.ts                # #!/usr/bin/env node shebang
│   ├── commands/
│   │   ├── login.ts          # OAuth browser flow
│   │   ├── logout.ts
│   │   ├── whoami.ts
│   │   ├── upload.ts         # Lokální soubory + URL
│   │   ├── process.ts        # Lokální OCR přes claude CLI
│   │   ├── list.ts           # Seznam stránek/kolekcí
│   │   ├── show.ts           # Detail stránky
│   │   ├── pull.ts           # Stažení do workspace
│   │   ├── push.ts           # Upload změn na server
│   │   ├── diff.ts           # Lokální změny vs server
│   │   └── collections.ts    # CRUD kolekcí
│   ├── lib/
│   │   ├── api-client.ts     # HTTP klient (fetch + auth header)
│   │   ├── auth.ts           # Token storage (~/.config/ai-sedlacek/auth.json)
│   │   ├── workspace.ts      # .ais-workspace/ management, hash tracking
│   │   └── output.ts         # Formátování výstupu (tabulky, progress, barvy)
├── package.json
└── tsconfig.json
```

### Dependencies

- `commander` — CLI framework
- `open` — otevření prohlížeče pro OAuth
- `chalk` — barvy v terminálu
- `cli-table3` — tabulkový výstup
- `ora` — spinner pro progress
- `@ai-sedlacek/ocr` — lokální OCR pipeline
- `@ai-sedlacek/shared` — typy, prompty

### Build & distribuce

- Turborepo buildí `apps/cli` spolu s ostatními
- `tsup` pro bundle do jednoho souboru
- `package.json` s `"bin": { "ais": "./dist/bin.js" }`
- Instalace: `npm install -g @ai-sedlacek/cli` (až se publikuje na npm)
- Do té doby: `npm link` z monorepa

---

## Změny na serveru

### Nové API endpointy

| Metoda | Endpoint | Popis |
|--------|----------|-------|
| POST | `/api/pages/upload-url` | Přijme `{ urls[], collectionId? }`, server stáhne obrázky |
| POST | `/api/pages/:id/result` | Přijme OCR výsledky z CLI, uloží Document + Translation + Glossary + Version |
| POST | `/api/auth/cli/token` | Výměna auth kódu za API token |
| DELETE | `/api/auth/cli/token` | Revokace tokenu |
| GET | `/api/auth/cli/me` | Info o přihlášeném uživateli |

### Nový DB model

```prisma
model ApiToken {
  id          String   @id @default(cuid())
  userId      String
  user        User     @relation(fields: [userId], references: [id])
  tokenHash   String   @unique    // SHA256 hash tokenu
  name        String   @default("CLI")
  lastUsedAt  DateTime?
  createdAt   DateTime @default(now())
}
```

### Nová stránka

- `/auth/cli` — minimální UI: "Aplikace AIS CLI žádá přístup k vašemu účtu" + tlačítko "Povolit" → redirect zpět na localhost callback

### Auth middleware úprava

Stávající auth (NextAuth) funguje přes session cookies. Pro CLI rozšíření o `Authorization: Bearer <token>` — middleware zkontroluje hlavičku, najde ApiToken v DB, resolví uživatele. Utility `resolveUser(request)` zkusí session i API token.

---

## Upload URL flow — detaily

### Endpoint `POST /api/pages/upload-url`

```typescript
// Request
{
  urls: string[],          // URL obrázků ke stažení
  collectionId?: string    // Volitelná kolekce
}

// Response
{
  pages: Array<{ id: string, filename: string, status: string }>,
  errors: Array<{ url: string, error: string }>
}
```

**Server-side flow:**
1. Validace URL (HTTP/HTTPS, rozumná délka)
2. Pro každou URL:
   - `fetch(url)` s timeout 30s
   - Validace MIME type (jpeg, png, tiff, webp)
   - Validace velikosti (max 20 MB)
   - SHA256 hash pro dedup
   - Uložení do storage
   - Vytvoření Page (status: `pending`)
3. Vrátí výsledky + chyby

---

## Lokální workspace — `.ais-workspace/`

### `.meta.json` formát

```json
{
  "documentId": "clx123...",
  "pageId": "clx456...",
  "serverVersion": 3,
  "pulledAt": "2026-04-20T10:30:00Z",
  "hashes": {
    "transcription.md": "sha256:abc123...",
    "translation.md": "sha256:def456...",
    "context.md": "sha256:789ghi...",
    "glossary.md": "sha256:jkl012..."
  }
}
```

### `.ais-config.json` (v rootu workspace)

```json
{
  "server": "https://sedlacek.ai"
}
```

### `.gitignore`

`.ais-workspace/` by měl být v `.gitignore` — obsahuje stažená data, ne zdrojový kód.
