'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface UseDesktopSelectionOptions {
  /** Ordered list of all selectable item IDs (visual order in grid) */
  itemIds: string[];
}

interface UseDesktopSelectionReturn {
  selected: Set<string>;
  lastClickedId: string | null;
  /** Plain click: select only this item. Ctrl/Cmd+click: toggle. Shift+click: range. */
  handleItemClick: (id: string, e: React.MouseEvent) => void;
  /** Select all items */
  selectAll: () => void;
  /** Deselect all */
  deselectAll: () => void;
  /** Replace the entire selection (used for rubber band, context menu, etc.) */
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** Whether selection mode is active (for mobile touch) */
  selectionMode: boolean;
  setSelectionMode: React.Dispatch<React.SetStateAction<boolean>>;
  /**
   * Select the range between anchorId and targetId (inclusive), replacing existing selection.
   * If extend is true, merges with current selection instead of replacing.
   */
  selectRange: (anchorId: string, targetId: string, extend?: boolean) => void;
  /** Update the anchor (lastClickedId) without changing selection */
  setAnchor: (id: string | null) => void;
}

export function useDesktopSelection({
  itemIds,
}: UseDesktopSelectionOptions): UseDesktopSelectionReturn {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const itemIdsRef = useRef(itemIds);
  itemIdsRef.current = itemIds;

  // Clear selection when item list changes significantly (e.g. navigate to different folder)
  const prevItemIdsKey = useRef<string>('');
  useEffect(() => {
    const key = itemIds.join(',');
    if (prevItemIdsKey.current !== '' && prevItemIdsKey.current !== key) {
      setSelected(new Set());
      setLastClickedId(null);
      setSelectionMode(false);
    }
    prevItemIdsKey.current = key;
  }, [itemIds]);

  const handleItemClick = useCallback(
    (id: string, e: React.MouseEvent): void => {
      const isMetaOrCtrl = e.metaKey || e.ctrlKey;
      const isShift = e.shiftKey;

      if (isShift && lastClickedId !== null) {
        // Range select
        const ids = itemIdsRef.current;
        const startIdx = ids.indexOf(lastClickedId);
        const endIdx = ids.indexOf(id);

        if (startIdx !== -1 && endIdx !== -1) {
          const from = Math.min(startIdx, endIdx);
          const to = Math.max(startIdx, endIdx);
          const rangeIds = ids.slice(from, to + 1);

          setSelected((prev) => {
            const next = isMetaOrCtrl ? new Set(prev) : new Set<string>();
            for (const rangeId of rangeIds) {
              next.add(rangeId);
            }
            return next;
          });
        }
        // Don't update lastClickedId on shift-click (preserve anchor)
      } else if (isMetaOrCtrl) {
        // Toggle
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
        setLastClickedId(id);
      } else {
        // Plain click: select only this one
        setSelected(new Set([id]));
        setLastClickedId(id);
      }
    },
    [lastClickedId],
  );

  const selectAll = useCallback((): void => {
    setSelected(new Set(itemIdsRef.current));
  }, []);

  const deselectAll = useCallback((): void => {
    setSelected(new Set());
    setSelectionMode(false);
  }, []);

  const selectRange = useCallback((anchorId: string, targetId: string, extend = false): void => {
    const ids = itemIdsRef.current;
    const startIdx = ids.indexOf(anchorId);
    const endIdx = ids.indexOf(targetId);
    if (startIdx === -1 || endIdx === -1) return;
    const from = Math.min(startIdx, endIdx);
    const to = Math.max(startIdx, endIdx);
    const rangeIds = ids.slice(from, to + 1);
    setSelected((prev) => {
      const next = extend ? new Set(prev) : new Set<string>();
      for (const rangeId of rangeIds) {
        next.add(rangeId);
      }
      return next;
    });
  }, []);

  const setAnchor = useCallback((id: string | null): void => {
    setLastClickedId(id);
  }, []);

  return {
    selected,
    lastClickedId,
    handleItemClick,
    selectAll,
    deselectAll,
    setSelected,
    selectionMode,
    setSelectionMode,
    selectRange,
    setAnchor,
  };
}
