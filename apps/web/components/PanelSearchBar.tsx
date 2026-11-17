'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useTranslations } from 'next-intl';
import {
  SEARCH_MAX_QUERY_LENGTH,
  resolveDeferredEnter,
  searchFieldKeyAction,
  searchStatus,
  type DeferredEnter,
  type SearchNavigation,
} from '@/lib/search-navigation';

export interface PanelSearchProps {
  /** Výraz sdílený s hledáním ve workspace (prázdný = hledání vypnuté). */
  query: string;
  /** Změna výrazu – psaní do prázdného pole hledání zapne. */
  onQueryChange: (query: string) => void;
  /** Vymaže výraz a vypne hledání (i v liště nad mřížkou). */
  onClear: () => void;
  /** Navigace nad výsledky aktuálního výrazu (dokud nedorazí, prázdná). */
  navigation: SearchNavigation;
  /** Výsledky pro aktuální výraz ještě nedorazily („Hledám…“). */
  pending: boolean;
  /** Hledání pro aktuální výraz selhalo. */
  failed: boolean;
  /** API načetlo jen část kandidátů – počet stránek se shodou je neúplný („300+“). */
  truncated: boolean;
  /** Otevře stránku `navigation.previousId` stejnou cestou jako listování. */
  onPrevious: () => void;
  /** Otevře stránku `navigation.nextId` stejnou cestou jako listování. */
  onNext: () => void;
}

interface PanelSearchBarProps extends PanelSearchProps {
  /** Stránka v panelu – odložený Enter platí jen pro ni. */
  pageId: string | null;
  /** Otevřený editor textu – odložený Enter se zruší. */
  editorOpen: boolean;
}

const navButton =
  'rounded p-1 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400';

/** Kompaktní hledání v tmavém titulkovém pruhu panelu stránky. */
export const PanelSearchBar = forwardRef<HTMLInputElement, PanelSearchBarProps>(
  function PanelSearchBar(
    {
      query,
      onQueryChange,
      onClear,
      navigation,
      pending,
      failed,
      truncated,
      onPrevious,
      onNext,
      pageId,
      editorOpen,
    },
    ref,
  ) {
    const t = useTranslations('document');
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);
    const { previousId, nextId } = navigation;
    const status = searchStatus(query, { pending, failed, truncated }, navigation);

    // Enter stisknutý dřív, než dorazily výsledky aktuálního výrazu – provede se
    // nad nimi (rychlé „napsat a odentrovat“), ne nad výsledky předchozího výrazu.
    // Platí jen pro stránku, na které byl stisknut; ruční listování nebo otevření
    // editoru ho zruší.
    const deferredRef = useRef<DeferredEnter | null>(null);
    useEffect(() => {
      const deferred = deferredRef.current;
      if (!deferred) return;
      const outcome = resolveDeferredEnter(deferred, {
        pageId,
        pending,
        editorOpen,
        nav: navigation,
      });
      if (outcome === 'wait') return;
      deferredRef.current = null;
      if (outcome === 'next') onNext();
      else if (outcome === 'previous') onPrevious();
    }, [pageId, pending, editorOpen, navigation, onNext, onPrevious]);

    // „Příliš mnoho výsledků“ je v pruhu krátce (celá věta v tooltipu a pro
    // čtečky) – hledání se na md+ nezmenšuje a delší text by tlačil na akce vpravo
    const visibleStatus =
      status.kind === 'pending'
        ? t('searchSearching')
        : status.kind === 'failed'
          ? t('searchFailed')
          : status.kind === 'none'
            ? t('searchNoMatch')
            : status.kind === 'tooMany'
              ? t('searchTooManyShort')
              : null;
    const spokenStatus =
      status.kind === 'found'
        ? (status.position === null
            ? t('searchStatusOutside', { total: status.total })
            : t('searchStatusOnPage', {
                position: status.position,
                total: status.total,
                count: status.matchesOnPage,
              })) + (status.truncated ? ` ${t('searchTruncatedNote')}` : '')
        : status.kind === 'tooMany'
          ? t('searchTooMany')
          : (visibleStatus ?? '');
    // Neúplný počet (API načetlo jen prvních SEARCH_RESULT_LIMIT stránek) – „300+“
    const totalLabel =
      status.kind === 'found' ? `${status.total}${status.truncated ? '+' : ''}` : '';

    return (
      <div role="search" className="flex min-w-0 flex-1 items-center gap-1">
        <div className="relative min-w-[6rem] max-w-xs flex-1 md:w-44 md:flex-initial">
          <svg
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            maxLength={SEARCH_MAX_QUERY_LENGTH}
            onChange={(e) => {
              deferredRef.current = null;
              onQueryChange(e.target.value);
            }}
            onKeyDown={(e) => {
              // Potvrzení kandidáta IME (Enter/Escape při psaní diakritiky) není navigace
              if (e.nativeEvent.isComposing) return;
              const action = searchFieldKeyAction(e.key, e.shiftKey, query, {
                previousId,
                nextId,
                pending,
              });
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                // Escape v poli nesmí zavřít panel (ten reaguje na Escape mimo pole)
                e.stopPropagation();
              }
              if (action === 'next') onNext();
              else if (action === 'previous') onPrevious();
              else if (action === 'defer-next') deferredRef.current = { direction: 'next', pageId };
              else if (action === 'defer-previous')
                deferredRef.current = { direction: 'previous', pageId };
              else if (action === 'clear') {
                deferredRef.current = null;
                onClear();
              } else if (action === 'blur') e.currentTarget.blur();
            }}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            spellCheck={false}
            autoComplete="off"
            className="w-full rounded bg-slate-700 py-1 pl-7 pr-6 text-xs text-white placeholder-slate-400 outline-none ring-1 ring-slate-600 focus:ring-blue-400"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => {
                deferredRef.current = null;
                onClear();
                // Tlačítko po vymazání zmizí – fokus zpět do pole, ne na <body>
                inputRef.current?.focus();
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-white"
              aria-label={t('searchClear')}
              title={t('searchClear')}
            >
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Čtečkám celou větou; oblast zůstává v DOM i prázdná, ať se změny ohlásí */}
        <span aria-live="polite" className="sr-only">
          {spokenStatus}
        </span>
        {status.kind !== 'idle' && (
          <span
            aria-hidden="true"
            className="shrink-0 whitespace-nowrap text-xs tabular-nums text-slate-400"
          >
            {status.kind === 'found' ? (
              <>
                <span
                  title={
                    status.truncated
                      ? `${t('searchPagesWithMatch', { total: status.total })} ${t('searchTruncatedNote')}`
                      : t('searchPagesWithMatch', { total: status.total })
                  }
                >
                  {status.position === null
                    ? t('searchPositionOutside', { total: totalLabel })
                    : t('searchPosition', { position: status.position, total: totalLabel })}
                </span>
                {status.matchesOnPage > 0 && (
                  <span
                    className="ml-1.5 hidden text-slate-300 md:inline"
                    title={t('searchMatchesOnPage', { count: status.matchesOnPage })}
                  >
                    {t('searchMatchesOnPageShort', { count: status.matchesOnPage })}
                  </span>
                )}
              </>
            ) : status.kind === 'tooMany' ? (
              <span className="text-amber-300" title={t('searchTooMany')}>
                {visibleStatus}
              </span>
            ) : (
              visibleStatus
            )}
          </span>
        )}

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={onPrevious}
            disabled={!previousId}
            className={navButton}
            aria-label={t('searchPreviousMatch')}
            title={t('searchPreviousMatch')}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={!nextId}
            className={navButton}
            aria-label={t('searchNextMatch')}
            title={t('searchNextMatch')}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </div>
      </div>
    );
  },
);
