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

export interface ResultPatchOptions<T> {
  /** Patch nese pole překladu tohoto jazyka – panel s jiným jazykem nezmění. */
  translationLanguage?: string | null;
  /** Zapsat jen když panel tato pole pořád má (rollback optimistické úpravy). */
  expected?: Partial<T>;
}

/**
 * Zapíše do panelu jen změněná pole dokumentu `documentId` nad jeho aktuálním
 * stavem – pro uložení pole, použití návrhu z chatu (a rollback) a doběhlou
 * retranslaci. Celý snímek `{ ...result, … }` z doby, kdy akce začala, by vrátil
 * změny uložené mezitím (kontext, návrh z chatu, spotřebu chatu).
 * Pro funkční update: `setResult((prev) => applyResultPatch(prev, id, patch, opts))`.
 */
export function applyResultPatch<T extends { id: string; translationLanguage?: string | null }>(
  current: T | null,
  documentId: string,
  patch: Partial<T>,
  options: ResultPatchOptions<T> = {},
): T | null {
  if (current === null || current.id !== documentId) return current;
  if (
    options.translationLanguage !== undefined &&
    current.translationLanguage !== options.translationLanguage
  ) {
    return current;
  }
  if (options.expected) {
    for (const [key, value] of Object.entries(options.expected)) {
      if (current[key as keyof T] !== value) return current;
    }
  }
  return { ...current, ...patch };
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
