import { describe, it, expect } from 'vitest';
import {
  affectsSearch,
  getSearchNavigation,
  gridSearchResults,
  resolveDeferredEnter,
  resultsForKey,
  searchFieldKeyAction,
  searchKey,
  searchStatus,
} from '../search-navigation';

// Stránky v pořadí mřížky
const PAGES = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id }));

function results(entries: Record<string, number>): Map<string, { matches: number }> {
  return new Map(Object.entries(entries).map(([id, matches]) => [id, { matches }]));
}

describe('getSearchNavigation – listování mezi stránkami se shodou v panelu', () => {
  it('aktuální stránka se shodou: pozice „2 / 3“, počet shod na stránce a sousední shody', () => {
    const nav = getSearchNavigation(PAGES, 'p3', results({ p1: 1, p3: 4, p5: 2 }));
    expect(nav).toEqual({
      matchesOnPage: 4,
      position: 2,
      total: 3,
      previousId: 'p1',
      nextId: 'p5',
    });
  });

  it('pořadí podle mřížky, ne podle pořadí výsledků z API', () => {
    // API vrací výsledky v libovolném pořadí – rozhoduje pořadí stránek v mřížce
    const nav = getSearchNavigation(PAGES, 'p2', results({ p5: 1, p4: 1, p1: 1, p2: 1 }));
    expect(nav).toMatchObject({ position: 2, total: 4, previousId: 'p1', nextId: 'p4' });
  });

  it('první a poslední shoda: bez přetečení na druhý konec', () => {
    const r = results({ p2: 1, p4: 1 });
    expect(getSearchNavigation(PAGES, 'p2', r)).toMatchObject({
      position: 1,
      previousId: null,
      nextId: 'p4',
    });
    expect(getSearchNavigation(PAGES, 'p4', r)).toMatchObject({
      position: 2,
      previousId: 'p2',
      nextId: null,
    });
  });

  it('aktuální stránka bez shody: bez pozice, předchozí/další je nejbližší shoda před/za ní', () => {
    const nav = getSearchNavigation(PAGES, 'p3', results({ p1: 2, p2: 1, p4: 3, p5: 1 }));
    expect(nav).toEqual({
      matchesOnPage: 0,
      position: null,
      total: 4,
      previousId: 'p2',
      nextId: 'p4',
    });
  });

  it('shody mimo zobrazené stránky se nepočítají (kořen: hledání vrací i stránky ze svazků)', () => {
    const nav = getSearchNavigation(
      PAGES,
      'p2',
      results({ 'in-collection': 5, p2: 1, 'other-collection': 2, p4: 1 }),
    );
    expect(nav).toMatchObject({ position: 1, total: 2, previousId: null, nextId: 'p4' });
  });

  it('výsledek s nulou shod se nepočítá jako stránka se shodou', () => {
    const nav = getSearchNavigation(PAGES, 'p1', results({ p1: 0, p3: 1 }));
    expect(nav).toMatchObject({ matchesOnPage: 0, position: null, total: 1, nextId: 'p3' });
  });

  it('bez shod (nebo bez hledání) je vše prázdné a tlačítka zakázaná', () => {
    const empty = {
      matchesOnPage: 0,
      position: null,
      total: 0,
      previousId: null,
      nextId: null,
    };
    expect(getSearchNavigation(PAGES, 'p1', null)).toEqual(empty);
    expect(getSearchNavigation(PAGES, 'p1', new Map())).toEqual(empty);
  });

  it('jediná shoda na aktuální stránce: „1 / 1“, obě šipky zakázané', () => {
    expect(getSearchNavigation(PAGES, 'p3', results({ p3: 2 }))).toEqual({
      matchesOnPage: 2,
      position: 1,
      total: 1,
      previousId: null,
      nextId: null,
    });
  });

  it('stránka, která už není mezi zobrazenými (přesunutá, smazaná), nikam nenaviguje', () => {
    const nav = getSearchNavigation(PAGES, 'gone', results({ gone: 3, p1: 1, p2: 1 }));
    expect(nav).toEqual({
      matchesOnPage: 0,
      position: null,
      total: 2,
      previousId: null,
      nextId: null,
    });
  });

  it('žádná otevřená stránka: jen celkový počet', () => {
    expect(getSearchNavigation(PAGES, null, results({ p1: 1, p2: 1 }))).toMatchObject({
      total: 2,
      position: null,
      previousId: null,
      nextId: null,
    });
  });
});

describe('searchFieldKeyAction – klávesnice ve vyhledávacím poli panelu', () => {
  const both = { previousId: 'p1', nextId: 'p3' };
  const none = { previousId: null, nextId: null };

  it('Enter = další stránka se shodou, Shift+Enter = předchozí', () => {
    expect(searchFieldKeyAction('Enter', false, 'anno', both)).toBe('next');
    expect(searchFieldKeyAction('Enter', true, 'anno', both)).toBe('previous');
  });

  it('bez další/předchozí shody Enter nic nedělá', () => {
    expect(searchFieldKeyAction('Enter', false, 'anno', none)).toBeNull();
    expect(searchFieldKeyAction('Enter', true, 'anno', none)).toBeNull();
    expect(searchFieldKeyAction('Enter', false, 'anno', { previousId: 'p1', nextId: null })).toBe(
      null,
    );
  });

  it('Escape nejdřív vymaže hledání, v prázdném poli pole opustí (panel nezavře)', () => {
    expect(searchFieldKeyAction('Escape', false, 'anno', both)).toBe('clear');
    expect(searchFieldKeyAction('Escape', false, '', both)).toBe('blur');
  });

  it('ostatní klávesy (šipky, písmena) pole nechá na psaní', () => {
    expect(searchFieldKeyAction('ArrowLeft', false, 'anno', both)).toBeNull();
    expect(searchFieldKeyAction('ArrowRight', false, 'anno', both)).toBeNull();
    expect(searchFieldKeyAction('a', false, 'anno', both)).toBeNull();
  });

  it('výsledky pro aktuální výraz ještě nedorazily: Enter se odloží, ne nad starými výsledky', () => {
    // previousId/nextId by tu pocházely z výsledků předchozího výrazu
    expect(searchFieldKeyAction('Enter', false, 'anno', { ...both, pending: true })).toBe(
      'defer-next',
    );
    expect(searchFieldKeyAction('Enter', true, 'anno', { ...none, pending: true })).toBe(
      'defer-previous',
    );
    // Escape funguje i během hledání
    expect(searchFieldKeyAction('Escape', false, 'anno', { ...both, pending: true })).toBe('clear');
  });
});

describe('searchKey / resultsForKey – výsledky jen pro aktuální výraz', () => {
  const results = new Map([['p1', { matches: 1 }]]);

  it('klíč nezávisí na mezerách okolo výrazu, ale na výrazu, svazku i jazyku UI', () => {
    expect(searchKey(' anno ', 'col-1', 'cs')).toBe(searchKey('anno', 'col-1', 'cs'));
    expect(searchKey('anno', 'col-1', 'cs')).not.toBe(searchKey('anni', 'col-1', 'cs'));
    expect(searchKey('anno', 'col-1', 'cs')).not.toBe(searchKey('anno', 'col-2', 'cs'));
    expect(searchKey('anno', 'col-1', 'cs')).not.toBe(searchKey('anno', null, 'cs'));
    expect(searchKey('anno', 'col-1', 'cs')).not.toBe(searchKey('anno', 'col-1', 'en'));
  });

  it('výraz kratší než 2 znaky (po ořezu mezer) se nehledá', () => {
    expect(searchKey(' a ', null, 'cs')).toBeNull();
    expect(searchKey('', null, 'cs')).toBeNull();
  });

  it('výsledky předchozího výrazu během psaní neplatí (stav „Hledám…“)', () => {
    const state = { key: searchKey('ann', null, 'cs')!, results };
    expect(resultsForKey(state, searchKey('anno', null, 'cs'))).toBeNull();
    // ani po přepnutí svazku nebo jazyka
    expect(resultsForKey(state, searchKey('ann', 'col-1', 'cs'))).toBeNull();
    expect(resultsForKey(state, searchKey('ann', null, 'en'))).toBeNull();
  });

  it('výsledky pro aktuální výraz platí; bez hledání nic', () => {
    const state = { key: searchKey('anno', null, 'cs')!, results };
    expect(resultsForKey(state, searchKey('anno ', null, 'cs'))).toBe(state);
    expect(resultsForKey(state, null)).toBeNull();
    expect(resultsForKey(null, searchKey('anno', null, 'cs'))).toBeNull();
  });

  it('dokud výsledky nedorazí, navigace nic nenabízí (šipky zakázané)', () => {
    const state = { key: searchKey('ann', null, 'cs')!, results };
    const current = resultsForKey(state, searchKey('anno', null, 'cs'));
    expect(getSearchNavigation(PAGES, 'p2', current?.results ?? null)).toMatchObject({
      total: 0,
      previousId: null,
      nextId: null,
    });
  });
});

describe('searchStatus – co panel ukáže u pole hledání', () => {
  const nav = getSearchNavigation(PAGES, 'p2', results({ p2: 3, p4: 1 }));
  const ready = { pending: false, failed: false };

  it('bez výrazu (nebo s výrazem kratším než 2 znaky) nic', () => {
    expect(searchStatus('', ready, nav)).toEqual({ kind: 'idle' });
    expect(searchStatus(' a ', { pending: true, failed: false }, nav)).toEqual({ kind: 'idle' });
  });

  it('během čekání na výsledky aktuálního výrazu „Hledám…“, ne staré počty', () => {
    expect(searchStatus('anno', { pending: true, failed: false }, nav)).toEqual({
      kind: 'pending',
    });
  });

  it('chyba hledání se nehlásí jako „žádná shoda“', () => {
    expect(searchStatus('anno', { pending: false, failed: true }, nav)).toEqual({
      kind: 'failed',
    });
  });

  it('žádná shoda a nalezené shody s pozicí a počtem na stránce', () => {
    expect(searchStatus('anno', ready, getSearchNavigation(PAGES, 'p2', new Map()))).toEqual({
      kind: 'none',
    });
    expect(searchStatus('anno', ready, nav)).toEqual({
      kind: 'found',
      position: 1,
      total: 2,
      matchesOnPage: 3,
      truncated: false,
    });
  });

  it('API načetlo jen část kandidátů: počet se označí jako neúplný („300+“)', () => {
    expect(searchStatus('anno', { ...ready, truncated: true }, nav)).toMatchObject({
      kind: 'found',
      truncated: true,
    });
  });

  it('oříznuté výsledky bez shody mezi zobrazenými stránkami → „příliš mnoho výsledků“, ne „žádná shoda“', () => {
    const empty = getSearchNavigation(PAGES, 'p2', new Map());
    expect(searchStatus('anno', { ...ready, truncated: true }, empty)).toEqual({
      kind: 'tooMany',
      total: 0,
    });
    // Bez oříznutí je to opravdu žádná shoda
    expect(searchStatus('anno', ready, empty)).toEqual({ kind: 'none' });
  });

  it('oříznuté výsledky a aktuální stránka mezi načtenými chybí → „příliš mnoho výsledků“', () => {
    const outside = getSearchNavigation(PAGES, 'p3', results({ p2: 3, p4: 1 }));
    expect(searchStatus('anno', { ...ready, truncated: true }, outside)).toEqual({
      kind: 'tooMany',
      total: 2,
    });
    // Bez oříznutí stránka shodu prostě nemá („– / 2“)
    expect(searchStatus('anno', ready, outside)).toMatchObject({ kind: 'found', position: null });
  });
});

describe('gridSearchResults – zvýraznění v mřížce během psaní', () => {
  const old = new Map([['p1', { matches: 1 }]]);

  it('mřížka drží poslední platné výsledky, dokud nedorazí nové (nebliká)', () => {
    const state = { key: searchKey('ann', null, 'cs')!, results: old };
    expect(gridSearchResults(state, searchKey('anno', null, 'cs'))).toBe(old);
  });

  it('po chybě hledání ani bez hledání nic nezvýrazní', () => {
    const failed = { key: searchKey('anno', null, 'cs')!, results: new Map(), failed: true };
    expect(gridSearchResults(failed, searchKey('anno', null, 'cs'))).toBeNull();
    expect(gridSearchResults({ key: 'x', results: old }, null)).toBeNull();
    expect(gridSearchResults(null, searchKey('anno', null, 'cs'))).toBeNull();
  });
});

describe('resolveDeferredEnter – Enter stisknutý před příchodem výsledků', () => {
  const nav = { previousId: 'p1', nextId: 'p3' };
  const base = { pageId: 'p2', pending: false, editorOpen: false, nav };

  it('dokud výsledky nedorazí, čeká; pak listuje směrem, kterým byl stisknut', () => {
    expect(
      resolveDeferredEnter({ direction: 'next', pageId: 'p2' }, { ...base, pending: true }),
    ).toBe('wait');
    expect(resolveDeferredEnter({ direction: 'next', pageId: 'p2' }, base)).toBe('next');
    expect(resolveDeferredEnter({ direction: 'previous', pageId: 'p2' }, base)).toBe('previous');
  });

  it('zruší se, když panel mezitím ukazuje jinou stránku (ruční listování)', () => {
    expect(
      resolveDeferredEnter({ direction: 'next', pageId: 'p2' }, { ...base, pageId: 'p5' }),
    ).toBe('cancel');
    expect(
      resolveDeferredEnter(
        { direction: 'next', pageId: 'p2' },
        { ...base, pageId: 'p5', pending: true },
      ),
    ).toBe('cancel');
  });

  it('zruší se při otevření editoru textu', () => {
    expect(
      resolveDeferredEnter({ direction: 'next', pageId: 'p2' }, { ...base, editorOpen: true }),
    ).toBe('cancel');
  });

  it('nová shoda tím směrem není → zruší se', () => {
    expect(
      resolveDeferredEnter(
        { direction: 'next', pageId: 'p2' },
        { ...base, nav: { previousId: 'p1', nextId: null } },
      ),
    ).toBe('cancel');
  });
});

describe('affectsSearch – po uložení kterého pole obnovit počty shod', () => {
  it('přepis a překlad ano, kontext ne', () => {
    expect(affectsSearch('transcription')).toBe(true);
    expect(affectsSearch('translation')).toBe(true);
    expect(affectsSearch('context')).toBe(false);
  });
});
