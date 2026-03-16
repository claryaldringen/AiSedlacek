'use client';

import type { Collection } from './Sidebar';

interface BreadcrumbsProps {
  selectedCollection: Collection | null;
  onNavigateRoot: () => void;
}

export function Breadcrumbs({
  selectedCollection,
  onNavigateRoot,
}: BreadcrumbsProps): React.JSX.Element {
  return (
    <nav className="flex items-center gap-1 text-sm text-slate-300" aria-label="Navigace">
      <button onClick={onNavigateRoot} className="transition-colors hover:text-white">
        Vše
      </button>
      {selectedCollection && (
        <>
          <svg
            className="h-3 w-3 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
          <span className="text-white">{selectedCollection.name}</span>
        </>
      )}
    </nav>
  );
}
