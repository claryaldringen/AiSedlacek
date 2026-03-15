# API integrace – Transkribus, Claude Vision, Tesseract, Sharp

Implementační detaily a kód pro jednotlivé OCR enginy a preprocessing. Zpět na hlavní dokumentaci: [CLAUDE.md](../CLAUDE.md)

---

## Transkribus API – integrace

### Autentizace
```
POST https://account.readcoop.eu/auth/realms/readcoop/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=password&username={email}&password={heslo}&client_id=processing-api-client
```

### Zpracování dokumentu
```
POST https://transkribus.eu/processing/v1/processes
Content-Type: application/json
Authorization: Bearer {token}

{
  "config": {
    "textRecognition": {
      "htrId": {model_id}
    }
  },
  "image": {
    "base64": "{base64_encoded_image}"
  }
}
```

### Doporučené modely pro tento projekt
- **Stará čeština:** "Old Czech Handwriting (without spaces)" – bastarda, 14.–15. století
- **Historická němčina:** Text Titan I (obecný) nebo specializované frakturové modely
- **Latina:** modely z CATMuS Medieval kolekce

---

## Tesseract.js – konfigurace

```typescript
import { createWorker } from 'tesseract.js';

const worker = await createWorker('deu_frak+ces+lat', 1, {
  // logger: m => console.log(m),  // pro debugging
});

// Nastavení pro historické texty
await worker.setParameters({
  tessedit_pageseg_mode: '3',     // Plně automatická segmentace
  preserve_interword_spaces: '1', // Zachovat mezery
});

const { data: { text, confidence } } = await worker.recognize(imageBuffer);
```

### Dostupné relevantní modely
- `deu_frak` – německá fraktura (LSTM)
- `ces` – čeština (pozor: moderní, ne staročeština)
- `lat` – latina
- Kombinace: `deu_frak+ces+lat` pro smíšené texty

---

## Claude Vision – OCR engine

Claude Vision se volá přes stejné Anthropic SDK jako konsolidace a překlad.
Nepotřebuje žádnou extra závislost – jen jiný prompt.

### Integrace

```typescript
// lib/ocr/claude-vision.ts
import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_OCR_PROMPT } from '../../packages/shared/prompts';

const client = new Anthropic();

export async function ocrWithClaudeVision(
  imageBase64: string,
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/jpeg'
): Promise<{ text: string; uncertainMarkers: string[] }> {
  const startTime = Date.now();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',  // Sonnet pro OCR (rychlejší, levnější)
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType,
            data: imageBase64,
          },
        },
        {
          type: 'text',
          text: CLAUDE_OCR_PROMPT,
        },
      ],
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  // Extrakce nejistých míst
  const uncertainMarkers = [...text.matchAll(/\[\?(.+?)\?\]/g)].map(m => m[1]);
  const unreadable = [...text.matchAll(/\[\.\.\.\]/g)].length;

  return {
    text,
    uncertainMarkers,
    processingTimeMs: Date.now() - startTime,
  };
}
```

### Volba modelu

- **Claude Sonnet** (doporučený pro OCR krok): Rychlejší, levnější, dostatečně
  přesný pro surový přepis. ~0.003 $/obrázek.
- **Claude Opus** (pro konsolidaci + překlad): Lepší reasoning pro rozhodování
  mezi OCR variantami a kvalitní překlad. ~0.015 $/obrázek.

Dvoumodelová strategie: Sonnet pro OCR a klasifikaci (rychlost), Opus pro
konsolidaci a překlad (kvalita).

### Multimodální konsolidace – implementace

```typescript
// lib/llm/consolidate.ts
export async function consolidateAndTranslate(
  imageBase64: string,
  ocrResults: OcrEngineResult[],
  targetLanguage: string,
): Promise<{ consolidatedText: string; literalTranslation: string; notes: string[] }> {
  const ocrSection = ocrResults
    .filter(r => r.role === 'recognizer')
    .map(r => `--- ${r.engine.toUpperCase()} ---\n${r.text}`)
    .join('\n\n');

  const response = await client.messages.create({
    model: 'claude-opus-4-20250514',  // Opus pro kvalitní konsolidaci
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
        },
        {
          type: 'text',
          text: buildConsolidationPrompt(ocrSection, targetLanguage),
        },
      ],
    }],
  });

  return parseConsolidationResponse(response);
}
```

---

## Preprocessing obrázků – Sharp

```typescript
import sharp from 'sharp';

async function preprocessForOcr(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .greyscale()                    // Převod na šedotón
    .normalize()                    // Vyrovnání histogramu
    .sharpen({ sigma: 1.5 })        // Zaostření
    .threshold(128)                  // Binarizace (práh upravit dle potřeby)
    .resize({ width: 3000, withoutEnlargement: true }) // Max šířka
    .toBuffer();
}
```
