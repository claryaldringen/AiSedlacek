/** Nejkratší dotaz, pro který se hledá (stejný limit jako `/api/pages/search`). */
export const SEARCH_MIN_QUERY_LENGTH = 2;
/** Nejdelší dotaz – delší API odmítne (400), pole v UI víc znaků nepustí. */
export const SEARCH_MAX_QUERY_LENGTH = 200;
/**
 * Nejvíc stránek, které API v jednom hledání načte a prohledá; při víc
 * kandidátech vrátí `truncated` a UI ukáže „300+“ (navigace jen nad načtenými).
 */
export const SEARCH_RESULT_LIMIT = 300;

/** Pole dokumentu, ve kterých se hledá – jejich uložení mění počty shod. */
const SEARCHABLE_FIELDS: ReadonlySet<string> = new Set(['transcription', 'translation']);

/** Uložení pole `field` mění výsledky hledání (kontext ani glosář se neprohledávají). */
export function affectsSearch(field: string): boolean {
  return SEARCHABLE_FIELDS.has(field);
}

/**
 * Klíč hledání – výsledky platí jen pro tentýž výraz (po ořezu mezer), svazek
 * a jazyk UI (API hledá v překladu do něj). Null = výraz je moc krátký, nehledá se.
 */
export function searchKey(
  query: string,
  collectionId: string | null,
  locale: string,
): string | null {
  const q = query.trim();
  if (q.length < SEARCH_MIN_QUERY_LENGTH) return null;
  return JSON.stringify([q, collectionId, locale]);
}

export interface SearchResultsState<T> {
  key: string;
  results: Map<string, T>;
  /** Hledání pro tento klíč selhalo (síť, chyba serveru) – výsledky jsou prázdné. */
  failed?: boolean;
  /** API načetlo jen prvních SEARCH_RESULT_LIMIT kandidátů – shod může být víc. */
  truncated?: boolean;
}

/**
 * Výsledky pro aktuální výraz, nebo null, dokud nedorazí (během psaní zůstávají
 * v paměti výsledky předchozího výrazu – podle nich se v panelu nesmí listovat).
 */
export function resultsForKey<T>(
  state: SearchResultsState<T> | null,
  key: string | null,
): SearchResultsState<T> | null {
  if (key === null || state === null || state.key !== key) return null;
  return state;
}

/**
 * Výsledky pro zvýraznění v mřížce: poslední platné, dokud nedorazí nové (při
 * psaní nebliká). Bez hledání nic; po chybě hledání nic (neplatí ani staré).
 */
export function gridSearchResults<T>(
  state: SearchResultsState<T> | null,
  key: string | null,
): Map<string, T> | null {
  if (key === null || state === null || state.failed) return null;
  return state.results;
}

export interface SearchNavigation {
  /** Počet shod na aktuální stránce (0 = stránka shodu nemá). */
  matchesOnPage: number;
  /** Pořadí aktuální stránky mezi stránkami se shodou (od 1); null, když shodu nemá. */
  position: number | null;
  /** Počet zobrazených stránek se shodou. */
  total: number;
  /** Nejbližší stránka se shodou před aktuální stránkou, jinak null. */
  previousId: string | null;
  /** Nejbližší stránka se shodou za aktuální stránkou, jinak null. */
  nextId: string | null;
}

const EMPTY: SearchNavigation = {
  matchesOnPage: 0,
  position: null,
  total: 0,
  previousId: null,
  nextId: null,
};

/**
 * Navigace mezi stránkami se shodou v panelu stránky. Pořadí i rozsah určují
 * zobrazené stránky (`pages` v pořadí mřížky – aktuální svazek, resp. stránky
 * mimo svazek), stejně jako stávající předchozí/další stránka; shody na stránkách
 * jinde (hledání v kořeni vrací i stránky ze svazků) se nepočítají. Bez
 * přetečení – za poslední shodou „další“ není, stejně jako u listování stránek.
 * Aktuální stránka bez shody: „předchozí/další“ je nejbližší shoda před/za ní.
 * `results` null = výsledky pro aktuální výraz ještě nejsou (nic se nenabízí).
 */
export function getSearchNavigation(
  pages: readonly { id: string }[],
  currentId: string | null,
  results: ReadonlyMap<string, { matches: number }> | null,
): SearchNavigation {
  if (!results || results.size === 0) return EMPTY;

  const hasMatch = (id: string): boolean => (results.get(id)?.matches ?? 0) > 0;
  const currentIndex = currentId === null ? -1 : pages.findIndex((p) => p.id === currentId);
  const matchesOnPage = currentIndex >= 0 ? (results.get(currentId!)?.matches ?? 0) : 0;

  let total = 0;
  let position: number | null = null;
  let previousId: string | null = null;
  let nextId: string | null = null;
  pages.forEach((page, index) => {
    if (!hasMatch(page.id)) return;
    total += 1;
    if (currentIndex < 0) return;
    if (index < currentIndex) previousId = page.id;
    else if (index === currentIndex) position = total;
    else if (nextId === null) nextId = page.id;
  });

  return { matchesOnPage, position, total, previousId, nextId };
}

export type SearchStatus =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'failed' }
  | { kind: 'none' }
  /** Oříznuté výsledky a aktuální stránka mezi načtenými není – nevíme, zda shodu má. */
  | { kind: 'tooMany'; total: number }
  | {
      kind: 'found';
      position: number | null;
      total: number;
      matchesOnPage: number;
      /** Shod může být víc, než API načetlo („300+“). */
      truncated: boolean;
    };

/**
 * Stav hledání pro panel: bez výrazu nic, během čekání na výsledky aktuálního
 * výrazu „Hledám…“ (ne počty podle předchozího výrazu), chyba, žádná shoda,
 * nebo pozice a počty.
 */
export function searchStatus(
  query: string,
  state: { pending: boolean; failed: boolean; truncated?: boolean },
  nav: SearchNavigation,
): SearchStatus {
  if (query.trim().length < SEARCH_MIN_QUERY_LENGTH) return { kind: 'idle' };
  if (state.pending) return { kind: 'pending' };
  if (state.failed) return { kind: 'failed' };
  // API načetlo jen prvních SEARCH_RESULT_LIMIT stránek: žádná shoda mezi
  // zobrazenými, nebo aktuální stránka mezi načtenými chybí, neznamená „žádná
  // shoda“ – výraz je potřeba upřesnit.
  if (state.truncated && (nav.total === 0 || nav.position === null)) {
    return { kind: 'tooMany', total: nav.total };
  }
  if (nav.total === 0) return { kind: 'none' };
  return {
    kind: 'found',
    position: nav.position,
    total: nav.total,
    matchesOnPage: nav.matchesOnPage,
    truncated: state.truncated ?? false,
  };
}

/** Enter stisknutý dřív, než dorazily výsledky – směr a stránka, na které byl. */
export interface DeferredEnter {
  direction: 'next' | 'previous';
  pageId: string | null;
}

/**
 * Co s odloženým Enterem: zrušit, když panel mezitím ukazuje jinou stránku
 * (ruční listování) nebo je otevřený editor textu; počkat, dokud výsledky
 * nedorazí; pak listovat, jen když je kam.
 */
export function resolveDeferredEnter(
  deferred: DeferredEnter,
  ctx: {
    pageId: string | null;
    pending: boolean;
    editorOpen: boolean;
    nav: Pick<SearchNavigation, 'previousId' | 'nextId'>;
  },
): 'wait' | 'cancel' | 'next' | 'previous' {
  if (deferred.pageId !== ctx.pageId || ctx.editorOpen) return 'cancel';
  if (ctx.pending) return 'wait';
  const target = deferred.direction === 'next' ? ctx.nav.nextId : ctx.nav.previousId;
  return target ? deferred.direction : 'cancel';
}

export type SearchFieldAction =
  | 'next'
  | 'previous'
  | 'defer-next'
  | 'defer-previous'
  | 'clear'
  | 'blur';

/**
 * Klávesa ve vyhledávacím poli panelu: Enter = další stránka se shodou,
 * Shift+Enter = předchozí (bez další shody nic). Když výsledky pro aktuální
 * výraz ještě nedorazily (`pending`), Enter se odloží a provede se až nad nimi –
 * ne nad výsledky předchozího výrazu. Escape nejdřív vymaže hledání a teprve
 * v prázdném poli ho opustí – celý panel zavře až Escape mimo pole.
 */
export function searchFieldKeyAction(
  key: string,
  shiftKey: boolean,
  query: string,
  nav: Pick<SearchNavigation, 'previousId' | 'nextId'> & { pending?: boolean },
): SearchFieldAction | null {
  if (key === 'Enter') {
    if (nav.pending) return shiftKey ? 'defer-previous' : 'defer-next';
    if (shiftKey) return nav.previousId ? 'previous' : null;
    return nav.nextId ? 'next' : null;
  }
  if (key === 'Escape') return query ? 'clear' : 'blur';
  return null;
}
