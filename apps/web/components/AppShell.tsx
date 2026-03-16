'use client';

import { Sidebar, type Collection } from './Sidebar';
import { Breadcrumbs } from './Breadcrumbs';

interface AppShellProps {
  children: React.ReactNode;
  selectedCollectionId: string | null;
  selectedCollection: Collection | null;
  collections: Collection[];
  loadingCollections: boolean;
  onCollectionSelect: (id: string | null) => void;
  onCollectionCreated?: (collection: Collection) => void;
  onRefreshCollections: () => void;
}

export function AppShell({
  children,
  selectedCollectionId,
  selectedCollection,
  collections,
  loadingCollections,
  onCollectionSelect,
  onCollectionCreated,
  onRefreshCollections,
}: AppShellProps): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-4 bg-slate-800 px-4">
        {/* Logo / App name */}
        <div className="flex items-center gap-2 text-white">
          <svg
            className="h-5 w-5 text-blue-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
            />
          </svg>
          <span className="text-sm font-semibold tracking-tight">Čtečka starých textů</span>
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-slate-600" />

        {/* Breadcrumbs */}
        <Breadcrumbs
          selectedCollection={selectedCollection}
          onNavigateRoot={() => onCollectionSelect(null)}
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Version/info badge */}
        <span className="text-xs text-slate-500">OCR + AI překlad</span>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          selectedCollectionId={selectedCollectionId}
          onCollectionSelect={onCollectionSelect}
          onCollectionCreated={onCollectionCreated}
          collections={collections}
          loadingCollections={loadingCollections}
          onRefresh={onRefreshCollections}
        />

        {/* Main content area */}
        <main className="flex flex-1 flex-col overflow-hidden bg-slate-50">{children}</main>
      </div>
    </div>
  );
}
