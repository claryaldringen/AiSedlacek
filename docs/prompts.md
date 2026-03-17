# LLM prompty

Všechny LLM prompty používané v pipeline. Zpět na hlavní dokumentaci: [CLAUDE.md](../CLAUDE.md)

---

## Aktuální prompty (implementované)

### Claude Vision – OCR + překlad (hlavní pipeline)

Používá se v `apps/web/lib/adapters/ocr/claude-vision.ts`. Jeden multimodální
volání Claude Opus 4.6 provede OCR, překlad, kontext i glosář najednou.

**System prompt:**
```
You are an expert in paleography and historical manuscripts. Transcribe the text
from this manuscript. Use your knowledge of historical orthography to disambiguate
unclear characters (e.g. long ſ looks like f — always transcribe it as s). Then
translate the transcribed text fully into the modern standard form of the language
the user writes in. Do not summarize — translate the complete text. Preserve all
references and citations. Use square brackets to clarify archaic terms or add
context a modern reader would need. Then add a brief contextual explanation and
a glossary. Respond in the user's language.

IMPORTANT: Return your response as valid JSON with this exact structure:
{
  "transcription": "the transcribed original text in markdown",
  "detectedLanguage": "ISO language code of the original, e.g. cs-old, de-old, la",
  "translation": "full translation in markdown",
  "translationLanguage": "ISO code of translation language, e.g. cs, en, de",
  "context": "brief contextual explanation in markdown",
  "glossary": [
    {"term": "term", "definition": "definition"}
  ]
}
```

**User prompt:** `Přepiš text z tohoto rukopisu.`

**Model:** Claude Opus 4.6 (streaming, max 8192 tokenů)

### Retranslace (inkrementální)

Používá se v `apps/web/app/api/documents/[id]/retranslate/route.ts`.
Claude Sonnet 4.6 aktualizuje překlad po editaci transkripce.

**Inkrementální režim** (pokud existuje předchozí překlad):
```
Transkripce historického textu byla upravena. Aktualizuj existující překlad tak,
aby odpovídal změnám v transkripci. Měň JEN ta místa, která se změnila – zbytek
překladu ponech beze změny.

UPRAVENÁ TRANSKRIPCE:
{doc.transcription}

STÁVAJÍCÍ PŘEKLAD (uprav jen změněná místa):
{existingTranslation}

Vrať POUZE aktualizovaný překlad v markdown, nic dalšího.
```

**Plný režim** (bez předchozího překladu):
```
Přelož tento historický přepis do moderní {jazyk}. Zachovej strukturu, všechny
reference a citace. Hranaté závorky použij pro vysvětlení archaických pojmů.
Formátuj jako markdown.

{doc.transcription}
```

**Model:** Claude Sonnet 4.6 (max 8192 tokenů)

---

## Připravené prompty (pro budoucí ensemble – v prompts.ts)

Tyto prompty jsou definovány v `packages/shared/src/prompts.ts`, ale zatím se
nepoužívají v produkční pipeline. Budou aktivovány při implementaci ensemble OCR.

### Klasifikace dokumentu

```typescript
CLASSIFY_LAYOUT_PROMPT
```

Analyzuje obrázek a vrací JSON s tier, scriptType, layoutComplexity, detectedFeatures.
Pro automatický výběr OCR strategie (tier1 vs tier2).

### Multimodální konsolidace OCR

```typescript
buildConsolidationPrompt(ocrSection, targetLanguage, engineCount, engineNames)
```

Konsolidační krok je **multimodální** – Claude dostává obrázek + všechny OCR výstupy.
Výstup: konsolidovaný text + doslovný překlad + poznámky.

### Učesaný překlad

```typescript
buildPolishPrompt(targetLanguage)
```

Přepisuje doslovný překlad do plynulé moderní verze.
