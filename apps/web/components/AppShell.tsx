'use client';

import { Sidebar, type Collection } from './Sidebar';
import { Breadcrumbs } from './Breadcrumbs';
import { UserMenu } from './UserMenu';

interface AppShellProps {
  children: React.ReactNode;
  selectedCollectionId: string | null;
  selectedCollection: Collection | null;
  collections: Collection[];
  loadingCollections: boolean;
  onCollectionSelect: (id: string | null) => void;
  onMovePages?: (pageIds: string[], targetCollectionId: string | null) => void;
}

export function AppShell({
  children,
  selectedCollectionId,
  selectedCollection,
  collections,
  loadingCollections,
  onCollectionSelect,
  onMovePages,
}: AppShellProps): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-4 bg-slate-800 px-4">
        {/* Logo */}
        <span className="select-none text-base font-bold tracking-tight text-white">
          A<span className="text-slate-400">i</span>Sedlacek
        </span>

        {/* Divider */}
        <div className="h-4 w-px bg-slate-600" />

        {/* Breadcrumbs */}
        <Breadcrumbs
          selectedCollection={selectedCollection}
          onNavigateRoot={() => onCollectionSelect(null)}
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* User menu */}
        <UserMenu />
      </header>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          selectedCollectionId={selectedCollectionId}
          onCollectionSelect={onCollectionSelect}
          collections={collections}
          loadingCollections={loadingCollections}
          onMovePages={onMovePages}
        />

        {/* Main content area */}
        <main className="flex flex-1 flex-col overflow-hidden bg-slate-50">{children}</main>
      </div>
    </div>
  );
}
