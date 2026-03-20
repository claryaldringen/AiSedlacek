'use client';

import { useState, useEffect, useRef } from 'react';
import type { PageItem } from '@/components/FileGrid';
import type { Collection } from '@/components/Sidebar';

interface UseWorkspaceKeyboardOptions {
  allItemIds: string[];
  collections: Collection[];
  pages: PageItem[];
  selected: Set<string>;
  handleSelectAll: () => void;
  handleDeselectAll: () => void;
  selectRange: (anchorId: string, targetId: string) => void;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  setAnchor: (id: string) => void;
  lastClickedId: string | null;
  onCollectionSelect: (id: string) => void;
  onPageOpen: (page: PageItem) => void;
  onDeleteSelected: () => void;
}

interface UseWorkspaceKeyboardReturn {
  focusedItemId: string | null;
  setFocusedItemId: React.Dispatch<React.SetStateAction<string | null>>;
  setColumnsCount: React.Dispatch<React.SetStateAction<number>>;
}

export function useWorkspaceKeyboard({
  allItemIds,
  collections,
  pages,
  selected,
  handleSelectAll,
  handleDeselectAll,
  selectRange,
  setSelected,
  setAnchor,
  lastClickedId,
  onCollectionSelect,
  onPageOpen,
  onDeleteSelected,
}: UseWorkspaceKeyboardOptions): UseWorkspaceKeyboardReturn {
  // Keyboard focus cursor (independent from selection anchor)
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  // Actual columns count reported by FileGrid via ResizeObserver
  const [columnsCount, setColumnsCount] = useState(4);

  const columnsCountRef = useRef(columnsCount);
  columnsCountRef.current = columnsCount;

  const allItemIdsRef = useRef(allItemIds);
  allItemIdsRef.current = allItemIds;

  // Stable refs for callbacks so the keyboard useEffect can read the latest
  // version without re-registering the listener on every change.
  const onCollectionSelectRef = useRef(onCollectionSelect);
  onCollectionSelectRef.current = onCollectionSelect;
  const onPageOpenRef = useRef(onPageOpen);
  onPageOpenRef.current = onPageOpen;
  const onDeleteSelectedRef = useRef(onDeleteSelected);
  onDeleteSelectedRef.current = onDeleteSelected;

  // Mutable state refs so the keyboard handler always sees current values
  const focusedItemIdRef = useRef(focusedItemId);
  focusedItemIdRef.current = focusedItemId;
  const lastClickedIdRef = useRef(lastClickedId);
  lastClickedIdRef.current = lastClickedId;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const collectionsRef = useRef(collections);
  collectionsRef.current = collections;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // ---- Keyboard shortcuts (Ctrl+A, Escape, Arrow keys, Home/End, Enter, Delete) ----
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Don't capture when typing in input fields
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement).isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        handleSelectAll();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        handleDeselectAll();
        setFocusedItemId(null);
        return;
      }

      // Arrow / Home / End navigation
      const isArrow =
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown';

      if (isArrow || e.key === 'Home' || e.key === 'End') {
        const ids = allItemIdsRef.current;
        if (ids.length === 0) return;
        e.preventDefault();

        const currentFocused = focusedItemIdRef.current;
        const currentIndex = currentFocused !== null ? ids.indexOf(currentFocused) : -1;
        const cols = columnsCountRef.current;

        let nextIndex: number;
        if (e.key === 'Home') {
          nextIndex = 0;
        } else if (e.key === 'End') {
          nextIndex = ids.length - 1;
        } else if (e.key === 'ArrowLeft') {
          nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
        } else if (e.key === 'ArrowRight') {
          nextIndex =
            currentIndex === -1
              ? 0
              : currentIndex >= ids.length - 1
                ? ids.length - 1
                : currentIndex + 1;
        } else if (e.key === 'ArrowUp') {
          nextIndex =
            currentIndex === -1 ? 0 : currentIndex - cols < 0 ? currentIndex : currentIndex - cols;
        } else {
          // ArrowDown
          nextIndex =
            currentIndex === -1
              ? 0
              : currentIndex + cols >= ids.length
                ? currentIndex
                : currentIndex + cols;
        }

        const nextId = ids[nextIndex];
        if (nextId == null) return;

        setFocusedItemId(nextId);

        if (e.shiftKey) {
          // Extend selection from anchor to new focused item
          const anchorId = lastClickedIdRef.current ?? ids[0] ?? nextId;
          selectRange(anchorId, nextId);
        } else {
          // Move focus + select only the focused item (Finder behaviour)
          setSelected(new Set([nextId]));
          setAnchor(nextId);
        }
        return;
      }

      // Enter = open focused item
      if (e.key === 'Enter') {
        const focused = focusedItemIdRef.current;
        if (focused == null) return;
        e.preventDefault();
        // Check if it's a collection
        const col = collectionsRef.current.find((c) => c.id === focused);
        if (col) {
          onCollectionSelectRef.current(col.id);
          return;
        }
        // Otherwise it's a page
        const page = pagesRef.current.find((p) => p.id === focused);
        if (page?.status === 'done') {
          onPageOpenRef.current(page);
        }
        return;
      }

      // Delete / Backspace = delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedRef.current.size === 0) return;
        e.preventDefault();
        onDeleteSelectedRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSelectAll, handleDeselectAll, selectRange, setSelected, setAnchor]);

  return {
    focusedItemId,
    setFocusedItemId,
    setColumnsCount,
  };
}
