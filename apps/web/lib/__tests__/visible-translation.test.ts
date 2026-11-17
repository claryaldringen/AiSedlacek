import { describe, it, expect } from 'vitest';
import { languagesOutranking, visibleTranslation } from '../visible-translation';

describe('languagesOutranking – kdy se překlad u cizího dokumentu zobrazí (filtr v DB)', () => {
  it('jazyk UI nic nepřebije', () => {
    expect(languagesOutranking('cs', 'cs')).toEqual([]);
  });

  it('jiný jazyk přebije jazyk UI a známé jazyky s vyšší prioritou', () => {
    // Pořadí cs, en, de, fr, la; UI v češtině
    expect(languagesOutranking('en', 'cs')).toEqual(['cs']);
    expect(languagesOutranking('de', 'cs')).toEqual(['cs', 'en']);
    expect(languagesOutranking('la', 'cs')).toEqual(['cs', 'en', 'de', 'fr']);
    // UI v angličtině: čeština má pořád přednost před němčinou
    expect(languagesOutranking('de', 'en')).toEqual(['en', 'cs']);
  });

  it('neznámý jazyk přebijí všechny známé', () => {
    expect(languagesOutranking('xx', 'cs')).toEqual(['cs', 'en', 'de', 'fr', 'la']);
  });

  it('souhlasí s visibleTranslation: zobrazí se právě překlad, který nikdo nepřebije', () => {
    const docs = [['de', 'la'], ['en', 'de'], ['fr'], ['cs', 'en'], ['la', 'xx']];
    for (const languages of docs) {
      const shown = visibleTranslation(
        languages.map((language) => ({ language })),
        'cs',
        false,
      )?.language;
      const byFilter = languages.filter((language) =>
        languagesOutranking(language, 'cs').every((l) => !languages.includes(l)),
      );
      expect(byFilter).toEqual([shown]);
    }
  });
});

const tr = (language: string): { language: string; text: string } => ({
  language,
  text: `text-${language}`,
});

describe('visibleTranslation – překlad zobrazený v panelu (a prohledávaný)', () => {
  it('vlastní i cizí dokument: překlad do jazyka UI má přednost', () => {
    const translations = [tr('en'), tr('cs'), tr('de')];
    expect(visibleTranslation(translations, 'cs', true)?.language).toBe('cs');
    expect(visibleTranslation(translations, 'cs', false)?.language).toBe('cs');
  });

  it('vlastní dokument bez překladu do jazyka UI nic nezobrazí (nabídka přeložit)', () => {
    expect(visibleTranslation([tr('en'), tr('de')], 'cs', true)).toBeUndefined();
  });

  it('cizí dokument bez překladu do jazyka UI: náhrada vždy stejná bez ohledu na pořadí z DB', () => {
    expect(visibleTranslation([tr('la'), tr('de'), tr('en')], 'cs', false)?.language).toBe('en');
    expect(visibleTranslation([tr('en'), tr('la'), tr('de')], 'cs', false)?.language).toBe('en');
    expect(visibleTranslation([tr('fr'), tr('de')], 'cs', false)?.language).toBe('de');
  });

  it('neznámý jazyk až za známými, mezi sebou abecedně', () => {
    expect(visibleTranslation([tr('xx'), tr('la')], 'cs', false)?.language).toBe('la');
    expect(visibleTranslation([tr('zz'), tr('aa')], 'cs', false)?.language).toBe('aa');
  });

  it('dokument bez překladů nemá co zobrazit', () => {
    expect(visibleTranslation([], 'cs', false)).toBeUndefined();
  });
});
