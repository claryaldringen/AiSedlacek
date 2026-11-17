import { TRANSLATION_LANGUAGES } from '@ai-sedlacek/shared';

function languageRank(language: string): number {
  const index = (TRANSLATION_LANGUAGES as readonly string[]).indexOf(language);
  return index < 0 ? TRANSLATION_LANGUAGES.length : index;
}

/**
 * Překlad, který panel stránky zobrazí – a jen v něm se hledá. Primárně překlad
 * do jazyka UI. Cizí dokument (čtenář sdíleného nebo veřejného svazku) si do
 * svého jazyka nechat přeložit nemůže, proto dostane náhradou jiný existující
 * překlad – vždy tentýž (pořadí `TRANSLATION_LANGUAGES`), ať panel i hledání
 * pracují se stejným textem.
 */
export function visibleTranslation<T extends { language: string }>(
  translations: readonly T[],
  locale: string,
  canEdit: boolean,
): T | undefined {
  const inLocale = translations.find((tr) => tr.language === locale);
  if (inLocale || canEdit) return inLocale;
  return [...translations].sort(
    (a, b) =>
      languageRank(a.language) - languageRank(b.language) || a.language.localeCompare(b.language),
  )[0];
}

/**
 * Jazyky, jejichž překlad má u cizího dokumentu přednost před překladem do
 * `language` (jazyk UI a známé jazyky s vyšší prioritou) – překlad do
 * `language` se zobrazí, jen když dokument žádný z nich nemá. Stejné pořadí
 * jako `visibleTranslation`; slouží k filtru shod v DB. U neznámého jazyka
 * (mimo `TRANSLATION_LANGUAGES`) přebijí všechny známé – pořadí mezi
 * neznámými rozhodne až `visibleTranslation`.
 */
export function languagesOutranking(language: string, locale: string): string[] {
  if (language === locale) return [];
  const rank = languageRank(language);
  return [locale, ...TRANSLATION_LANGUAGES.filter((l) => l !== locale && languageRank(l) < rank)];
}
