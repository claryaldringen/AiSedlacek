import type { ChangedFile, WorkspaceFile } from './workspace.js';

/** Překlad dokumentu tak, jak ho vrací API (`document.translations[]`). */
export interface ServerTranslation {
  language: string;
  text: string;
  createdAt?: string;
}

/** Podmnožina dokumentu z API, se kterou CLI pracuje při pull/push. */
export interface ServerDocument {
  id?: string;
  transcription?: string;
  context?: string;
  updatedAt?: string;
  translations?: ServerTranslation[];
}

export interface PickedTranslation {
  /** Jazyk překladu, který se uloží do translation.md (undefined = dokument nemá překlad). */
  language?: string;
  text: string;
  /** Všechny jazyky, ve kterých dokument překlad má (seřazené). */
  available: string[];
}

/**
 * Vybere překlad pro translation.md deterministicky:
 * 1. explicitně požadovaný jazyk (i když na serveru zatím neexistuje → prázdný text),
 * 2. jinak nejstarší překlad (původní výstup OCR), při shodě podle kódu jazyka.
 *
 * Dříve se bral `translations[0]`, jehož pořadí databáze negarantuje.
 */
export function pickTranslation(
  translations: ServerTranslation[] | undefined,
  preferredLanguage?: string,
): PickedTranslation {
  const list = translations ?? [];
  const available = [...new Set(list.map((t) => t.language))].sort();

  if (preferredLanguage) {
    const match = list.find((t) => t.language === preferredLanguage);
    return { language: preferredLanguage, text: match?.text ?? '', available };
  }

  if (list.length === 0) {
    return { language: undefined, text: '', available };
  }

  const sorted = [...list].sort((a, b) => {
    const ta = a.createdAt ? Date.parse(a.createdAt) : Number.POSITIVE_INFINITY;
    const tb = b.createdAt ? Date.parse(b.createdAt) : Number.POSITIVE_INFINITY;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return a.language.localeCompare(b.language);
  });
  const first = sorted[0] as ServerTranslation;
  return { language: first.language, text: first.text, available };
}

export type PushLanguageResolution =
  | { ok: true; language: string; warning?: string }
  | { ok: false; error: string; hint?: string };

/**
 * Určí jazyk, pod kterým push uloží translation.md.
 * - Metadata z pull mají přednost (`--lang` se pak jen ohlásí jako ignorovaný).
 * - Workspace ze starší verze CLI jazyk nemají: použije se `--lang`, ale jen pokud na
 *   serveru existuje (překlep by jinak tiše založil nový překlad), jinak jediný překlad
 *   na serveru. Víc překladů bez `--lang` = chyba, nehádáme.
 */
export function resolvePushLanguage(
  metaLanguage: string | undefined,
  cliLanguage: string | undefined,
  serverLanguages: string[] | undefined,
): PushLanguageResolution {
  if (metaLanguage) {
    if (cliLanguage && cliLanguage !== metaLanguage) {
      return {
        ok: true,
        language: metaLanguage,
        warning: `--lang ${cliLanguage} ignoruji – translation.md je stažený v jazyce ${metaLanguage}`,
      };
    }
    return { ok: true, language: metaLanguage };
  }

  const languages = [...new Set(serverLanguages ?? [])].sort();
  const available = languages.length > 0 ? languages.join(', ') : 'žádné';

  if (cliLanguage) {
    if (!languages.includes(cliLanguage)) {
      return {
        ok: false,
        error: `dokument nemá překlad v jazyce ${cliLanguage} (dostupné: ${available})`,
        hint: 'Nový jazyk založíte přes `ais pull <pageId> --lang <kód>`',
      };
    }
    return { ok: true, language: cliLanguage };
  }

  if (languages.length === 1) {
    const language = languages[0] as string;
    return {
      ok: true,
      language,
      warning: `jazyk překladu převzat ze serveru (jediný existující): ${language}`,
    };
  }

  return {
    ok: false,
    error: `nelze určit jazyk překladu (dostupné: ${available})`,
    hint: 'Zadejte jazyk přes --lang <kód>, např. ais push <pageId> --lang cs',
  };
}

export interface DocumentPatch {
  transcription?: string;
  translation?: string;
  translationLanguage?: string;
  context?: string;
}

/**
 * Sestaví tělo PATCH /api/documents/:id z lokálně změněných souborů.
 * Překlad se posílá vždy spolu s jazykem – server bez něj překlad neuloží.
 */
export function buildDocumentPatch(
  changed: ChangedFile[],
  files: Record<WorkspaceFile, string>,
  translationLanguage: string | undefined,
): DocumentPatch {
  const patch: DocumentPatch = {};
  for (const c of changed) {
    if (c.file === 'transcription.md') patch.transcription = files['transcription.md'];
    if (c.file === 'context.md') patch.context = files['context.md'];
    if (c.file === 'translation.md') {
      if (!translationLanguage) {
        throw new Error('chybí jazyk překladu (translationLanguage)');
      }
      patch.translation = files['translation.md'];
      patch.translationLanguage = translationLanguage;
    }
  }
  return patch;
}

/**
 * Ověří, že dokument vrácený serverem po PATCH opravdu obsahuje odeslané hodnoty.
 * Vrací seznam souborů, jejichž změnu server nepotvrdil (prázdné pole = vše uloženo).
 * Chrání před tichou ztrátou dat, kdy server část požadavku ignoruje a vrátí 200.
 */
export function findUnconfirmedFiles(
  patch: DocumentPatch,
  updated: ServerDocument | null | undefined,
): WorkspaceFile[] {
  const unconfirmed: WorkspaceFile[] = [];

  if (patch.transcription !== undefined && updated?.transcription !== patch.transcription) {
    unconfirmed.push('transcription.md');
  }
  if (patch.context !== undefined && updated?.context !== patch.context) {
    unconfirmed.push('context.md');
  }
  if (patch.translation !== undefined) {
    const saved = updated?.translations?.find((t) => t.language === patch.translationLanguage);
    if (saved?.text !== patch.translation) unconfirmed.push('translation.md');
  }

  return unconfirmed;
}
