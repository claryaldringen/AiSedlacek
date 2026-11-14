/**
 * Panel dokumentu ve workspace ukazuje vždy jen jeden dokument. Aktualizace
 * a načtení, která doběhnou až po přepnutí na jinou stránku, se do něj nesmí
 * propsat – jinak by pod obrázkem stránky B stál obsah dokumentu A a editace
 * i placený chat by šly do A.
 */

/**
 * Aktualizace výsledku v panelu jen pro dokument, který panel pořád ukazuje.
 * Pro funkční update stavu: `setResult((prev) => applyResultUpdate(prev, updated))`.
 * Zastaralý snímek (rollback optimistické úpravy, doběhlé uložení či
 * retranslace po přepnutí stránky) panel nezmění.
 */
export function applyResultUpdate<T extends { id: string }>(
  current: T | null,
  updated: T,
): T | null {
  return current !== null && current.id === updated.id ? updated : current;
}

/** Jedno otevření stránky v panelu. */
export interface PanelLoad {
  /** Pro `fetch` – předchozí rozpracované načtení se při dalším otevření přeruší. */
  signal: AbortSignal;
  /** Je tohle pořád poslední otevření (výsledek se smí zapsat do panelu)? */
  isCurrent: () => boolean;
}

/**
 * Hlídá naposledy otevíranou stránku panelu. Rychlé listování A → B → C:
 * když odpověď pro B doběhne až po C, `isCurrent()` u B vrátí false a panel
 * zůstane na C; načtení B se navíc přeruší přes `signal`.
 */
export class PanelLoadGuard {
  private controller: AbortController | null = null;
  private pageId: string | null = null;

  /** Začátek otevření stránky – předchozí otevření přestane být aktuální. */
  begin(pageId: string): PanelLoad {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.pageId = pageId;
    return {
      signal: controller.signal,
      isCurrent: () => this.controller === controller,
    };
  }

  /** Panel zavřen (nebo stránka smazána) – rozpracované načtení se zahodí. */
  close(): void {
    this.controller?.abort();
    this.controller = null;
    this.pageId = null;
  }

  /** Ukazuje panel pořád stránku `pageId`? (např. po doběhlé regeneraci) */
  isOpen(pageId: string): boolean {
    return this.controller !== null && this.pageId === pageId;
  }
}
