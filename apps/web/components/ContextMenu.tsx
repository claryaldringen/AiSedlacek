'use client';

import { useEffect, useRef, useCallback } from 'react';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
}

export interface ContextMenuDivider {
  type: 'divider';
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuDivider;

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

function isDivider(entry: ContextMenuEntry): entry is ContextMenuDivider {
  return 'type' in entry && entry.type === 'divider';
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);

  // Adjust position to keep menu in viewport
  const getAdjustedPosition = useCallback((): { left: number; top: number } => {
    const menuWidth = 200;
    const menuHeight = items.length * 36;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x;
    let top = y;

    if (x + menuWidth > vw) left = x - menuWidth;
    if (y + menuHeight > vh) top = Math.max(4, y - menuHeight);
    if (left < 4) left = 4;
    if (top < 4) top = 4;

    return { left, top };
  }, [x, y, items.length]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleScroll = (): void => {
      onClose();
    };

    // Delay attaching so the triggering right-click doesn't immediately close
    requestAnimationFrame(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
      window.addEventListener('scroll', handleScroll, true);
    });

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  const pos = getAdjustedPosition();

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((entry, i) => {
        if (isDivider(entry)) {
          return <div key={`div-${String(i)}`} className="my-1 border-t border-slate-100" />;
        }

        const item = entry;
        return (
          <button
            key={`${item.label}-${String(i)}`}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            disabled={item.disabled}
            className={[
              'flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors',
              item.disabled
                ? 'cursor-not-allowed text-slate-300'
                : item.variant === 'danger'
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-slate-700 hover:bg-slate-100',
            ].join(' ')}
          >
            {item.icon && (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">{item.icon}</span>
            )}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
