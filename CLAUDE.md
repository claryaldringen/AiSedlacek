# Čtečka starých textů – CLAUDE.md

## Účel projektu

Webová aplikace pro čtení a překlad středověkých textů. Uživatel nahraje sken/fotografii historického dokumentu a aplikace provede:

1. **OCR** – rozpoznání textu z obrázku (ensemble přístup s více enginy)
2. **Konsolidace** – inteligentní sloučení výstupů z více OCR enginů pomocí LLM
3. **Doslovný překlad** – věrný překlad do moderní češtiny/němčiny zachovávající strukturu originálu
4. **Učesaný překlad** – plynulý, čtivý překlad do moderního jazyka

Primární jazyky zdrojových textů: **stará horní němčina**, **staročeština**, **latina**.

---

## Technologický stack

- **Frontend:** Next.js na Vercelu (App Router, React, Tailwind CSS)
- **Backend / OCR worker:** Node.js + TypeScript na VPS (Express nebo Fastify)
- **OCR Tier 1 (vždy):** Transkribus API + Tesseract.js + Claude Vision – tříenginový ensemble
- **OCR Tier 2 (podmíněný):** Kraken v Docker kontejneru – segmentace pro složité layouty
- **Preprocessing obrázků:** Sharp (na VPS worker)
- **Analýza layoutu:** Claude Vision API (klasifikace dokumentu → výběr OCR tieru)
- **LLM (produkce):** Claude API přes Anthropic TypeScript SDK (Vision OCR, klasifikace, konsolidace, překlady)
- **LLM (dev):** Ollama (llama3.2-vision:11b pro vision úlohy, qwen2.5:14b pro textové úlohy)
- **Úložiště souborů:** Vercel Blob (produkce) nebo lokální filesystem (dev)
- **Kontejnerizace:** Docker + docker-compose na VPS (Kraken + OCR worker)
- **Komunikace frontend ↔ backend:** REST API + Server-Sent Events (SSE) pro streaming průběhu

---

## Deployment

### Primární platforma: Vercel (Tier 1)

Díky Fluid Compute (2025+) je Vercel dostatečný pro celý Tier 1. Klíčová změna:
Fluid Compute počítá jen skutečný CPU čas – čekání na I/O (Transkribus API,
Claude API) se nepočítá. Protože naše pipeline je z 95 % čekání na externí API,
reálná spotřeba CPU je minimální i při celkové době běhu 2–3 minuty.

| Omezení Vercelu | Hodnota (Fluid Compute) | Řešení pro náš projekt |
|---|---|---|
| Request body limit | 4.5 MB | Nahrávání přes Vercel Blob (klient → Blob přímo) |
| Funkce max velikost | 250 MB | Tesseract.js běží v prohlížeči, ne na serveru → žádný WASM v bundlu |
| Timeout (Hobby) | 300s default | Pipeline Tier 1 = ~60–120s čistého I/O wait → OK |
| Timeout (Pro) | 300s default, max 800s | Komfortní rezerva |
| Žádný Docker | – | Kraken nepojede → Tier 2 vyžaduje VPS |
| Žádné GPU | – | Nepotřebujeme (Transkribus i Claude jsou cloud API) |

### Architektura – čistý Vercel (Tier 1)

```
┌──────────────────────────────────────────────────────────┐
│                       VERCEL                              │
│                                                           │
│  Next.js App (App Router)                                 │
│                                                           │
│  KLIENT (prohlížeč):                                      │
│  ├── FileUpload → Vercel Blob (přímý upload, žádné proxy) │
│  ├── Tesseract.js Web Worker (OCR engine #3)              │
│  │   └── Modely deu_frak+ces+lat (stáhnuty při 1. použití,│
│  │       cacheované v IndexedDB)                           │
│  ├── ResultViewer (4 sloupce, streaming aktualizace)      │
│  └── SSE/RSC listener pro průběh server-side kroků        │
│                                                           │
│  SERVER (Vercel Functions + Fluid Compute):                │
│  ├── POST /api/process                                    │
│  │    1. Stáhne obrázek z Vercel Blob                     │
│  │    2. Sharp preprocessing (v serverless funkci)         │
│  │    3. Claude Vision → klasifikace layoutu               │
│  │    4. Paralelně:                                        │
│  │       ├── Transkribus API → OCR výstup A               │
│  │       └── Claude Vision → OCR výstup B                 │
│  │    5. Čeká na Tesseract.js výsledek z klienta (C)      │
│  │    6. Claude Opus → multimodální konsolidace + překlad  │
│  │    7. Claude Opus → učesaný překlad                     │
│  │    8. Vrátí kompletní výsledek                          │
│  │                                                         │
│  └── Vercel Blob Storage                                   │
│       └── Nahrané obrázky (auto-expiry po 24h)            │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

#### Tok dat pro Tesseract.js (klient-side)

Tesseract.js běží v prohlížeči jako Web Worker, aby neblokoval UI a obešel
Vercel bundle limit. Workflow:

1. Klient nahraje obrázek → Vercel Blob (získá URL)
2. Klient spustí Tesseract.js na obrázku lokálně (paralelně s POST /api/process)
3. Klient pošle Tesseract výsledek na server jako součást požadavku nebo
   follow-up voláním POST /api/process/:id/tesseract-result
4. Server čeká na všechny 3 výstupy (Transkribus + Claude Vision + Tesseract z klienta)
5. Konsolidace běží na serveru

Tesseract.js modely se cacheují v IndexedDB prohlížeče – stahují se jen při
prvním použití (~30 MB pro deu_frak+ces+lat).

### Rozšíření o VPS (Tier 2) – jen když je potřeba

VPS se přidá pouze pokud potřebuješ Kraken pro složité layouty. Vercel zůstává
jako frontend, VPS přidá jednu službu navíc.

```
┌──────────────────────────────────────────────────────────┐
│                       VERCEL                              │
│  (beze změny – stejný kód jako Tier 1)                   │
│  Tier router: pokud classification.tier === 'tier2',      │
│  přesměruj na VPS worker místo lokálního zpracování       │
└─────────────────────────┬────────────────────────────────┘
                          │ HTTPS (jen Tier 2 requesty)
                          ▼
┌──────────────────────────────────────────────────────────┐
│                       VPS                                 │
│              (jen pro Tier 2, Docker Compose)             │
│                                                           │
│  ┌───────────────────────────────────────────────┐       │
│  │  OCR Worker (Node.js)                         │       │
│  │  └── Kraken segmentace → 3 enginy na řádky    │       │
│  └───────────────────────────────────────────────┘       │
│  ┌───────────────────────────────────────────────┐       │
│  │  Kraken (Python + Flask)                      │       │
│  │  └── /segment, /recognize                     │       │
│  └───────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────┘
```

### Kdy přidat VPS

Nepřidávej VPS preventivně. Přidej ho teprve když:
- Pravidelně zpracováváš rukopisy se složitým layoutem (glosy, více sloupců)
- Tier 1 ensemble nestačí na segmentaci (text z okrajových gloss se míchá)
- Potřebuješ trénovat vlastní Kraken modely na specifickém písmu

### Náklady

| Komponenta | Hobby (zdarma) | Pro ($20/měs) |
|---|---|---|
| Vercel hosting | Zdarma (100 GB bandwidth) | Zdarma v rámci Pro |
| Vercel Blob | 1 GB zdarma | Included |
| Transkribus | 50 stránek/měs zdarma | On-demand kredity dle potřeby |
| Claude API | ~$0.01–0.03 / stránka (3 volání) | Stejné |
| Tesseract.js | Zdarma (klient-side) | Zdarma |
| **VPS (volitelný)** | – | Hetzner CX22 ~€4/měs (Tier 2) |

---

## Architektura

### Dvouúrovňový OCR systém s tříenginovým ensemble

Aplikace používá dvoustupňový přístup k OCR. Každý nahraný dokument nejprve projde
rychlou klasifikací (Claude Vision), která určí složitost layoutu. Na základě toho
se vybere OCR tier. V obou tierech běží **tři OCR enginy paralelně**:

- **Tier 1 (výchozí):** Transkribus + Tesseract.js + Claude Vision paralelně –
  pro tištěné texty, jednoduché rukopisy, standardní jednosloupcový layout
- **Tier 2 (složitý layout):** Kraken (segmentace) + Transkribus + Tesseract.js
  + Claude Vision – pro rukopisy s marginálními glosami, víceúrovňovými komentáři,
  zakřivenými řádky, prokládaným textem nebo nestandardním rozložením stránky

#### Proč tři OCR enginy

Každý engine má jiné silné a slabé stránky. Ensemble přístup (voting/konsolidace)
prokazatelně snižuje chybovost o 30–50 % oproti jednomu enginu:

| Engine | Typ | Silné stránky | Slabé stránky | Cena |
|--------|-----|---------------|---------------|------|
| **Transkribus** | Specializovaný cloud HTR/OCR | Nejlepší na německé a středoevropské historické texty; 300+ předtrénovaných modelů včetně staročeské bastardy; silný na frakturu | Kreditový systém; slabší na jazycích bez specializovaného modelu; znakový bez kontextu | ~0.02 €/stránka |
| **Tesseract.js** | Open source, lokální | Zdarma; běží v Node.js; frakturový model; nezávislé chyby od ostatních enginů | Slabý na rukopisy; nemá staročeský model; vyžaduje dotrénování pro středověk | Zdarma |
| **Claude Vision** | Multimodální LLM (cloud) | Rozumí jazykovému kontextu; nízké halucinace (0.09 %); zvládá zkratky a poškozený text; nepotřebuje trénování; nejlepší na zachování layoutu | Dražší; slabší na neanglických jazycích; nedeterministický výstup | ~0.006 $/obrázek |

> Detaily o enginech, benchmarky a Kraken setup viz [docs/ocr-engines.md](docs/ocr-engines.md).

#### Kdy se aktivuje Tier 2

Automaticky (na základě klasifikace) nebo manuálně (uživatel zaškrtne "složitý layout"):
- Marginální glosy nebo interlineární poznámky
- Více textových bloků s různým směrem čtení
- Zakřivené, šikmé nebo natočené řádky
- Dekorativní iniciály zasahující do textu
- Vícejazyčný text ve směsi písem

```
┌─────────────┐
│  Nahrání     │  Uživatel nahraje obrázek/PDF skenu
│  souboru     │
└──────┬───────┘
       │
       ▼
┌─────────────┐
│ Preprocessing│  Sharp: binarizace, vyrovnání kontrastu, resize
│  obrázku    │
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│  Claude Vision API:  │  Klasifikace dokumentu:
│  Klasifikace layoutu │  → typ písma (tisk/rukopis)
└──────┬───────────────┘  → složitost layoutu (jednoduchý/složitý)
       │                   → doporučený tier (1 nebo 2)
       │
       ├─── Tier 1 ──────────────────────────────────────────┐
       │                                                      │
       │    ┌─────────────┐ ┌─────────────┐ ┌──────────────┐│
       │    │ Transkribus │ │ Tesseract.js│ │Claude Vision ││
       │    │   API       │ │             │ │  (OCR prompt) ││
       │    └──────┬──────┘ └──────┬──────┘ └──────┬───────┘│
       │           └───────────┬───┴───────────────┘         │
       │                       │                              │
       ├─── Tier 2 ────────────────────────────────┐         │
       │                                            │         │
       │    ┌─────────────┐                         │         │
       │    │   Kraken    │  Segmentace stránky     │         │
       │    │  (Docker)   │  na řádky               │         │
       │    └──────┬──────┘                         │         │
       │           │                                 │         │
       │    ┌──────┴────────┐ ┌──────────┐ ┌──────┐│         │
       │    │ Transkribus   │ │Tesseract │ │Claude││         │
       │    └──────┬────────┘ └────┬─────┘ └──┬───┘│         │
       │           └────────┬──────┴──────────┘     │         │
       │                    │                        │         │
       └────────────────────┼────────────────────────┘         │
                            │                                  │
                            ├──────────────────────────────────┘
                            ▼
             ┌───────────────────────────┐
             │  Claude API:              │
             │  Multimodální konsolidace │  Obrázek + 3 OCR výstupy →
             │  + doslovný překlad       │  konsolidovaný text + překlad
             └──────────┬────────────────┘
                        │
                        ▼
             ┌──────────────────────┐
             │  Claude API:         │
             │  Učesaný překlad     │  Plynulý moderní překlad
             └──────────┬───────────┘
                        │
                        ▼
             ┌──────────────────────┐
             │  Zobrazení           │  Všechny vrstvy vedle sebe:
             │  výsledků            │  originál | OCR text | doslovný | učesaný
             └──────────────────────┘
```

**Klíčový detail:** Konsolidační krok je **multimodální** – Claude dostane nejen tři textové
OCR výstupy, ale i originální obrázek. Studie ukazují, že multimodální post-korekce
(obrázek + OCR) dramaticky snižuje chybovost oproti čistě textové korekci.

---

## Struktura projektu

Vercel-first architektura. Veškerá Tier 1 logika běží na Vercelu (server-side)
a v prohlížeči (Tesseract.js). VPS složka existuje, ale aktivuje se až s Tier 2.

```
├── packages/
│   └── shared/                         # Sdílené typy, rozhraní, konstanty
│       ├── domain/
│       │   ├── ocr-engine.ts           # IOcrEngine rozhraní
│       │   ├── translator.ts           # ITranslator rozhraní
│       │   ├── preprocessor.ts         # IPreprocessor rozhraní
│       │   └── classifier.ts           # ILayoutClassifier rozhraní
│       ├── types.ts                    # ProcessingResult, OcrEngineResult, etc.
│       └── prompts.ts                  # Všechny LLM prompty na jednom místě
│
├── apps/
│   └── web/                            # Next.js → VERCEL (celý Tier 1)
│       ├── app/
│       │   ├── page.tsx                # Hlavní stránka – nahrání + zobrazení
│       │   ├── layout.tsx              # Root layout
│       │   └── api/
│       │       ├── process/
│       │       │   └── route.ts        # Orchestrace pipeline (Fluid Compute)
│       │       ├── process/[id]/
│       │       │   ├── tesseract-result/
│       │       │   │   └── route.ts    # Přijímá Tesseract výsledek z klienta
│       │       │   └── status/
│       │       │       └── route.ts    # SSE stream průběhu
│       │       └── upload/
│       │           └── route.ts        # Vercel Blob upload handler
│       ├── lib/
│       │   ├── adapters/               # Clean Architecture – implementace rozhraní
│       │   │   ├── ocr/
│       │   │   │   ├── transkribus.ts  # TranskribusOcrEngine (produkce)
│       │   │   │   ├── claude-vision.ts # ClaudeVisionOcrEngine (produkce)
│       │   │   │   ├── ollama-vision.ts # OllamaVisionOcrEngine (dev)
│       │   │   │   └── tesseract.ts    # TesseractOcrEngine (obojí)
│       │   │   ├── llm/
│       │   │   │   ├── claude-translator.ts  # ClaudeTranslator (produkce)
│       │   │   │   ├── claude-classifier.ts  # ClaudeLayoutClassifier (produkce)
│       │   │   │   ├── ollama-translator.ts  # OllamaTranslator (dev)
│       │   │   │   └── ollama-classifier.ts  # OllamaLayoutClassifier (dev)
│       │   │   ├── storage/
│       │   │   │   ├── vercel-blob.ts  # Vercel Blob storage (produkce)
│       │   │   │   └── local-storage.ts # Lokální filesystem (dev)
│       │   │   └── preprocessing/
│       │   │       └── sharp.ts        # SharpPreprocessor
│       │   ├── use-cases/              # Clean Architecture – orchestrace
│       │   │   ├── process-document.ts # Hlavní pipeline use case
│       │   │   └── ensemble.ts         # EnsembleOrchestrator (spouští IOcrEngine[])
│       │   ├── infrastructure/         # DI, config, Vercel-specifické
│       │   │   ├── container.ts        # Composition root (registrace adapterů dle LLM_PROVIDER)
│       │   │   └── tier-router.ts      # Tier 1 lokálně vs Tier 2 → VPS
│       │   └── client/                 # Klient-side helpers
│       │       └── tesseract-worker.ts # Web Worker wrapper pro Tesseract.js
│       ├── components/
│       │   ├── FileUpload.tsx          # Drag & drop → Vercel Blob
│       │   ├── TierSelector.tsx        # Manuální volba tieru
│       │   ├── ProcessingStatus.tsx    # Real-time průběh (SSE + lokální Tesseract)
│       │   ├── ResultViewer.tsx        # 4 sloupce vedle sebe
│       │   ├── TextColumn.tsx          # Jednotlivý sloupec
│       │   └── ConfidenceHighlight.tsx
│       ├── vercel.json                 # Fluid Compute config, maxDuration
│       └── package.json
│
├── vps/                                # VOLITELNÉ – pouze pro Tier 2
│   ├── worker/
│   │   ├── src/
│   │   │   ├── server.ts              # Express server
│   │   │   ├── adapters/ocr/
│   │   │   │   ├── kraken.ts          # KrakenSegmenter
│   │   │   │   ├── transkribus.ts     # (sdílený z packages/shared nebo kopie)
│   │   │   │   └── claude-vision.ts
│   │   │   └── use-cases/
│   │   │       └── process-tier2.ts   # Tier 2 pipeline s Kraken segmentací
│   │   └── Dockerfile
│   ├── kraken/
│   │   ├── Dockerfile
│   │   ├── api.py
│   │   ├── requirements.txt
│   │   └── models/
│   └── docker-compose.yml
│
├── test-data/                          # Testovací obrázky + ground truth
├── turbo.json
└── package.json
```

### Poznámky ke struktuře

- **Vercel-first:** Veškerá Tier 1 logika je v `apps/web`. Žádný separátní worker pro Tier 1.
- **Clean Architecture:** Domain rozhraní v `packages/shared/domain/`, adaptéry v `apps/web/lib/adapters/`, use cases v `apps/web/lib/use-cases/`.
- **Tesseract.js hybridní:** Adapter v `adapters/ocr/tesseract.ts` na serveru jen přijímá výsledek z klienta. Skutečné OCR běží v `client/tesseract-worker.ts` v prohlížeči.
- **VPS složka (`vps/`)** se v repozitáři udržuje, ale je neaktivní dokud není potřeba Tier 2. Nemá vliv na Vercel deployment.

---

## Klíčové typy

```typescript
// Výběr OCR strategie
type OcrTier = 'tier1' | 'tier2';

interface DocumentClassification {
  tier: OcrTier;                     // Doporučený tier
  scriptType: 'print' | 'manuscript'; // Typ písma
  layoutComplexity: 'simple' | 'complex'; // Složitost layoutu
  detectedFeatures: string[];        // Co klasifikátor detekoval
  confidence: number;                // Spolehlivost klasifikace (0-1)
  reasoning: string;                 // Zdůvodnění volby (pro UI)
}

interface ProcessingResult {
  id: string;
  originalImage: string;             // URL nahraného obrázku
  classification: DocumentClassification; // Výsledek klasifikace
  ocrResults: OcrEngineResult[];     // Výstupy z jednotlivých OCR enginů
  consolidatedText: string;          // Konsolidovaný OCR text
  literalTranslation: string;        // Doslovný překlad
  polishedTranslation: string;       // Učesaný překlad
  detectedLanguage: string;          // Rozpoznaný jazyk originálu
  confidenceNotes: string[];         // Poznámky o nejistých místech
}

interface OcrEngineResult {
  engine: 'transkribus' | 'tesseract' | 'kraken' | 'claude_vision' | 'ollama_vision';
  role: 'recognizer' | 'segmenter';  // Kraken může sloužit jen jako segmentátor
  text: string;
  lines?: SegmentedLine[];           // Výstup segmentace (Kraken Tier 2)
  confidence?: number;
  uncertainMarkers?: string[];       // Claude Vision: místa označená jako [...] nejistá
  processingTimeMs: number;
  costUsd?: number;                  // Sledování nákladů na API volání
}

interface SegmentedLine {
  id: string;
  baseline: [number, number][];      // Souřadnice základní linie
  boundingBox: BoundingBox;
  imageSlice: Buffer;                // Výřez obrázku pro řádek
  text?: string;                     // Text po rozpoznání
}

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TranskribusConfig {
  modelId: string;      // ID veřejného modelu (např. staročeský bastarda model)
  lineDetection: boolean;
}

interface KrakenConfig {
  segmentationModel: string;   // Model pro segmentaci řádků
  recognitionModel?: string;   // Volitelný model pro rozpoznávání (pokud se nepoužívá jen segmentace)
  baseUrl: string;             // URL Docker služby (default: http://localhost:5001)
  device: 'cpu' | 'cuda';     // GPU akcelerace
}

interface OllamaConfig {
  baseUrl: string;           // default: http://localhost:11434
  visionModel: string;       // default: llama3.2-vision:11b
  textModel: string;         // default: qwen2.5:14b
  timeoutMs: number;         // default: 120000 (2 min, vision modely jsou pomalé)
}
```

---

> Kompletní LLM prompty (klasifikace, OCR, konsolidace, překlad): viz [docs/prompts.md](docs/prompts.md)

> Implementační kód a konfigurace API (Transkribus, Claude Vision, Tesseract.js, Sharp preprocessing): viz [docs/api-integration.md](docs/api-integration.md)

> Kraken Docker microservice (Dockerfile, Flask API, TypeScript klient, Tier 2 workflow): viz [docs/ocr-engines.md](docs/ocr-engines.md)

---

## Proměnné prostředí

```env
# === apps/web (.env.local) ===

# --- Přepínání providerů ---
# LLM_PROVIDER=ollama                   # dev (default pokud ANTHROPIC_API_KEY chybí)
# LLM_PROVIDER=claude                   # produkce
# STORAGE_PROVIDER=local                # dev (default pokud BLOB_READ_WRITE_TOKEN chybí)
# STORAGE_PROVIDER=vercel-blob          # produkce

# --- Ollama (dev) ---
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_VISION_MODEL=llama3.2-vision:11b
OLLAMA_TEXT_MODEL=qwen2.5:14b

# --- Claude API (produkce) ---
# ANTHROPIC_API_KEY=

# --- Transkribus (produkce) ---
# TRANSKRIBUS_EMAIL=
# TRANSKRIBUS_PASSWORD=
# TRANSKRIBUS_MODEL_ID=

# --- Vercel Blob (produkce) ---
# BLOB_READ_WRITE_TOKEN=

# --- Volitelné ---
TESSERACT_LANG=deu_frak+ces+lat        # pro klient-side info
MAX_FILE_SIZE_MB=20

# === Tier 2 VPS (volitelné, jen pokud používáš Kraken) ===
# VPS_WORKER_URL=https://ocr-worker.tvadomena.cz
# VPS_WORKER_API_KEY=                  # sdílený klíč
# KRAKEN_API_URL=http://kraken:5001    # interní Docker síť
# KRAKEN_DEVICE=cpu                    # nebo "cuda"
```

### Logika výběru provideru

Rozhodování probíhá jednou při startu aplikace v `container.ts`:

1. Pokud `LLM_PROVIDER` je explicitně nastavena → použij ji
2. Pokud `LLM_PROVIDER` není nastavena a `ANTHROPIC_API_KEY` existuje → `claude`
3. Pokud `LLM_PROVIDER` není nastavena a `ANTHROPIC_API_KEY` neexistuje → `ollama`
4. Pokud `LLM_PROVIDER=claude` ale `ANTHROPIC_API_KEY` chybí → chyba při startu (fail fast)

Analogická logika pro `STORAGE_PROVIDER` / `BLOB_READ_WRITE_TOKEN`.

---

## Spuštění

```bash
# === Lokální vývoj (Tier 1, stačí pro většinu práce) ===

npm install                              # Root workspace (Turborepo)
npx turbo dev                            # Next.js dev server na :3000

# === Validace ===

npx turbo typecheck && npx turbo lint && npx turbo format:check && npx turbo test

# === Deployment (Tier 1) ===

# Automaticky z Git push (doporučeno), nebo manuálně:
vercel --prod

# === Tier 2 – lokální vývoj s Krakenem (volitelné) ===

docker-compose -f vps/docker-compose.yml up -d    # Kraken + worker
npx turbo dev                                      # Frontend na :3000

# === Tier 2 – VPS deployment (volitelné) ===

ssh vps "cd /opt/ocr-worker && git pull && docker-compose up -d --build"
```

---

## Claude Code – workflow

### Pravidla pro Claude Code

- **Vždy čti celý CLAUDE.md** před začátkem práce na jakémkoliv úkolu.
- **Ptej se před implementací**, pokud úkol vyžaduje architektonické rozhodnutí, které není v CLAUDE.md popsané.
- **Jedna fáze = jeden branch.** Neimplementuj Fázi 2, dokud Fáze 1 není funkční a otestovaná.
- **Piš testy ke každému modulu.** Každý OCR wrapper, LLM klient a API endpoint musí mít alespoň základní test.
- **Commity v češtině**, konvenční formát: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`.
- **Žádné hardcoded API klíče.** Vše přes proměnné prostředí, i v testech (mockovat).
- **Loguj každý krok pipeline** – engine, čas zpracování, náklady, délka výstupu. Bez logů nelze optimalizovat ensemble.

### Clean Architecture

Projekt striktně dodržuje Clean Architecture. Každý modul (OCR engine, LLM klient,
preprocessing) musí být snadno vyměnitelný, přidatelný nebo odebratelný bez dopadu
na zbytek systému.

```
Vrstva              │ Obsah                          │ Pravidla
────────────────────┼────────────────────────────────┼─────────────────────────────
Domain (jádro)      │ Rozhraní (IOcrEngine,          │ Žádné závislosti na vnějším
                    │ ITranslator, IPreprocessor),    │ světě. Čisté TypeScript typy
                    │ entity, value objects            │ a rozhraní.
────────────────────┼────────────────────────────────┼─────────────────────────────
Use Cases           │ ProcessDocument, Consolidate,   │ Závisí pouze na Domain.
                    │ Translate, ClassifyLayout        │ Orchestruje rozhraní, neví
                    │                                 │ nic o konkrétních enginech.
────────────────────┼────────────────────────────────┼─────────────────────────────
Adapters            │ TranskribusOcrEngine,           │ Implementuje Domain rozhraní.
                    │ TesseractOcrEngine,             │ Každý adapter = 1 soubor,
                    │ ClaudeVisionOcrEngine,          │ žádné křížové závislosti
                    │ OllamaVisionOcrEngine,          │ mezi adaptery.
                    │ KrakenSegmenter,                │ DI kontejner vybírá sadu
                    │ ClaudeTranslator,               │ adapterů dle LLM_PROVIDER.
                    │ OllamaTranslator,               │
                    │ SharpPreprocessor               │
────────────────────┼────────────────────────────────┼─────────────────────────────
Infrastructure      │ Express server, Next.js routes, │ DI kontejner (tsyringe nebo
                    │ Docker config, Vercel Blob      │ manuální), env config,
                    │                                 │ composition root.
```

#### Klíčová rozhraní

```typescript
// packages/shared/domain/ocr-engine.ts
interface IOcrEngine {
  readonly name: string;
  readonly role: 'recognizer' | 'segmenter';
  isAvailable(): Promise<boolean>;
  recognize(image: Buffer, options?: OcrOptions): Promise<OcrEngineResult>;
}

// packages/shared/domain/translator.ts
interface ITranslator {
  consolidateAndTranslate(
    image: Buffer,
    ocrResults: OcrEngineResult[],
    targetLanguage: string,
  ): Promise<ConsolidationResult>;
  polish(literalTranslation: string, targetLanguage: string): Promise<string>;
}

// packages/shared/domain/preprocessor.ts
interface IPreprocessor {
  process(image: Buffer): Promise<Buffer>;
}

// packages/shared/domain/classifier.ts
interface ILayoutClassifier {
  classify(image: Buffer): Promise<DocumentClassification>;
}
```

#### Pravidla pro přidání nového OCR enginu

1. Vytvoř nový soubor v `adapters/ocr/` implementující `IOcrEngine`
2. Zaregistruj ho v composition root (DI kontejner)
3. Ensemble orchestrátor ho automaticky zapojí
4. Žádný jiný soubor se nesmí změnit (kromě registrace)

### Validace po každé změně

Po jakékoliv změně kódu Claude Code spustí validační pipeline. Pokud cokoliv
selže, opravuje tak dlouho, dokud vše neprojde.

```bash
# Spouštět v tomto pořadí po KAŽDÉ změně:

# 1. TypeScript typecheck (žádné any, striktní mode)
npx turbo typecheck

# 2. ESLint (pravidla pro clean architecture – viz .eslintrc)
npx turbo lint

# 3. Prettier (formátování)
npx turbo format:check

# 4. Testy
npx turbo test

# Pokud cokoliv selže → opravit → spustit znovu celou pipeline
# Neodevzdávat kód, dokud všechny 4 kroky neprojdou
```

#### ESLint pravidla pro Clean Architecture

```javascript
// .eslintrc.js – klíčová pravidla
{
  rules: {
    // Domain vrstva nesmí importovat z Adapters ani Infrastructure
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['*/adapters/*'], message: 'Domain nesmí importovat z Adapters' },
        { group: ['*/infrastructure/*'], message: 'Domain nesmí importovat z Infrastructure' },
      ]
    }],
    // Žádné any
    '@typescript-eslint/no-explicit-any': 'error',
    // Vždy explicitní návratové typy u public API
    '@typescript-eslint/explicit-function-return-type': ['error', {
      allowExpressions: true
    }],
  }
}
```

### Fáze 1 – Kompletní Tier 1 na Vercelu

Cíl: Plně funkční pipeline na Vercelu. Uživatel nahraje obrázek,
dostane přepis a překlad. Dev režim s Ollama, produkce s Claude API.

```
Krok 1.1: Scaffolding
- Inicializuj Turborepo monorepo (apps/web, packages/shared)
- Next.js App Router v apps/web
- packages/shared: domain rozhraní (IOcrEngine, ITranslator, IPreprocessor,
  ILayoutClassifier), typy (types.ts), prompty (prompts.ts)
- Tailwind CSS, základní layout
- Konfigurace: tsconfig (strict: true), ESLint (clean architecture pravidla),
  Prettier, Vitest
- DI kontejner s logikou výběru provideru (LLM_PROVIDER, STORAGE_PROVIDER)
- Validace: npx turbo typecheck && npx turbo lint && npx turbo format:check

Krok 1.2: Nahrávání obrázků
- Komponenta FileUpload.tsx (drag & drop, preview, validace formátu/velikosti)
- Lokální file storage adapter pro dev (tmp/uploads/)
- Podpora JPEG, PNG, TIFF, PDF (první stránka)
- IPreprocessor adapter: SharpPreprocessor (binarizace, kontrast, resize)

Krok 1.3: Ollama Vision OCR (první adapter)
- Adapter: OllamaVisionOcrEngine implementující IOcrEngine
- Ollama REST API (/api/chat s images)
- isAvailable() přes GET /api/tags s 2s timeoutem
- llama3.2-vision:11b model
- Předpoklad: ollama pull llama3.2-vision:11b
- Test: nahrát testovací obrázek, ověřit výstup

Krok 1.4: Tesseract.js v prohlížeči (druhý adapter)
- Adapter: TesseractOcrEngine implementující IOcrEngine
- Worker v prohlížeči (Web Worker pro neblokování UI)
- Načtení modelů deu_frak+ces+lat
- Indikátor stahování modelů při prvním použití
- Test: stejný obrázek

Krok 1.5: Ensemble orchestrátor
- EnsembleOrchestrator: přijímá IOcrEngine[], spouští paralelně,
  sbírá výsledky, měří časy a náklady
- Graceful degradation: pokud engine selže, pokračuj s ostatními (min. 1)
- V dev režimu 2 enginy (Ollama Vision + Tesseract), při API testování 1 engine
- Logování: který engine kolik stál a jak dlouho trval

Krok 1.6: Minimální zobrazení výsledků
- Zobrazení surového OCR výstupu z jednotlivých enginů
- Vizuální feedback loop pro ověření pipeline ještě před konsolidací

Krok 1.7: Ollama konsolidace + překlad
- Adapter: OllamaTranslator implementující ITranslator
- Multimodální konsolidace: obrázek + N OCR výstupů → llama3.2-vision:11b
- Učesaný překlad → qwen2.5:14b (čistě textová úloha)
- Parsování strukturovaného výstupu (konsolidovaný text / doslovný překlad / poznámky)
- Test: celá pipeline end-to-end (s mockovanými OCR výstupy)

Krok 1.8: Plné zobrazení výsledků
- ResultViewer.tsx: 4 sloupce (originál | OCR | doslovný | učesaný)
- ConfidenceHighlight.tsx: zvýraznění {?} míst
- ProcessingStatus.tsx: kroková indikace průběhu (který engine doběhl)
- Responzivní layout (na mobilu sloupce pod sebou)

Krok 1.9: Klasifikace a TierSelector
- Adapter: OllamaLayoutClassifier implementující ILayoutClassifier
- TierSelector.tsx: zobrazení doporučeného tieru + manuální přepínač
- V Fázi 1 Tier 2 zobrazí info "vyžaduje VPS worker" a zůstane na Tier 1

Krok 1.10: Claude adaptery (produkční)
- ClaudeVisionOcrEngine implementující IOcrEngine (Sonnet)
- ClaudeTranslator implementující ITranslator (Opus)
- ClaudeLayoutClassifier implementující ILayoutClassifier (Sonnet)
- Mock testy: ověřit správné volání Anthropic SDK bez reálného API

Krok 1.11: Transkribus adapter (produkční)
- Adapter: TranskribusOcrEngine implementující IOcrEngine
- Autentizace (token refresh)
- Asynchronní polling (process → status → výsledek)
- Mock test (žádný API klíč k dispozici)

Krok 1.12: Polish, error handling, deployment
- Error handling: graceful degradation na N-1 enginů
- Loading states pro každý engine zvlášť
- Vercel Blob storage adapter (produkční)
- Vercel deployment, ověření na reálných datech z test-data/
- README.md s instrukcemi pro lokální vývoj
```

### Fáze 2 – Tier 2 s Krakenem (volitelný VPS)

Cíl: Přidat Kraken segmentaci pro složité layouty. Vercel kód se nemění –
přidá se jen VPS worker jako alternativní processing backend pro Tier 2.

```
Krok 2.1: VPS worker scaffolding
- vps/worker: Express server v TypeScriptu
- Dockerfile, docker-compose.yml (worker + kraken)
- Sdílené domain rozhraní z packages/shared
- Health check endpoint
- Autentizace (API key sdílený s Vercel)

Krok 2.2: Kraken integrace
- vps/kraken: Dockerfile + Flask API (z CLAUDE.md sekce Kraken)
- Adapter: KrakenSegmenter implementující IOcrEngine (role: segmenter)
- Test: segmentace obrázku se složitým layoutem

Krok 2.3: Tier 2 pipeline na VPS
- Kraken segmentace → řádkové obrázky
- 3 recognizer adaptéry (Transkribus + Claude Vision + Tesseract server-side)
  paralelně na každý řádek
- Sestavení výsledků zpět do celostránkového textu
- Konsolidace + překlad (Claude API, stejné prompty jako Tier 1)

Krok 2.4: Tier router na Vercelu
- Upravit tier-router.ts: pokud tier === 'tier2' a VPS_WORKER_URL je nastavená,
  přesměruj požadavek na VPS
- SSE proxy: Vercel přeposílá SSE stream z VPS workeru do klienta
- Fallback: pokud VPS není dostupný, zůstaň na Tier 1 s upozorněním

Krok 2.5: Monitoring
- Logování: čas, náklady, chybovost pro každý adapter a tier
- Porovnání výsledků Tier 1 vs Tier 2 na stejných dokumentech
```

### Fáze 3 – Rozšíření

Cíl: Vylepšení na základě reálného používání.

```
Krok 3.1: Optimalizace na základě dat
- Analýza logů: který engine přispívá nejvíce ke konsolidaci?
- Nastavitelné váhy enginů v konfiguraci
- Případné odebrání nejslabšího enginu pro úsporu nákladů

Krok 3.2: Budoucí rozšíření
- Implementace položek ze sekce "Budoucí rozšíření" dle priority
```

> Testovací data – zdroje středověkých dokumentů a složení testovací sady: viz [docs/test-data.md](docs/test-data.md)

---

## Budoucí rozšíření

- **Dávkové zpracování** – nahrání více stránek najednou s řazením
- **Ruční korekce OCR** – inline editor pro opravu konsolidovaného textu před překladem
- **Slovník** – automatické sestavování glosáře opakujících se termínů
- **Export** – PDF/DOCX s paralelním zobrazením originálu a překladu
- **Vlastní Transkribus modely** – trénování na specifických rukopisech uživatele
- **Vlastní Kraken modely** – neřízený pretraining na neanotovaných sbírkách + dotrénování na malém vzorku
- **Adaptivní tier routing** – strojové učení na historii klasifikací pro přesnější automatický výběr tieru
- **Cache** – uložení výsledků OCR pro opakované zpracování se změněnými parametry překladu
- **WebSocket progress** – real-time průběh zpracování pro Tier 2 (segmentace → řádek po řádku)
