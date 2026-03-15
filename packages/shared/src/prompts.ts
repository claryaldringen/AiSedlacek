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

export const OCR_TRANSCRIPTION_PROMPT = `Přepiš co nejpřesněji veškerý text na tomto obrázku historického dokumentu.

Pravidla:
- Přepisuj přesně to, co vidíš – nepřekládej, neopravuj pravopis
- Zachovej původní řádkování (každý řádek originálu = jeden řádek výstupu)
- Středověké zkratky přepiš tak, jak vypadají (nerozváděj je)
- Speciální znaky (dlouhé ſ, ligatury, rubriky) přepiš co nejblíže originálu
- Místa, která nedokážeš přečíst, označ jako [...]
- Místa, kde si nejsi jistý, označ jako [?text?]
- Na konec přidej krátkou poznámku o typu písma a jazyce, který rozpoznáváš

DŮLEŽITÉ: Nevymýšlej text, který nevidíš. Raději označ jako nečitelný.`;

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
