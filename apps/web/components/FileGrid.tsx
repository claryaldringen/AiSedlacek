'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { Collection } from './Sidebar';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';

export interface PageItem {
  id: string;
  filename: string;
  imageUrl: string;
  status: string;
  order: number;
  collectionId: string | null;
  createdAt?: string;
  errorMessage?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  document?: {
    id: string;
    detectedLanguage: string;
    translations: { language: string }[];
  } | null;
}

interface FileGridProps {
  pages: PageItem[];
  collections: Collection[];
  selected: Set<string>;
  /** Called for click events with modifier info; page.tsx manages the selection set. */
  onItemClick: (id: string, e: React.MouseEvent) => void;
  /** Double-click on a done page opens the document panel. */
  onPageDoubleClick: (page: PageItem) => void;
  /** Double-click on a collection navigates into it. */
  onCollectionDoubleClick: (id: string) => void;
  processingPageIds: Set<string>;
  showCollections?: boolean;
  onMovePages?: (pageIds: string[], targetCollectionId: string) => void;
  /** Replace the whole selection (used for rubber band, context menu, etc.) */
  onSetSelected: (selected: Set<string>) => void;
  /** Select all items */
  onSelectAll: () => void;
  /** Deselect all */
  onDeselectAll: () => void;
  /** Process selected pages */
  onProcessSelected: () => void;
  /** Delete selected pages */
  onDeleteSelected: () => void;
  /** Open upload dialog */
  onUploadClick: () => void;
  /** The item that currently has keyboard focus (shows focus ring) */
  focusedItemId?: string | null;
  /** Called whenever the actual column count of the grid changes */
  onColumnsChange?: (columns: number) => void;
}

function cleanFilename(raw: string): string {
  return raw.replace(/^[a-f0-9-]+-/, '');
}

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  switch (status) {
    case 'done':
      return (
        <span
          title="Zpracovano"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 shadow"
        >
          <svg
            className="h-3 w-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </span>
      );
    case 'processing':
      return (
        <span
          title="Zpracovava se"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 shadow"
        >
          <svg className="h-3 w-3 animate-spin text-white" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-30"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-80"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </span>
      );
    case 'error':
      return (
        <span
          title="Chyba"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 shadow"
        >
          <svg
            className="h-3 w-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </span>
      );
    default:
      return (
        <span
          title="Ceka na zpracovani"
          className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-400 shadow"
        >
          <svg
            className="h-3 w-3 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <circle cx="12" cy="12" r="3" fill="currentColor" />
          </svg>
        </span>
      );
  }
}

// ---------- Icons for context menu ----------
function OpenIcon(): React.JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
      />
    </svg>
  );
}

function ProcessIcon(): React.JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
      />
    </svg>
  );
}

function MoveIcon(): React.JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776"
      />
    </svg>
  );
}

function DeleteIcon(): React.JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  );
}

function SelectAllIcon(): React.JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    </svg>
  );
}

function UploadIcon(): React.JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5"
      />
    </svg>
  );
}

function RenameIcon(): React.JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
      />
    </svg>
  );
}

// ---------- Rubber band selection ----------
interface RubberBandRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

function getRectFromBand(band: RubberBandRect): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const left = Math.min(band.startX, band.currentX);
  const top = Math.min(band.startY, band.currentY);
  const width = Math.abs(band.currentX - band.startX);
  const height = Math.abs(band.currentY - band.startY);
  return { left, top, width, height };
}

function rectsIntersect(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): boolean {
  return !(
    a.left + a.width < b.left ||
    b.left + b.width < a.left ||
    a.top + a.height < b.top ||
    b.top + b.height < a.top
  );
}

// ---------- Main component ----------
export function FileGrid({
  pages,
  collections,
  selected,
  onItemClick,
  onPageDoubleClick,
  onCollectionDoubleClick,
  processingPageIds,
  showCollections = true,
  onMovePages,
  onSetSelected,
  onSelectAll,
  onDeselectAll,
  onProcessSelected,
  onDeleteSelected,
  onUploadClick,
  focusedItemId,
  onColumnsChange,
}: FileGridProps): React.JSX.Element {
  const [dragOverCollectionId, setDragOverCollectionId] = useState<string | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuEntry[];
  } | null>(null);

  // Rubber band state
  const [rubberBand, setRubberBand] = useState<RubberBandRect | null>(null);
  const rubberBandRef = useRef<RubberBandRect | null>(null);
  const rubberBandCtrlRef = useRef(false);
  const rubberBandInitialSelectionRef = useRef<Set<string>>(new Set());

  // Container ref for rubber band and item position tracking
  const containerRef = useRef<HTMLDivElement>(null);
  // Map of item ID -> DOM element ref for rubber band intersection
  const itemRefsMap = useRef<Map<string, HTMLElement>>(new Map());

  // Grid ref to observe column count (the pages grid)
  const pagesGridRef = useRef<HTMLDivElement>(null);
  const collectionsGridRef = useRef<HTMLDivElement>(null);
  const onColumnsChangeRef = useRef(onColumnsChange);
  onColumnsChangeRef.current = onColumnsChange;

  // Detect column count from a grid element using computed style
  const detectColumns = useCallback((gridEl: HTMLElement): number => {
    const style = window.getComputedStyle(gridEl);
    const templateCols = style.gridTemplateColumns;
    if (!templateCols || templateCols === 'none') return 1;
    return templateCols.trim().split(/\s+/).length;
  }, []);

  // ResizeObserver to detect column count changes in the pages grid
  useEffect(() => {
    const gridEl = pagesGridRef.current ?? collectionsGridRef.current;
    if (!gridEl) return;

    let lastCols = 0;
    const observer = new ResizeObserver(() => {
      const cols = detectColumns(gridEl);
      if (cols !== lastCols) {
        lastCols = cols;
        onColumnsChangeRef.current?.(cols);
      }
    });
    observer.observe(gridEl);
    // Fire immediately
    const initial = detectColumns(gridEl);
    lastCols = initial;
    onColumnsChangeRef.current?.(initial);

    return () => observer.disconnect();
  }, [detectColumns, pages.length, collections.length]);

  // Scroll focused item into view whenever focusedItemId changes
  useEffect(() => {
    if (focusedItemId == null) return;
    const el = itemRefsMap.current.get(focusedItemId);
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [focusedItemId]);

  // Touch long-press for mobile
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectionModeTouch, setSelectionModeTouch] = useState(false);

  const getDraggedPageIds = (e: React.DragEvent): string[] => {
    try {
      const raw = e.dataTransfer.getData('application/x-page-ids');
      if (raw) return JSON.parse(raw) as string[];
    } catch {
      // ignore
    }
    return [];
  };

  const registerItemRef = useCallback((id: string, el: HTMLElement | null): void => {
    if (el) {
      itemRefsMap.current.set(id, el);
    } else {
      itemRefsMap.current.delete(id);
    }
  }, []);

  // ---------- Context menu builders ----------
  const buildPageContextMenu = useCallback(
    (page: PageItem): ContextMenuEntry[] => {
      const isDone = page.status === 'done';
      const selCount = selected.size;
      const items: ContextMenuEntry[] = [];

      items.push({
        label: 'Otevrit',
        icon: <OpenIcon />,
        onClick: () => onPageDoubleClick(page),
      });

      items.push({
        label: 'Zpracovat',
        icon: <ProcessIcon />,
        onClick: onProcessSelected,
        disabled: isDone,
      });

      items.push({
        label: 'Presunout do...',
        icon: <MoveIcon />,
        onClick: () => {
          // Placeholder – we could show a sub-menu, but for now we just hint
        },
        disabled: true,
      });

      items.push({ type: 'divider' });

      items.push({
        label: selCount > 1 ? `Smazat (${String(selCount)})` : 'Smazat',
        icon: <DeleteIcon />,
        onClick: onDeleteSelected,
        variant: 'danger',
      });

      return items;
    },
    [selected.size, onPageDoubleClick, onProcessSelected, onDeleteSelected],
  );

  const buildCollectionContextMenu = useCallback(
    (col: Collection): ContextMenuEntry[] => {
      return [
        {
          label: 'Otevrit',
          icon: <OpenIcon />,
          onClick: () => onCollectionDoubleClick(col.id),
        },
        {
          label: 'Prejmenovat',
          icon: <RenameIcon />,
          onClick: () => {
            // Placeholder for rename
          },
          disabled: true,
        },
        { type: 'divider' },
        {
          label: 'Smazat',
          icon: <DeleteIcon />,
          onClick: () => {
            // Placeholder for collection delete
          },
          variant: 'danger',
          disabled: true,
        },
      ];
    },
    [onCollectionDoubleClick],
  );

  const buildEmptyContextMenu = useCallback((): ContextMenuEntry[] => {
    return [
      {
        label: 'Vybrat vse',
        icon: <SelectAllIcon />,
        onClick: onSelectAll,
      },
      {
        label: 'Nahrat',
        icon: <UploadIcon />,
        onClick: onUploadClick,
      },
    ];
  }, [onSelectAll, onUploadClick]);

  // ---------- Right-click handler ----------
  const handleContextMenu = useCallback(
    (
      e: React.MouseEvent,
      type: 'page' | 'collection' | 'empty',
      item?: PageItem | Collection,
    ): void => {
      e.preventDefault();
      e.stopPropagation();

      if (type === 'page' && item && 'filename' in item) {
        const page = item as PageItem;
        // If right-clicked on unselected item, select it first
        if (!selected.has(page.id)) {
          onSetSelected(new Set([page.id]));
        }
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: buildPageContextMenu(page),
        });
      } else if (type === 'collection' && item && 'name' in item) {
        const col = item as Collection;
        onSetSelected(new Set([col.id]));
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: buildCollectionContextMenu(col),
        });
      } else {
        // Empty space
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: buildEmptyContextMenu(),
        });
      }
    },
    [
      selected,
      onSetSelected,
      buildPageContextMenu,
      buildCollectionContextMenu,
      buildEmptyContextMenu,
    ],
  );

  // ---------- Rubber band (lasso) selection ----------
  const handleMouseDownOnEmpty = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      // Only left button, and only on the container itself (not on items)
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Check if mouse down was on the grid background, not on a child item
      if (target !== containerRef.current && !target.classList.contains('filegrid-bg')) return;

      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!containerRect) return;

      const startX = e.clientX;
      const startY = e.clientY;

      rubberBandRef.current = { startX, startY, currentX: startX, currentY: startY };
      rubberBandCtrlRef.current = e.metaKey || e.ctrlKey;
      rubberBandInitialSelectionRef.current = rubberBandCtrlRef.current
        ? new Set(selected)
        : new Set<string>();

      // We start tracking but don't show the band until mouse moves a bit
      const handleMouseMove = (moveE: MouseEvent): void => {
        if (!rubberBandRef.current) return;
        rubberBandRef.current = {
          ...rubberBandRef.current,
          currentX: moveE.clientX,
          currentY: moveE.clientY,
        };

        const band = rubberBandRef.current;
        const dist = Math.abs(band.currentX - band.startX) + Math.abs(band.currentY - band.startY);

        if (dist > 5) {
          setRubberBand({ ...band });

          // Compute which items intersect
          const bandRect = getRectFromBand(band);
          const newSelected = new Set(rubberBandInitialSelectionRef.current);

          for (const [id, el] of itemRefsMap.current) {
            const elRect = el.getBoundingClientRect();
            const itemRect = {
              left: elRect.left,
              top: elRect.top,
              width: elRect.width,
              height: elRect.height,
            };
            if (rectsIntersect(bandRect, itemRect)) {
              newSelected.add(id);
            }
          }

          onSetSelected(newSelected);
        }
      };

      const handleMouseUp = (): void => {
        rubberBandRef.current = null;
        setRubberBand(null);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [selected, onSetSelected],
  );

  // ---------- Click on empty space = deselect ----------
  const handleContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>): void => {
      const target = e.target as HTMLElement;
      // Only deselect if clicking directly on the grid background
      if (target === containerRef.current || target.classList.contains('filegrid-bg')) {
        if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
          onDeselectAll();
        }
      }
    },
    [onDeselectAll],
  );

  // ---------- Touch long-press for mobile ----------
  const handleTouchStart = useCallback(
    (id: string): void => {
      touchTimerRef.current = setTimeout(() => {
        setSelectionModeTouch(true);
        onSetSelected(new Set([id]));
      }, 500);
    },
    [onSetSelected],
  );

  const handleTouchEnd = useCallback((): void => {
    if (touchTimerRef.current !== null) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }, []);

  const handleTouchMove = useCallback((): void => {
    if (touchTimerRef.current !== null) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  }, []);

  // Cleanup touch timer
  useEffect(() => {
    return () => {
      if (touchTimerRef.current !== null) {
        clearTimeout(touchTimerRef.current);
      }
    };
  }, []);

  if (pages.length === 0 && collections.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <svg
          className="mb-4 h-16 w-16 text-slate-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776"
          />
        </svg>
        <p className="text-slate-500">Tato slozka je prazdna.</p>
        <p className="mt-1 text-sm text-slate-400">
          Nahrajte obrazky tlacitkem &quot;Nahrat&quot; vyse.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="filegrid-bg relative select-none p-4"
      onMouseDown={handleMouseDownOnEmpty}
      onClick={handleContainerClick}
      onContextMenu={(e) => {
        const target = e.target as HTMLElement;
        if (target === containerRef.current || target.classList.contains('filegrid-bg')) {
          handleContextMenu(e, 'empty');
        }
      }}
    >
      {/* Collections (folders) */}
      {showCollections && collections.length > 0 && (
        <div className="filegrid-bg mb-6">
          <h3 className="filegrid-bg mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Svazky
          </h3>
          <div
            ref={collectionsGridRef}
            className="filegrid-bg grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
          >
            {collections.map((col) => {
              const isColSelected = selected.has(col.id);
              const isColFocused = focusedItemId === col.id;
              return (
                <div
                  key={col.id}
                  ref={(el) => registerItemRef(col.id, el)}
                  onClick={(e) => {
                    e.stopPropagation();
                    onItemClick(col.id, e);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onCollectionDoubleClick(col.id);
                  }}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                    handleContextMenu(e, 'collection', col);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverCollectionId(col.id);
                  }}
                  onDragLeave={() => setDragOverCollectionId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverCollectionId(null);
                    const ids = getDraggedPageIds(e);
                    if (ids.length > 0) onMovePages?.(ids, col.id);
                  }}
                  className={[
                    'group relative cursor-pointer rounded-lg border-2 transition-all',
                    isColSelected
                      ? 'border-blue-500 bg-blue-50/60 shadow-md shadow-blue-100'
                      : dragOverCollectionId === col.id
                        ? 'border-blue-500 bg-blue-50 shadow-md'
                        : 'border-transparent hover:border-slate-300 hover:shadow-sm',
                    isColFocused ? 'outline outline-2 outline-offset-2 outline-blue-400' : '',
                  ].join(' ')}
                >
                  <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md bg-amber-50">
                    <svg
                      className="h-20 w-20 text-yellow-400 transition-transform group-hover:scale-105"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3V18a3 3 0 0 0 3 3h15ZM1.5 10.146V6a3 3 0 0 1 3-3h5.379a2.25 2.25 0 0 1 1.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 0 1 3 3v1.146A4.483 4.483 0 0 0 19.5 12h-15a4.483 4.483 0 0 0-3 1.146Z" />
                    </svg>
                    <span className="absolute bottom-2 right-2 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 shadow-sm">
                      {col._count.pages} str.
                    </span>
                  </div>
                  <div className="px-1 pb-2 pt-1.5">
                    <p className="truncate text-xs font-medium text-slate-700">{col.name}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pages grid */}
      {pages.length > 0 && (
        <div className="filegrid-bg">
          {showCollections && collections.length > 0 && (
            <h3 className="filegrid-bg mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Stranky
            </h3>
          )}
          <div
            ref={pagesGridRef}
            className="filegrid-bg grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
          >
            {pages.map((page) => {
              const isSelected = selected.has(page.id);
              const isFocused = focusedItemId === page.id;
              const effectiveStatus = processingPageIds.has(page.id) ? 'processing' : page.status;

              const handleDragStart = (e: React.DragEvent<HTMLDivElement>): void => {
                // Drag from unselected item: select only that item first
                if (!isSelected) {
                  onSetSelected(new Set([page.id]));
                }
                // If this page is selected, drag all selected; otherwise drag just this one
                const ids = isSelected ? Array.from(selected) : [page.id];
                e.dataTransfer.setData('application/x-page-ids', JSON.stringify(ids));
                e.dataTransfer.effectAllowed = 'move';
                // Show count badge if multiple
                if (ids.length > 1) {
                  const ghost = document.createElement('div');
                  ghost.textContent = `${ids.length.toString()} stranek`;
                  ghost.style.cssText =
                    'position:fixed;top:-9999px;background:#3b82f6;color:white;padding:4px 10px;border-radius:8px;font-size:13px;font-weight:600;';
                  document.body.appendChild(ghost);
                  e.dataTransfer.setDragImage(ghost, 0, 0);
                  setTimeout(() => document.body.removeChild(ghost), 0);
                }
              };

              return (
                <div
                  key={page.id}
                  ref={(el) => registerItemRef(page.id, el)}
                  draggable
                  onDragStart={handleDragStart}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (selectionModeTouch) {
                      // In touch selection mode, taps toggle selection
                      onItemClick(page.id, { ...e, metaKey: true } as React.MouseEvent);
                    } else {
                      onItemClick(page.id, e);
                    }
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onPageDoubleClick(page);
                  }}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                    handleContextMenu(e, 'page', page);
                  }}
                  onTouchStart={() => handleTouchStart(page.id)}
                  onTouchEnd={handleTouchEnd}
                  onTouchMove={handleTouchMove}
                  className={[
                    'group relative cursor-pointer rounded-lg border-2 transition-all',
                    isSelected
                      ? 'border-blue-500 bg-blue-50/60 shadow-md shadow-blue-100'
                      : 'border-transparent hover:border-slate-300 hover:shadow-sm',
                    'dragging:opacity-50',
                    isFocused ? 'outline outline-2 outline-offset-2 outline-blue-400' : '',
                  ].join(' ')}
                  style={{ WebkitUserDrag: 'element' } as React.CSSProperties}
                >
                  {/* Thumbnail */}
                  <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-slate-100">
                    <img
                      src={page.imageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      draggable={false}
                    />

                    {/* Processing overlay */}
                    {effectiveStatus === 'processing' && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <svg
                          className="h-8 w-8 animate-spin text-white"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                      </div>
                    )}

                    {/* Selection indicator (blue check icon, top-left, no checkbox) */}
                    {isSelected && (
                      <div className="absolute left-1.5 top-1.5">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 shadow">
                          <svg
                            className="h-3 w-3 text-white"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={3}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m4.5 12.75 6 6 9-13.5"
                            />
                          </svg>
                        </div>
                      </div>
                    )}

                    {/* Status badge (bottom-right) */}
                    <div className="absolute bottom-1.5 right-1.5">
                      <StatusBadge status={effectiveStatus} />
                    </div>
                  </div>

                  {/* Filename */}
                  <div className="px-1 pb-2 pt-1.5">
                    <p
                      className="truncate text-xs text-slate-700"
                      title={cleanFilename(page.filename)}
                    >
                      {cleanFilename(page.filename)}
                    </p>
                    {page.document && (
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        {page.document.detectedLanguage}
                        {page.document.translations.length > 0 &&
                          ` \u2192 ${page.document.translations[0]?.language ?? ''}`}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Rubber band rectangle overlay */}
      {rubberBand &&
        (() => {
          const rect = getRectFromBand(rubberBand);
          return rect.width > 5 || rect.height > 5 ? (
            <div
              className="pointer-events-none fixed z-40 border border-blue-500 bg-blue-500/10"
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              }}
            />
          ) : null;
        })()}

      {/* Touch selection mode indicator */}
      {selectionModeTouch && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">
          Rezhim vyberu
          <button
            className="ml-3 text-blue-300 hover:text-blue-100"
            onClick={() => {
              setSelectionModeTouch(false);
              onDeselectAll();
            }}
          >
            Zrusit
          </button>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
