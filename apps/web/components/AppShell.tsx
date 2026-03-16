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
  onMovePages?: (pageIds: string[], targetCollectionId: string | null) => void;
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
  onMovePages,
}: AppShellProps): React.JSX.Element {
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-4 bg-slate-800 px-4">
        {/* Logo */}
        <span className="select-none text-base font-bold tracking-tight text-white">
          A<span className="inline-flex flex-col items-center leading-none text-slate-500" style={{fontSize:'0.55em',verticalAlign:'baseline',marginBottom:'-0.1em'}}><span className="text-white" style={{fontSize:'0.7em',lineHeight:1}}>&#x2022;</span><span style={{lineHeight:1,marginTop:'-0.15em'}}>&#x0131;</span></span>Sedlacek
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
          onMovePages={onMovePages}
        />

        {/* Main content area */}
        <main className="flex flex-1 flex-col overflow-hidden bg-slate-50">{children}</main>
      </div>
    </div>
  );
}
