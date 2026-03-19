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
2. Aplikace seřadí stránky podle `order` v rámci kolekce
3. Dávkovač odhadne tokeny per obrázek: `file_size_bytes / 750 + 258` (overhead)
4. Plní dávku dokud nepřekročí **budget 150K input tokenů** (konzervativní limit pod 200K — prostor pro system prompt, kontext kolekce, textový kontext z předchozích dávek)
5. Minimální dávka: 1 stránka, maximální: ~25–30 stránek (záleží na velikosti obrázků)

### Mezi-dávkový kontext

- Po dokončení dávky N se z výsledků extrahuje souhrn (transkripce posledních stránek, ~500 tokenů)
- Souhrn se přidá do promptu dávky N+1 jako `Kontext z předchozích stránek:`
- Zajišťuje návaznost textu přes hranice dávek

### Kontext pro jednotlivé stránky

Pokud uživatel zpracovává 1 stránku a v kolekci existují dříve zpracované stránky s nižším `order`:
- Vezmou se transkripce posledních **3 předchozích stránek** (dle `order`)
- Přidají se do promptu jako `Kontext z předchozích stránek rukopisu: ...`
- Platí i pro reparse (`/api/documents/[id]/reparse`)

---

## API a prompt design

### Nová funkce `processWithClaudeBatch`

Rozšíření stávajícího adaptéru v `apps/web/lib/adapters/ocr/claude-vision.ts`:

```typescript
processWithClaudeBatch(
  images: { buffer: Buffer; pageId: string }[],
  userPrompt: string,
  previousContext?: string,  // souhrn z předchozí dávky
  onProgress?: (outputTokens: number, estimatedTotal: number) => void,
)
```

Stávající `processWithClaude` zůstane pro zpracování jednotlivých stránek a fallback.

### Struktura zprávy do Claude API

```
system: paleografie expert prompt (stávající) + instrukce pro pole výsledků
user: [
  image_1, image_2, ..., image_N,   // N obrázků jako content bloky
  text: "Kontext z předchozích stránek: ...",  // pokud existuje
  text: "Kontext díla: ...",                    // kolekce context
  text: "Přepiš text z každého obrázku. Vrať pole JSON objektů, jeden per obrázek, ve stejném pořadí."
]
```

### Výstupní formát

```json
[
  { "transcription": "...", "detectedLanguage": "...", "translation": "...", "translationLanguage": "...", "context": "...", "glossary": [...] },
  { "transcription": "...", "detectedLanguage": "...", "translation": "...", "translationLanguage": "...", "context": "...", "glossary": [...] }
]
```

Stejná `StructuredOcrResult` struktura, zabalená v poli.

### Dynamické `max_tokens`

`8192 * počet_stránek`, maximum 32768 (API limit).

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
    │   → uložit M úspěšných
    │   → zbylé N-M stránek rozdělit na menší dávky → retry
    │
    └─ Totální selhání (API error, JSON parse error)
        → rozdělit dávku na poloviny → retry
        → pokud i poloviny selžou → zpracovat jednotlivě (stávající processWithClaude)
```

### Párování výsledků se stránkami

- Párování podle pořadí (obrázek 1 = výsledek 1)
- Méně výsledků než obrázků → spárovat co máme, zbytek do retry
- Více výsledků než obrázků → oříznout na počet obrázků
- **Výsledky z částečně úspěšné dávky se vždy uloží, nikdy se nezahazují**

---

## Změny v datovém modelu

### Žádné breaking changes

Vztah Page → Document zůstává 1:1.

### Rozšíření

- `Document.batchId: String?` — identifikátor dávky pro debug a audit
- Stávající `model`, `inputTokens`, `outputTokens`, `processingTimeMs` se vyplní per dokument (tokeny z dávky se rozpočítají rovnoměrně)

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
- `page_progress` — průběh celé dávky (tokeny)
- `page_done` — emituje se per stránka po uložení do DB
- `page_error` — per stránka při selhání

Nový event:
- `batch_info` — informace o rozdělení do dávek (číslo dávky, počet stránek) pro UI progress

---

## Zpětná kompatibilita

- 1 stránka bez předchůdců v kolekci → stávající `processWithClaude` (bez batch overhead)
- 1 stránka s předchůdci → stávající `processWithClaude` + textový kontext posledních 3 stránek
- Reparse → stávající flow + textový kontext posledních 3 stránek
- Retranslace, chat → beze změn

---

## Dotčené soubory

| Soubor | Změna |
|--------|-------|
| `apps/web/lib/adapters/ocr/claude-vision.ts` | Nová `processWithClaudeBatch`, úprava `processWithClaude` pro přijetí `previousContext` |
| `apps/web/app/api/pages/process/route.ts` | Batching logika, dělení stránek do dávek, mezi-dávkový kontext, nové SSE eventy |
| `apps/web/app/api/documents/[id]/reparse/route.ts` | Přidání textového kontextu z předchozích stránek |
| `apps/web/prisma/schema.prisma` | `Document.batchId` pole |
| `apps/web/app/workspace/page.tsx` | UI zobrazení info o dávce nad progress barem |
| `packages/shared/src/prompts.ts` | Prompt šablony pro batch zpracování |
