/**
 * Otevřené editory textu v panelu stránky (přepis, překlad, kontext). Rozepsaný
 * text žije jen v editoru – přepnutí na jinou stránku by ho zahodilo.
 */
export class OpenEditorTracker {
  private readonly open = new Set<string>();

  /** Zaznamená stav editoru `id`; vrací true, když je otevřený aspoň jeden editor. */
  set(id: string, editing: boolean): boolean {
    if (editing) this.open.add(id);
    else this.open.delete(id);
    return this.open.size > 0;
  }
}

export type NavNoticeEvent = 'blocked' | 'timeout' | 'page-changed' | 'editor-closed';

/**
 * Hláška o zablokovaném listování (0 = skrytá; každé další zablokování ji
 * zvýší, a tím restartuje časovač). Zmizí po vypršení, při přepnutí stránky
 * i po zavření editoru – pak už neplatí.
 */
export function navNoticeReducer(state: number, event: NavNoticeEvent): number {
  return event === 'blocked' ? state + 1 : 0;
}

/**
 * Přepnutí stránky z panelu (předchozí/další stránka, listování shodami
 * hledání): s otevřeným editorem se neprovede – zavolá `onBlocked` (krátká
 * hláška), aby rozepsaný text nezmizel. Vrací, zda se přepnulo.
 */
export function guardPanelNavigation(
  editorOpen: boolean,
  navigate: () => void,
  onBlocked: () => void,
): boolean {
  if (editorOpen) {
    onBlocked();
    return false;
  }
  navigate();
  return true;
}
