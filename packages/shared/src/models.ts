/**
 * Modely Claude používané aplikací – jediné místo, kde se mění.
 *
 * Při změně modelu pozor: novější generace (Opus 4.7+) odmítají `temperature`,
 * thinking je u Opus 5.5 vždy zapnutý (řídí se `effort`) a liší se ceny
 * i tokenizer. Ceník pro účtování je v `pricing.ts` – nový model tam musí mít
 * řádek, jinak se účtuje nejdražší sazbou.
 */

/** OCR + překlad + kontext + glosář z obrázku (multimodální). */
export const OCR_MODEL = 'claude-opus-5-5';

/**
 * Úroveň uvažování OCR modelu. Opus 5.5 má thinking vždy zapnutý a `effort`
 * je jediná páka na kvalitu, latenci a cenu; výchozí API hodnota je `medium`,
 * nastavujeme ji explicitně.
 */
export const OCR_EFFORT = 'medium' as const;

/** Textové úlohy: retranslace, chat, kontexty svazků, metadata. */
export const TEXT_MODEL = 'claude-sonnet-4-6';

/**
 * Modely, na které smí OCR požadavek přejít serverovým fallbackem
 * (`fallbacks: 'default'`) – povolené cíle pro Opus 5.5 jsou Opus 5 a Opus 4.8.
 * Fallback rozhoduje API, ale rezervace kreditu před OCR (BIL-1) musí počítat
 * s nejdražší sazbou ze všech modelů, které můžou odpovědět. Při změně
 * `OCR_MODEL` aktualizovat podle `allowed_fallback_models` z `/v1/models`.
 */
export const OCR_FALLBACK_MODELS: readonly string[] = ['claude-opus-5', 'claude-opus-4-8'];
