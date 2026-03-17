# Čtečka starých textů – CLAUDE.md

## Účel projektu

Webová aplikace pro čtení a překlad historických rukopisů. Uživatel nahraje sken/fotografii
dokumentu a aplikace provede:

1. **OCR + překlad** – Claude Vision Opus přečte text z obrázku a přeloží ho do moderního jazyka
2. **Kontext** – automatický historický kontext k dokumentu
3. **Glosář** – vysvětlení archaických a odborných termínů
4. **Verzování** – každá úprava se ukládá, lze obnovit předchozí verze

Primární jazyky zdrojových textů: **stará horní němčina**, **staročeština**, **latina**.

---

## Technologický stack

- **Frontend:** Next.js 15 (App Router), React 19, Tailwind CSS v4
- **Backend:** Next.js API Routes (serverless na Vercelu)
- **Databáze:** PostgreSQL + Prisma ORM
- **OCR + překlad:** Claude Opus 4.6 (multimodální – obrázek + prompt → transkripce + překlad + kontext + glosář v jednom volání)
- **Retranslace:** Claude Sonnet 4.6 (inkrementální aktualizace překladu po editaci transkripce)
- **Úložiště souborů:** Lokální filesystem (`tmp/uploads/`) – plánovaná migrace na Vercel Blob
- **Preprocessing obrázků:** Sharp (resize pro API limit 5 MB)
- **Komunikace:** REST API + Server-Sent Events (SSE) pro streaming průběhu zpracování
- **Monorepo:** Turborepo (apps/web + packages/shared)

---

## Aktuální architektura

### Zpracování dokumentu (aktuální pipeline)

```
Uživatel nahraje obrázek(y)
        │
        ▼
POST /api/pages/upload
  → validace (JPEG, PNG, TIFF, WebP; max 20 MB)
  → SHA256 hash pro detekci duplikátů
  → uložení na disk (tmp/uploads/)
  → zápis do DB (Page, status: "pending")
        │
        ▼
POST /api/pages/process  (SSE stream)
  → pro každou stránku:
    1. Načtení obrázku z disku
    2. Kontrola duplicit (hash → existující Document)
    3. Sharp resize pokud > 5 MB (max 3000px → 2000px)
    4. Claude Opus 4.6 (streaming):
       - System prompt: paleografie expert
       - Input: obrázek (base64) + "Přepiš text z tohoto rukopisu."
       - Output: JSON { transcription, detectedLanguage,
                        translation, translationLanguage,
                        context, glossary[] }
    5. Uložení do DB: Document + Translation + GlossaryEntry[]
    6. Uložení počátečních verzí (DocumentVersion)
    7. SSE events: page_progress, page_done, page_error
        │
        ▼
Zobrazení v DocumentPanel
  → obrázek vlevo, text vpravo
  → editovatelná transkripce, překlad, kontext
  → automatická retranslace po editaci transkripce
     (POST /api/documents/[id]/retranslate → Claude Sonnet 4.6)
  → historie verzí s možností obnovení
```

### Klíčové vlastnosti UI

- **Správa kolekcí** – seskupování stránek do složek, drag & drop
- **Grid/List pohled** – přepínání zobrazení, thumbnail preview
- **Klávesové zkratky** – Ctrl+A, šipky, Shift+klik, Delete, Escape, Enter
- **Dávkové zpracování** – výběr více stránek → hromadné OCR s progress barem
- **Inline editace** – markdown editor pro transkripci, překlad, kontext
- **Retranslace** – editace transkripce automaticky aktualizuje překlad (inkrementálně)
- **Verzování** – každá změna ukládá předchozí stav, seskupené podle pole
- **Hash cache** – stejný obrázek (dle SHA256) se nezpracovává znovu

---

## Datový model (Prisma / PostgreSQL)

```
Collection  1──N  Page  1──1  Document  1──N  Translation
                                 │
                                 ├──N  GlossaryEntry
                                 └──N  DocumentVersion
```

| Model | Klíčová pole | Popis |
|-------|-------------|-------|
| **Collection** | name, description | Složka pro organizaci stránek |
| **Page** | filename, hash, imageUrl, status, mimeType, fileSize, width, height | Nahraný obrázek. Status: pending → processing → done/error |
| **Document** | transcription, detectedLanguage, context, model, inputTokens, outputTokens, processingTimeMs | Výsledek OCR. Unikátní hash (1 dokument na obrázek) |
| **Translation** | language, text, model, inputTokens, outputTokens | Překlad. Unikátní [documentId, language] |
| **DocumentVersion** | version, field, content, source, model | Audit trail. Source: ai_initial, ai_retranslate, ai_regenerate, manual_edit |
| **GlossaryEntry** | term, definition | Vysvětlení archaických termínů |

---

## API endpointy

### Pages
| Metoda | Endpoint | Popis |
|--------|----------|-------|
| GET | `/api/pages` | Seznam stránek (volitelný `?collectionId=`) |
| GET | `/api/pages/[id]` | Detail stránky s dokumentem |
| PATCH | `/api/pages/[id]` | Aktualizace (collectionId, order, status) |
| DELETE | `/api/pages/[id]` | Smazání stránky a souboru |
| POST | `/api/pages/upload` | Nahrání souborů (multipart) |
| POST | `/api/pages/process` | Dávkové OCR zpracování (SSE stream) |

### Documents
| Metoda | Endpoint | Popis |
|--------|----------|-------|
| GET | `/api/documents/[id]` | Detail s překlady a glosářem |
| PATCH | `/api/documents/[id]` | Editace transkripce/překladu/kontextu |
| DELETE | `/api/documents/[id]` | Smazání dokumentu |
| POST | `/api/documents/[id]/retranslate` | Přegenerování překladu (Claude Sonnet) |
| GET | `/api/documents/[id]/versions` | Historie verzí |

### Collections
| Metoda | Endpoint | Popis |
|--------|----------|-------|
| GET | `/api/collections` | Seznam kolekcí s počtem stránek |
| POST | `/api/collections` | Vytvoření kolekce |
| GET | `/api/collections/[id]` | Detail kolekce se stránkami |
| PATCH | `/api/collections/[id]` | Aktualizace názvu/popisu |
| DELETE | `/api/collections/[id]` | Smazání kolekce (stránky zůstanou) |

### Ostatní
| Metoda | Endpoint | Popis |
|--------|----------|-------|
| GET | `/api/images/[...path]` | Servírování obrázků z tmp/uploads/ |

---

## Struktura projektu

```
├── packages/
│   └── shared/                          # Sdílené typy, rozhraní, prompty
│       └── src/
│           ├── domain/
│           │   ├── ocr-engine.ts        # IOcrEngine rozhraní (pro budoucí ensemble)
│           │   ├── translator.ts        # ITranslator rozhraní
│           │   ├── preprocessor.ts      # IPreprocessor rozhraní
│           │   ├── classifier.ts        # ILayoutClassifier rozhraní
│           │   └── storage.ts           # IStorageProvider rozhraní
│           ├── types.ts                 # Sdílené TypeScript typy
│           ├── prompts.ts               # LLM prompty (klasifikace, konsolidace, překlad)
│           └── index.ts                 # Barrel export
│
├── apps/
│   └── web/                             # Next.js → Vercel
│       ├── app/
│       │   ├── page.tsx                 # Hlavní stránka – správa kolekcí + stránek
│       │   ├── layout.tsx               # Root layout
│       │   └── api/                     # API routes (viz sekce API endpointy)
│       │       ├── pages/               # CRUD stránek + upload + processing
│       │       ├── documents/           # CRUD dokumentů + retranslate + versions
│       │       ├── collections/         # CRUD kolekcí
│       │       └── images/              # Servírování obrázků
│       ├── lib/
│       │   ├── adapters/
│       │   │   ├── ocr/
│       │   │   │   └── claude-vision.ts # processWithClaude() – OCR + překlad v jednom
│       │   │   └── storage/
│       │   │       └── local-storage.ts # Lokální filesystem storage
│       │   └── infrastructure/
│       │       ├── db.ts                # Prisma client singleton
│       │       └── versioning.ts        # createVersion() – auto-increment per document
│       ├── components/
│       │   ├── AppShell.tsx             # Hlavní layout wrapper
│       │   ├── Toolbar.tsx              # Horní lišta (upload, process, view toggle)
│       │   ├── Sidebar.tsx              # Kolekce v levém panelu
│       │   ├── FileGrid.tsx             # Grid zobrazení stránek (drag-drop, context menu)
│       │   ├── FileList.tsx             # Tabulkové zobrazení
│       │   ├── FileUploadZone.tsx       # Modální upload s drag-drop a preview
│       │   ├── DocumentPanel.tsx        # Boční panel – obrázek + text
│       │   ├── ResultViewer.tsx         # Transkripce + překlad + kontext + glosář + verze
│       │   ├── VersionHistory.tsx       # Historie verzí s restore
│       │   ├── MarkdownEditor.tsx       # Inline markdown editor
│       │   ├── Breadcrumbs.tsx          # Navigační drobečky
│       │   ├── ContextMenu.tsx          # Kontextové menu (pravý klik)
│       ├── hooks/
│       │   └── useDesktopSelection.ts   # Multi-select s range selection
│       ├── prisma/
│       │   └── schema.prisma            # Databázové schéma
│       └── package.json
│
├── docs/                                # Podrobná dokumentace
│   ├── prompts.md                       # LLM prompty
│   ├── ocr-engines.md                   # OCR enginy – plán pro ensemble
│   ├── api-integration.md               # Plánované API integrace
│   └── test-data.md                     # Zdroje testovacích dat
│
├── turbo.json                           # Turborepo pipeline
├── tsconfig.base.json                   # Sdílená TS konfigurace (strict)
├── eslint.config.mjs                    # ESLint
├── .prettierrc                          # Prettier
└── package.json                         # Root workspace
```

---

## Proměnné prostředí

```env
# === apps/web (.env.local) ===

# --- Databáze (povinné) ---
DATABASE_URL=postgresql://user:password@localhost:5432/ai_sedlacek

# --- Claude API (povinné pro produkci) ---
ANTHROPIC_API_KEY=sk-ant-...

# --- Přepínání providerů ---
# LLM_PROVIDER=ollama                   # dev (default pokud ANTHROPIC_API_KEY chybí)
# LLM_PROVIDER=claude                   # produkce
# STORAGE_PROVIDER=local                # dev (default pokud BLOB_READ_WRITE_TOKEN chybí)
# STORAGE_PROVIDER=vercel-blob          # produkce (plánováno)

# --- Volitelné ---
MAX_FILE_SIZE_MB=20
```

### Logika výběru provideru

V `container.ts`:

1. Pokud `LLM_PROVIDER` je explicitně nastavena → použij ji
2. Pokud není nastavena a `ANTHROPIC_API_KEY` existuje → `claude`
3. Pokud není nastavena a `ANTHROPIC_API_KEY` neexistuje → `ollama`
4. Pokud `LLM_PROVIDER=claude` ale `ANTHROPIC_API_KEY` chybí → chyba při startu

---

## Spuštění

```bash
# === Lokální vývoj ===

npm install                              # Root workspace (Turborepo)
npx prisma generate --schema=apps/web/prisma/schema.prisma  # Generování Prisma klienta
npx prisma migrate dev --schema=apps/web/prisma/schema.prisma  # Migrace DB
npx turbo dev                            # Next.js dev server na :3000

# === Validace ===

npx turbo typecheck && npx turbo lint && npx turbo format:check && npx turbo test

# === Deployment ===

vercel --prod                            # Nebo automaticky z Git push
```

---

## Claude Code – workflow

### Pravidla pro Claude Code

- **Vždy čti celý CLAUDE.md** před začátkem práce na jakémkoliv úkolu.
- **Ptej se před implementací**, pokud úkol vyžaduje architektonické rozhodnutí.
- **Commity v češtině**, konvenční formát: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`.
- **Žádné hardcoded API klíče.** Vše přes proměnné prostředí.
- **Loguj každý krok pipeline** – model, čas zpracování, tokeny.

### Clean Architecture

Domain rozhraní v `packages/shared/domain/`, adaptéry v `apps/web/lib/adapters/`.

```
Vrstva              │ Obsah                          │ Pravidla
────────────────────┼────────────────────────────────┼─────────────────────────────
Domain (jádro)      │ IOcrEngine, ITranslator,       │ Žádné závislosti na vnějším
                    │ IPreprocessor, ILayoutClassifier│ světě. Čisté TypeScript typy.
────────────────────┼────────────────────────────────┼─────────────────────────────
Adapters            │ claude-vision.ts,              │ Implementuje Domain rozhraní.
                    │ sharp.ts, local-storage.ts     │ Každý adapter = 1 soubor.
────────────────────┼────────────────────────────────┼─────────────────────────────
Infrastructure      │ container.ts, db.ts,           │ DI kontejner, Prisma client,
                    │ versioning.ts, Next.js routes   │ composition root.
```

### Validace po každé změně

```bash
npx turbo typecheck && npx turbo lint && npx turbo format:check && npx turbo test
```

---

## Plánovaný vývoj

### Ensemble OCR (Fáze 2)

Cíl: Přidat více OCR enginů pro zvýšení přesnosti (30–50 % snížení chybovosti).
Konsolidace výstupů z více enginů pomocí multimodální LLM korekce (obrázek + OCR texty).

Plánované enginy:
- **Transkribus API** – specializovaný HTR pro historické texty (~0.02 €/stránka)
- **Tesseract.js** – open source, v prohlížeči (zdarma)
- **Claude Vision** – již implementováno jako samostatný engine

Prompty pro konsolidaci a ensemble jsou připraveny v `packages/shared/src/prompts.ts`.
Domain rozhraní (`IOcrEngine`, `ITranslator`) jsou definována v `packages/shared/src/domain/`.

> Detaily: [docs/ocr-engines.md](docs/ocr-engines.md), [docs/api-integration.md](docs/api-integration.md)

### Tier 2 – Kraken segmentace (Fáze 3)

Pro složité layouty (marginální glosy, více sloupců): Kraken v Docker kontejneru
na VPS pro segmentaci stránky na řádky.

> Detaily: [docs/ocr-engines.md](docs/ocr-engines.md)

### Další plánovaná vylepšení

- **Vercel Blob storage** – nahrazení lokálního filesystemu
- **Ollama dev mode** – lokální LLM pro vývoj bez API klíče
- **Export** – PDF/DOCX s paralelním zobrazením originálu a překladu
- **Vlastní Transkribus/Kraken modely** – trénování na specifických rukopisech
- **Adaptivní tier routing** – automatický výběr OCR strategie
- **WebSocket progress** – real-time průběh pro Tier 2

> Kompletní LLM prompty: [docs/prompts.md](docs/prompts.md)
>
> Zdroje testovacích dat: [docs/test-data.md](docs/test-data.md)
