# Dávkové zpracování dokumentů — Design Spec

## Motivace

Aktuálně se každá stránka zpracovává samostatným API voláním. Model nemá kontext z okolních stránek rukopisu, což vede k:
- Horší kvalitě transkripce u navazujících textů (věta začne na stránce 3, pokračuje na stránce 4)
- Zbytečnému API overhead (N volání místo N/batch)
- Chybějícímu kontextu pro disambiguaci nejasných znaků

## Cíl

Zpracovávat stránky v dávkách tak, aby model měl vizuální i textový kontext z okolních stránek. Zároveň snížit počet API volání a zrychlit zpracování.

---

## Architektura

### Hybridní přístup (multi-image + sliding text context)

Kombinace dvou strategií:
1. **V rámci dávky:** více obrázků v jednom API volání → model vidí všechny stránky najednou
2. **Mezi dávkami:** textový souhrn (transkripce) z předchozí dávky → kontext pro následující dávku

---

## Batching strategie

### Automatické dělení do dávek

1. Uživatel vybere stránky (nebo celé kolekce) ke zpracování
2. Pre-filtering: odfiltrovat stránky s existujícím dokumentem (hash deduplication) — emitovat `page_done` s `cached: true`
3. Aplikace seřadí zbývající stránky podle `order` v rámci kolekce; stránky bez kolekce se řadí dle `createdAt`
4. Dávkovač odhadne tokeny per obrázek: `file_size_bytes / 750 + 258` (overhead). Toto je aproximace — skutečný token count závisí na rozlišení obrázku (tile-based). Pokud API vrátí context-length-exceeded error, dávka se rozpadne na menší (viz fallback)
5. **Duální token budget:**
   - Input budget: **150K tokenů** (konzervativní limit pod 200K — prostor pro system prompt, kontext kolekce, textový kontext z předchozích dávek)
   - Output budget: `max_tokens / 2500` stránek (průměrný output per stránka ~2500 tokenů). Skutečný `max_tokens` závisí na API limitu modelu — ověřit při implementaci
6. Velikost dávky = minimum z input budgetu a output budgetu
7. Minimální dávka: 1 stránka

### Mezi-dávkový kontext

- Po dokončení dávky N se z výsledků extrahuje souhrn (transkripce posledních stránek, ~500 tokenů)
- Souhrn se přidá do promptu dávky N+1 jako `Kontext z předchozích stránek:`
- Zajišťuje návaznost textu přes hranice dávek

### Kontext pro jednotlivé stránky

Pokud uživatel zpracovává 1 stránku a v kolekci existují dříve zpracované stránky s nižším `order`:
- Vezmou se transkripce posledních **3 předchozích stránek** (dle `order`)
- Přidají se do promptu jako `Kontext z předchozích stránek rukopisu: ...`
- Platí i pro regeneraci (smazání dokumentu + nové zpracování přes `/api/pages/process`)

> **Poznámka:** Endpoint `/api/documents/[id]/reparse` pouze re-parsuje uložený `rawResponse` bez nového LLM volání — kontext se tam nepřidává. Kontext z předchozích stránek se uplatní pouze při novém zpracování (process/regenerate).

---

## API a prompt design

### Nová funkce `processWithClaudeBatch`

Rozšíření stávajícího adaptéru v `apps/web/lib/adapters/ocr/claude-vision.ts`:

```typescript
processWithClaudeBatch(
  images: { buffer: Buffer; pageId: string; index: number }[],
  userPrompt: string,
  options?: {
    collectionContext?: string,   // kontext díla (z Collection.context)
    previousContext?: string,     // souhrn z předchozí dávky
    onProgress?: (outputTokens: number, estimatedTotal: number) => void,
  },
)
```

Stávající `processWithClaude` zůstane pro zpracování jednotlivých stránek a fallback. Získá nový volitelný parametr `previousContext` pro kontext z předchozích stránek.

### Struktura zprávy do Claude API

```
system: paleografie expert prompt (stávající) + instrukce pro JSONL výstup
user: [
  image_1, image_2, ..., image_N,   // N obrázků jako content bloky
  text: "Kontext z předchozích stránek: ...",  // pokud existuje
  text: "Kontext díla: ...",                    // kolekce context
  text: "Pro každý obrázek přepiš text. Výsledky vrať jako JSONL — jeden JSON objekt per řádek, ve stejném pořadí jako obrázky. Každý objekt musí obsahovat pole 'imageIndex' (0-based)."
]
```

### Výstupní formát — JSONL (ne JSON pole)

Místo JSON pole používáme **JSONL** (jeden JSON objekt per řádek). Výhody:
- Odolné vůči truncation — parsování řádek po řádku, částečný výsledek se neztrácí
- Každý řádek se parsuje nezávisle — jeden chybný řádek nepokazí ostatní

```
{"imageIndex": 0, "transcription": "...", "detectedLanguage": "...", "translation": "...", "translationLanguage": "...", "context": "...", "glossary": [...]}
{"imageIndex": 1, "transcription": "...", "detectedLanguage": "...", "translation": "...", "translationLanguage": "...", "context": "...", "glossary": [...]}
```

### Nová funkce `parseOcrJsonBatch`

```typescript
parseOcrJsonBatch(raw: string): { index: number; result: StructuredOcrResult }[]
```

- Rozdělí výstup po řádcích
- Každý řádek parsuje nezávisle přes stávající `parseOcrJson` + extrakce `imageIndex`
- Chybné řádky přeskočí (loguje warning), úspěšné vrátí
- Párování se stránkami přes `imageIndex`, s fallbackem na pozici pokud `imageIndex` chybí

### Dynamické `max_tokens`

`2500 * počet_stránek`, minimum 8192. Horní limit závisí na API limitu modelu — ověřit při implementaci.

---

## Error handling a fallback

### Tříúrovňový fallback

```
Dávka N stránek
    │
    ▼
Pokus o zpracování celé dávky
    │
    ├─ Úspěch (N výsledků) → uložit, pokračovat
    │
    ├─ Částečný úspěch (M < N výsledků)
    │   → uložit M úspěšných (párovat přes imageIndex)
    │   → zbylé N-M stránek rozdělit na menší dávky → retry
    │
    ├─ Context-length-exceeded (API 400 error)
    │   → rozdělit dávku na poloviny → retry
    │
    └─ Totální selhání (jiný API error, kompletní JSON parse error)
        → rozdělit dávku na poloviny → retry
        → pokud i poloviny selžou → zpracovat jednotlivě (stávající processWithClaude)
```

### Párování výsledků se stránkami

- Primární párování přes `imageIndex` v JSONL výstupu
- Fallback na pozici pokud `imageIndex` chybí
- Méně výsledků než obrázků → spárovat co máme, zbytek do retry
- Více výsledků než obrázků → oříznout na počet obrázků
- **Výsledky z částečně úspěšné dávky se vždy uloží, nikdy se nezahazují**

---

## Změny v datovém modelu

### Žádné breaking changes

Vztah Page → Document zůstává 1:1.

### Rozšíření

- `Document.batchId: String?` — identifikátor dávky pro debug a audit
- Stávající `model`, `inputTokens`, `outputTokens`, `processingTimeMs` se vyplní per dokument (tokeny z dávky se rozpočítají: input tokeny dle odhadu velikosti obrázku, output tokeny dle délky JSONL řádku)

---

## UI změny

### Minimální zásah

Zpracování z pohledu uživatele vypadá stejně:
1. Vybere stránky / kolekce → klikne "Zpracovat"
2. Progress bar ukazuje postup per stránka (jako teď)
3. **Nově:** malá informace nad progress barem: `Dávka 1/3 (5 stránek)`
4. Stránky se postupně označují jako hotové

### Žádná konfigurace

Aplikace rozhodne o velikosti dávek automaticky. Uživatel nemusí nic nastavovat.

### SSE eventy

Stávající eventy zůstávají:
- `batch_progress` — průběh aktuální dávky (celkové tokeny / odhad). Nahrazuje per-page `page_progress` v rámci dávky — během batch zpracování nelze určit, na které stránce model právě pracuje
- `page_done` — emituje se per stránka po uložení do DB
- `page_error` — per stránka při selhání

Nový event:
- `batch_info` — informace o rozdělení do dávek (číslo dávky, celkový počet dávek, počet stránek v dávce) pro UI progress

Klient musí rozpoznat nové eventy `batch_info` a `batch_progress` a zobrazit odpovídající UI.

---

## Zpětná kompatibilita

- 1 stránka bez předchůdců v kolekci → stávající `processWithClaude` (bez batch overhead)
- 1 stránka s předchůdci → stávající `processWithClaude` + textový kontext posledních 3 stránek
- Regenerace (delete + process) → nové zpracování s textovým kontextem posledních 3 stránek
- Reparse (`/api/documents/[id]/reparse`) → beze změn (re-parsuje uložený rawResponse)
- Retranslace, chat → beze změn

---

## Prompt šablony

Batch system prompt (přidá se do `packages/shared/src/prompts.ts`):

```typescript
export const BATCH_OCR_INSTRUCTION = `You will receive multiple manuscript page images. Process each one independently but use context from all pages to improve accuracy.

Return results as JSONL (one JSON object per line), in the same order as the images. Each object MUST include an "imageIndex" field (0-based, matching the image order).

Each line must be a valid JSON object with this structure:
{"imageIndex": 0, "transcription": "...", "detectedLanguage": "...", "translation": "...", "translationLanguage": "...", "context": "page-specific context only (see below)", "glossary": [{"term": "...", "definition": "..."}]}

The "context" field must contain ONLY information specific to that page: biblical quotes and their source, literary references, named persons, places, or events. Do NOT repeat general information about the work (author, date, genre) — that is already known from the collection context.

Use \\n for newlines inside JSON strings. Return ONLY the JSONL lines, no markdown fences, no extra text.`;
```

---

## Dotčené soubory

| Soubor | Změna |
|--------|-------|
| `apps/web/lib/adapters/ocr/claude-vision.ts` | Nová `processWithClaudeBatch`, `parseOcrJsonBatch`, úprava `processWithClaude` pro `previousContext` |
| `apps/web/app/api/pages/process/route.ts` | Pre-filtering duplikátů, batching logika, dělení stránek do dávek, mezi-dávkový kontext, nové SSE eventy |
| `apps/web/prisma/schema.prisma` | `Document.batchId` pole |
| `apps/web/app/workspace/page.tsx` | UI zobrazení info o dávce, handling `batch_info` a `batch_progress` eventů |
| `packages/shared/src/prompts.ts` | `BATCH_OCR_INSTRUCTION` prompt šablona |
