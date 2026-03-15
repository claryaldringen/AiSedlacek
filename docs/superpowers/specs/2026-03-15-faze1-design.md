# Fáze 1 – Design specifikace

Kompletní Tier 1 na Vercelu s Ollama dev režimem pro lokální testování bez API klíčů.

Hlavní architektura, typy, deployment a pipeline jsou definovány v [CLAUDE.md](../../../CLAUDE.md) a přidružených docs/. Tento dokument specifikuje **rozhodnutí a doplnění** přijatá během brainstormingu.

---

## 1. Přepínání providerů (Ollama / Claude API)

### Přístup: Samostatné adaptery (přístup A)

Každý LLM provider má vlastní sadu adapterů implementujících sdílená domain rozhraní (`IOcrEngine`, `ITranslator`, `ILayoutClassifier`). Přepínání probíhá v DI kontejneru na základě env proměnné.

**Důvody:**
- Respektuje pravidlo Clean Architecture "každý adapter = 1 soubor, žádné křížové závislosti"
- Ollama a Claude API mají odlišné formáty (zejména vision) – společná abstrakce by byla děravá
- Prompty jsou sdílené přes `packages/shared/prompts.ts`, duplikace je minimální

### Env proměnné

```env
# Přepínání provideru
LLM_PROVIDER=ollama              # dev
LLM_PROVIDER=claude              # produkce

# Ollama (dev)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_VISION_MODEL=llama3.2-vision:11b
OLLAMA_TEXT_MODEL=qwen2.5:14b
```

### Logika výběru provideru v DI kontejneru

Rozhodování probíhá jednou při startu aplikace v `container.ts`:

1. Pokud `LLM_PROVIDER` je explicitně nastavena → použij ji
2. Pokud `LLM_PROVIDER` není nastavena a `ANTHROPIC_API_KEY` existuje → `claude`
3. Pokud `LLM_PROVIDER` není nastavena a `ANTHROPIC_API_KEY` neexistuje → `ollama`
4. Pokud `LLM_PROVIDER=claude` ale `ANTHROPIC_API_KEY` chybí → chyba při startu (fail fast)

### Mapování modelů

| Úloha | Ollama (dev) | Claude API (produkce) |
|---|---|---|
| Vision OCR | llama3.2-vision:11b | Claude Sonnet |
| Klasifikace layoutu | llama3.2-vision:11b | Claude Sonnet |
| Konsolidace + doslovný překlad | llama3.2-vision:11b | Claude Opus |
| Učesaný překlad | qwen2.5:14b | Claude Opus |

**Důvod:** Konsolidační krok je **multimodální** (obrázek + OCR výstupy) – jádro architektury. Proto musí i v dev režimu běžet na vision modelu. Pouze učesaný překlad je čistě textový a používá qwen2.5:14b pro lepší vícejazyčnou kvalitu.

**Poznámka k výkonu:** Na M1 Pro/16 GB bude llama3.2-vision:11b pro konsolidaci pomalý (odhadem 30–60s na volání). To je pro dev/testing akceptovatelné. Ollama bude swapovat modely mezi vision a text voláními – každý swap ~5–10s.

---

## 2. Změny typů oproti CLAUDE.md

### Rozšíření `OcrEngineResult.engine`

```typescript
engine: 'transkribus' | 'tesseract' | 'kraken' | 'claude_vision' | 'ollama_vision';
```

### Nový typ `OllamaConfig`

```typescript
interface OllamaConfig {
  baseUrl: string;           // default: http://localhost:11434
  visionModel: string;       // default: llama3.2-vision:11b
  textModel: string;         // default: qwen2.5:14b
  timeoutMs: number;         // default: 120000 (2 min, vision modely jsou pomalé)
}
```

---

## 3. Struktura adapterů

```
apps/web/lib/adapters/
├── ocr/
│   ├── claude-vision.ts          # ClaudeVisionOcrEngine (produkce)
│   ├── ollama-vision.ts          # OllamaVisionOcrEngine (dev)
│   ├── transkribus.ts            # TranskribusOcrEngine (produkce)
│   └── tesseract.ts              # TesseractOcrEngine (obojí)
├── llm/
│   ├── claude-translator.ts      # ClaudeTranslator (produkce)
│   ├── claude-classifier.ts      # ClaudeLayoutClassifier (produkce)
│   ├── ollama-translator.ts      # OllamaTranslator (dev)
│   └── ollama-classifier.ts      # OllamaLayoutClassifier (dev)
└── preprocessing/
    └── sharp.ts                  # SharpPreprocessor (obojí)
```

Toto je **změna oproti CLAUDE.md** – přidány 4 nové Ollama soubory.

---

## 4. Ensemble v dev režimu

V dev režimu (Ollama) běží **2 enginy místo 3**:
- Ollama Vision (místo Claude Vision)
- Tesseract.js

Transkribus není v dev režimu k dispozici (žádný API klíč). Ensemble orchestrátor to zvládne díky graceful degradation (min. 1 engine stačí). Po přidání Transkribus API klíče do `.env.local` se engine automaticky zapojí.

### Tesseract.js v dev režimu

Tesseract.js běží v prohlížeči. Při testování přes API (curl/Postman) bez prohlížeče ensemble poběží s 1 enginem (Ollama Vision). To je v pořádku – graceful degradation to pokryje. Plný 2-engine ensemble funguje jen při testování přes UI v prohlížeči.

---

## 5. Ollama API komunikace

Ollama poskytuje REST API na `http://localhost:11434`.

### Kontrola dostupnosti

```
GET /api/tags
```

Všechny Ollama adaptery implementují `isAvailable()` voláním `/api/tags` s 2s timeoutem. Pokud Ollama neběží, engine se přeskočí (graceful degradation).

### Vision (OCR, klasifikace, konsolidace)

```
POST /api/chat
{
  "model": "llama3.2-vision:11b",
  "messages": [{
    "role": "user",
    "content": "prompt text",
    "images": ["base64_encoded_image"]
  }],
  "stream": false
}
```

Odpověď:
```json
{
  "message": {
    "role": "assistant",
    "content": "response text"
  }
}
```

### Text (učesaný překlad)

```
POST /api/chat
{
  "model": "qwen2.5:14b",
  "messages": [{
    "role": "user",
    "content": "prompt text"
  }],
  "stream": false
}
```

Timeout pro všechna volání: 120s (vision modely na M1 Pro jsou pomalé).

---

## 6. Úložiště souborů v dev režimu

V dev režimu se **nepoužívá Vercel Blob** (vyžaduje token). Místo toho:
- Nahrané obrázky se ukládají do `tmp/uploads/` (lokální filesystem)
- Přepínání v `vercel-blob.ts` → nový `local-storage.ts` adapter
- Env proměnná `STORAGE_PROVIDER=local|vercel-blob` (default: `local` pokud `BLOB_READ_WRITE_TOKEN` chybí)
- Logika výběru analogická k LLM_PROVIDER

---

## 7. Pořadí implementace

Upravené pořadí kroků oproti CLAUDE.md – Ollama adaptery první, minimální UI co nejdřív pro vizuální feedback:

```
1.1   Scaffolding (Turborepo, Next.js, packages/shared, config)
1.2   Nahrávání obrázků (FileUpload, local storage + Sharp preprocessing)
1.3   Ollama Vision OCR (první adapter – hned testovatelný lokálně)
1.4   Tesseract.js v prohlížeči (druhý adapter)
1.5   Ensemble orchestrátor (2 enginy v dev režimu)
1.6   Minimální zobrazení výsledků (surový OCR výstup pro vizuální feedback)
1.7   Ollama konsolidace + překlad
1.8   Plné zobrazení výsledků (ResultViewer, 4 sloupce)
1.9   Klasifikace a TierSelector
1.10  Claude adaptery (mirror Ollama adapterů pro produkci)
1.11  Transkribus adapter (produkční, s mockem v testech)
1.12  Polish, error handling, Vercel Blob integrace, deployment
```

**Změny oproti CLAUDE.md:**
- Ollama adaptery první (1.3, 1.7) – lokálně testovatelné bez API klíčů
- Minimální zobrazení (1.6) před konsolidací – vizuální feedback loop dřív
- Přidány kroky 1.11 a 1.12 (CLAUDE.md měl 1.1–1.10)
- Vercel Blob integrace přesunuta do posledního kroku (v dev režimu se nepoužívá)

**Předpoklad pro krok 1.3:** Ollama nainstalována, model `llama3.2-vision:11b` stažen (`ollama pull llama3.2-vision:11b`).

---

## 8. Kvalita výstupů v dev režimu

**Dev režim slouží k testování pipeline, ne k hodnocení kvality OCR.** Kvalita llama3.2-vision:11b na středověkých textech bude výrazně nižší než Claude Sonnet. Cílem je:
- Ověřit, že pipeline funguje end-to-end
- Iterovat na promptech (struktura výstupu, formátování)
- Testovat graceful degradation a error handling
- Ověřit UI a UX

Hodnocení OCR kvality je možné až s Claude API (produkční adaptery).

---

## 9. Technické parametry prostředí

- **Node.js:** v24.13.0
- **npm:** v11.6.2
- **Hardware:** Apple M1 Pro, 16 GB RAM, 14 GPU jader
- **Ollama modely:** qwen2.5:14b (nainstalován), llama3.2-vision:11b (k instalaci)
- **Cílová platforma:** Vercel (Fluid Compute)
- **Monorepo:** Turborepo

---

## 10. Co se nemění oproti CLAUDE.md

- Domain rozhraní (IOcrEngine, ITranslator, IPreprocessor, ILayoutClassifier)
- Pipeline diagram (preprocessing → klasifikace → OCR ensemble → konsolidace → překlad)
- Clean Architecture vrstvy a pravidla
- Validační pipeline (typecheck, lint, format, test)
- LLM prompty (sdílené v packages/shared/prompts.ts)
- Vercel deployment konfigurace

## 11. Co se mění oproti CLAUDE.md

- `OcrEngineResult.engine` rozšířen o `'ollama_vision'`
- Přidán typ `OllamaConfig`
- Přidány 4 Ollama adapter soubory do `apps/web/lib/adapters/`
- Přidány env proměnné: `LLM_PROVIDER`, `OLLAMA_BASE_URL`, `OLLAMA_VISION_MODEL`, `OLLAMA_TEXT_MODEL`, `STORAGE_PROVIDER`
- Přidán `local-storage.ts` adapter pro dev režim (místo Vercel Blob)
- Přeřazeno pořadí implementačních kroků (12 kroků místo 10)
