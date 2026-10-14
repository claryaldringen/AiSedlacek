/**
 * Jazyky, do kterých aplikace překládá. Kód jazyka se vkládá do promptů, proto
 * ho API přijímá jen z tohoto seznamu (volný text by fungoval jako prompt
 * injection a z endpointů dělal obecnou LLM proxy).
 */
export const TRANSLATION_LANGUAGES = ['cs', 'en', 'de', 'fr', 'la'] as const;

export type TranslationLanguage = (typeof TRANSLATION_LANGUAGES)[number];

export function isTranslationLanguage(value: unknown): value is TranslationLanguage {
  return typeof value === 'string' && (TRANSLATION_LANGUAGES as readonly string[]).includes(value);
}
