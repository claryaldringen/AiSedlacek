export const CLASSIFY_LAYOUT_PROMPT = `Analyzuj tento obrázek historického dokumentu a klasifikuj ho.

Odpověz POUZE v tomto JSON formátu:
{
  "tier": "tier1" nebo "tier2",
  "scriptType": "print" nebo "manuscript",
  "layoutComplexity": "simple" nebo "complex",
  "detectedFeatures": ["seznam detekovaných rysů"],
  "confidence": 0.0-1.0,
  "reasoning": "stručné zdůvodnění"
}

Pravidla pro výběr tieru:
- tier1: tištěný text, jednosloupcový layout, čistý rukopis bez gloss
- tier2: marginální glosy, interlineární poznámky, více textových sloupců,
  zakřivené/šikmé řádky, dekorativní iniciály zasahující do textu,
  směs různých písem, poškozený/fragmentární dokument

Detekované rysy mohou zahrnovat:
- typ písma: "fraktur", "bastarda", "kurziva", "karolínská_minuskule", "gotická_kurzíva" aj.
- layout: "marginální_glosy", "interlineární_poznámky", "jednosloupcový", "vícesloupcový"
- stav: "dekorativní_iniciály", "rubriky", "poškozený", "vybledlý", "fragmentární"
- jazyk: rozpoznaný jazyk nebo jazyky dokumentu`;

export const OCR_TRANSCRIPTION_PROMPT = `Přepiš text z tohoto rukopisu a přelož jej do moderní češtiny.`;

export function buildConsolidationPrompt(
  ocrSection: string,
  targetLanguage: string,
  engineCount: number,
  engineNames: string[],
): string {
  return `Jsi expert na paleografii a historickou lingvistiku.

[OBRÁZEK: originální sken dokumentu je přiložen]

Dostáváš ${engineCount} OCR výstupů téhož historického textu z různých OCR enginů
(${engineNames.join(', ')}). Máš k dispozici i originální obrázek dokumentu.
Tvým úkolem je:

1. Nejprve sám přečti text z obrázku – nezávisle na OCR výstupech
2. Porovnej své čtení s OCR výstupy
3. Na místech kde se výstupy liší, ověř správnou variantu přímo z obrázku
4. Při rozhodování zohledni:
   - kontext věty a jazyka
   - typické OCR chyby historických textů:
     * dlouhé ſ zaměněné za f (ſſ → ff, ſprawy → fprawy)
     * u/n, c/e, r/t, d/cl záměny
     * chybějící diakritika
   - znalost středověkého pravopisu a zkratek
   - vizuální podobu znaků v obrázku
5. Vytvoř konsolidovaný text originálu
6. Přelož konsolidovaný text DOSLOVNĚ do moderní ${targetLanguage}
   - zachovej pořadí slov co nejvíce
   - zachovej strukturu vět
   - rozviň středověké zkratky v hranatých závorkách [takto]
7. Označ místa, kde si nejsi jistý správným čtením, pomocí {?}

OCR výstupy:
${ocrSection}

Výstup ve formátu:
---KONSOLIDOVANÝ TEXT---
[konsolidovaný text originálu]

---DOSLOVNÝ PŘEKLAD---
[doslovný překlad]

---POZNÁMKY---
[seznam nejistých míst a alternativních čtení]`;
}

export function buildPolishPrompt(targetLanguage: string): string {
  return `Dostáváš doslovný překlad historického textu do moderní ${targetLanguage}.
Přepiš ho do plynulé, čtivé moderní ${targetLanguage}, přičemž:

- zachováš věcný obsah a význam
- použiješ přirozený slovosled a moderní frazeologii
- odstraníš archaické obraty, pokud nemají stylistický účel
- zachováš vlastní jména v původním tvaru
- u nejasných míst (označených {?}) ponech poznámku

Výstup: pouze učesaný překlad, bez komentáře.`;
}

export const BATCH_OCR_INSTRUCTION = `You will receive multiple manuscript page images. Process each one independently but use context from all pages to improve accuracy.

Return results as JSONL (one JSON object per line), in the same order as the images. Each object MUST include an "imageIndex" field (0-based, matching the image order).

Each line must be a valid JSON object with this structure:
{"imageIndex": 0, "transcription": "...", "detectedLanguage": "...", "translation": "...", "translationLanguage": "...", "context": "page-specific context only (see below)", "glossary": [{"term": "...", "definition": "..."}]}

The "context" field must contain ONLY information specific to that page: biblical quotes and their source, literary references, named persons, places, or events. Do NOT repeat general information about the work (author, date, genre) — that is already known from the collection context.

Use \\n for newlines inside JSON strings. Return ONLY the JSONL lines, no markdown fences, no extra text.`;
