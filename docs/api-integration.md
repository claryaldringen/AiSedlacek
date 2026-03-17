# API integrace – aktuální implementace a plány

Zpět na hlavní dokumentaci: [CLAUDE.md](../CLAUDE.md)

---

## Claude Vision – aktuální implementace

### Soubor: `apps/web/lib/adapters/ocr/claude-vision.ts`

Hlavní OCR engine. Exportuje `processWithClaude()` a `StructuredOcrResult`.

### Klíčové rysy

- **Model:** Claude Opus 4.6 (`claude-opus-4-6`)
- **Streaming:** Token-by-token s progress callbackem (odhad: ~4 znaky/token)
- **Image handling:**
  - Automatická detekce media type (JPEG, PNG, WebP, GIF)
  - Resize přes Sharp pokud > 5 MB (3000px → 2000px šířka)
- **JSON parsing:** Robustní extrakce – zvládá markdown fences, extra text kolem JSON
- **Output:** `{ transcription, detectedLanguage, translation, translationLanguage, context, glossary[] }`

### Tok dat

```typescript
processWithClaude(image: Buffer, userPrompt: string, onProgress?, estimatedOutputTokens?)
  → prepareImage() – resize pokud > 5 MB
  → client.messages.stream() – streaming response
  → JSON parsing (strip fences, find braces)
  → return { result, processingTimeMs, model, inputTokens, outputTokens }
```

---

## Claude Sonnet – retranslace

### Soubor: `apps/web/app/api/documents/[id]/retranslate/route.ts`

- **Model:** Claude Sonnet 4.6 (`claude-sonnet-4-6`)
- **Dva režimy:**
  1. **Inkrementální** – aktualizuje jen změněná místa v existujícím překladu
  2. **Plný** – přeloží celou transkripci od nuly
- **Verzování:** Před přepsáním ukládá starý překlad jako DocumentVersion

---

## Sharp preprocessing

### Soubor: `apps/web/lib/adapters/preprocessing/sharp.ts`

Aktuálně se Sharp používá primárně pro:
- Resize velkých obrázků (> 5 MB) pro Claude API limit
- Extrakce metadat (width, height) při uploadu

### Plánované rozšíření preprocessingu

```typescript
// Plánovaný full preprocessing pipeline:
sharp(input)
  .greyscale()                    // Převod na šedotón
  .normalize()                    // Vyrovnání histogramu
  .sharpen({ sigma: 1.5 })        // Zaostření
  .threshold(128)                  // Binarizace
  .resize({ width: 3000, withoutEnlargement: true })
  .toBuffer();
```

---

## Plánované integrace

### Transkribus API

Autentizace:
```
POST https://account.readcoop.eu/auth/realms/readcoop/protocol/openid-connect/token
grant_type=password&username={email}&password={heslo}&client_id=processing-api-client
```

Zpracování:
```
POST https://transkribus.eu/processing/v1/processes
Authorization: Bearer {token}
{ "config": { "textRecognition": { "htrId": {model_id} } }, "image": { "base64": "..." } }
```

Doporučené modely:
- **Stará čeština:** "Old Czech Handwriting (without spaces)" – bastarda, 14.–15. stol.
- **Historická němčina:** Text Titan I nebo specializované frakturové modely
- **Latina:** modely z CATMuS Medieval kolekce

### Tesseract.js (klient-side)

```typescript
const worker = await createWorker('deu_frak+ces+lat', 1);
await worker.setParameters({
  tessedit_pageseg_mode: '3',     // Plně automatická segmentace
  preserve_interword_spaces: '1',
});
const { data: { text, confidence } } = await worker.recognize(imageBuffer);
```

Plán: Tesseract.js poběží v prohlížeči jako Web Worker, výsledek se pošle na
server přes API. Modely (~30 MB) se cacheují v IndexedDB.

### Ollama (dev mode)

Plánované modely:
- `llama3.2-vision:11b` – vision úlohy (OCR)
- `qwen2.5:14b` – textové úlohy (překlad)

Pro lokální vývoj bez Claude API klíče.
