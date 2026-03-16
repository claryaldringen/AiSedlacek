'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Toolbar } from '@/components/Toolbar';
import { FileGrid, type PageItem } from '@/components/FileGrid';
import { FileList } from '@/components/FileList';
import { FileUploadZone, type UploadedPage } from '@/components/FileUploadZone';
import { DocumentPanel } from '@/components/DocumentPanel';
import type { Collection } from '@/components/Sidebar';
import type { DocumentResult } from '@/components/ResultViewer';

export default function HomePage(): React.JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Navigation state – synced with URL ?collection=ID
  const selectedCollectionId = searchParams.get('collection');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(true);

  // Pages
  const [pages, setPages] = useState<PageItem[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // View mode
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Upload modal
  const [uploadOpen, setUploadOpen] = useState(false);

  // Processing
  const [processingPageIds, setProcessingPageIds] = useState<Set<string>>(new Set());
  const [processingStep, setProcessingStep] = useState<string | undefined>(undefined);
  const [processingProgress, setProcessingProgress] = useState<number | undefined>(undefined);

  // Document panel
  const [panelResult, setPanelResult] = useState<DocumentResult | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);

  // Error
  const [error, setError] = useState<string | null>(null);

  // Drag-over for whole content area
  const [contentDragOver, setContentDragOver] = useState(false);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  // ---- Load collections ----
  const loadCollections = useCallback(async (): Promise<void> => {
    setLoadingCollections(true);
    try {
      const res = await fetch('/api/collections');
      if (!res.ok) return;
      const data = (await res.json()) as Collection[];
      setCollections(data);
    } catch {
      // ignore
    } finally {
      setLoadingCollections(false);
    }
  }, []);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  // ---- Load pages ----
  const loadPages = useCallback(async (collectionId: string | null): Promise<void> => {
    setLoadingPages(true);
    setSelected(new Set());
    try {
      const url = collectionId !== null ? `/api/collections/${collectionId}` : '/api/pages';
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as
        | PageItem[]
        | { pages: PageItem[] }
        | { id: string; pages: PageItem[] };

      if (Array.isArray(data)) {
        setPages(data);
      } else if ('pages' in data) {
        setPages((data as { pages: PageItem[] }).pages);
      }
    } catch {
      // ignore
    } finally {
      setLoadingPages(false);
    }
  }, []);

  useEffect(() => {
    void loadPages(selectedCollectionId);
  }, [loadPages, selectedCollectionId]);

  // ---- Collection navigation (URL-based for browser back/forward) ----
  const handleCollectionSelect = useCallback(
    (id: string | null): void => {
      if (id === null) {
        router.push('/');
      } else {
        router.push(`/?collection=${id}`);
      }
      setPanelResult(null);
    },
    [router],
  );

  const selectedCollection =
    selectedCollectionId !== null
      ? (collections.find((c) => c.id === selectedCollectionId) ?? null)
      : null;

  // ---- Upload ----
  const handleFilesUploaded = useCallback(
    (uploadedPages: UploadedPage[]): void => {
      const newPageItems: PageItem[] = uploadedPages.map((p) => ({
        id: p.id,
        filename: p.filename,
        imageUrl: p.imageUrl,
        status: p.status,
        order: p.order,
        collectionId: p.collectionId,
        createdAt: p.createdAt,
        document: null,
      }));
      setPages((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const trulyNew = newPageItems.filter((p) => !existingIds.has(p.id));
        return [...trulyNew, ...prev];
      });
      // Refresh collections count
      void loadCollections();
    },
    [loadCollections],
  );

  // ---- Selection ----
  const handleToggleSelect = useCallback((id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback((): void => {
    setSelected(new Set(pages.map((p) => p.id)));
  }, [pages]);

  const handleDeselectAll = useCallback((): void => {
    setSelected(new Set());
  }, []);

  // ---- Processing ----
  const handleProcessSelected = useCallback(async (): Promise<void> => {
    const pageIds = Array.from(selected).filter((id) => {
      const p = pages.find((pg) => pg.id === id);
      return p && (p.status === 'pending' || p.status === 'error');
    });
    if (pageIds.length === 0) return;

    setProcessingPageIds(new Set(pageIds));
    setProcessingStep('Spouštím zpracování…');
    setProcessingProgress(0);
    setError(null);

    setPages((prev) =>
      prev.map((p) => (pageIds.includes(p.id) ? { ...p, status: 'processing' } : p)),
    );

    try {
      const response = await fetch('/api/pages/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds, language: 'cs' }),
      });

      if (!response.ok || !response.body) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const eventStr of events) {
          const match = eventStr.match(/^event: (\w+)\ndata: (.+)$/s);
          if (!match) continue;
          const eventType = match[1];
          const dataStr = match[2];
          if (!eventType || !dataStr) continue;

          if (eventType === 'page_progress') {
            const data = JSON.parse(dataStr) as {
              pageId: string;
              message: string;
              progress: number;
            };
            setProcessingStep(data.message);
            setProcessingProgress(data.progress);
          } else if (eventType === 'page_done') {
            const data = JSON.parse(dataStr) as {
              pageId: string;
              documentId: string;
              cached: boolean;
              progress: number;
            };
            setProcessingProgress(data.progress);
            setProcessingPageIds((prev) => {
              const next = new Set(prev);
              next.delete(data.pageId);
              return next;
            });
            setPages((prev) =>
              prev.map((p) => (p.id === data.pageId ? { ...p, status: 'done' } : p)),
            );
            void (async () => {
              try {
                const res = await fetch(`/api/pages/${data.pageId}`);
                if (res.ok) {
                  const updated = (await res.json()) as PageItem;
                  setPages((prev) => prev.map((p) => (p.id === data.pageId ? updated : p)));
                }
              } catch {
                // ignore
              }
            })();
          } else if (eventType === 'page_skipped') {
            const data = JSON.parse(dataStr) as { pageId: string; progress: number };
            setProcessingProgress(data.progress);
            setProcessingPageIds((prev) => {
              const next = new Set(prev);
              next.delete(data.pageId);
              return next;
            });
          } else if (eventType === 'page_error') {
            const data = JSON.parse(dataStr) as {
              pageId: string;
              error: string;
              progress: number;
            };
            setProcessingPageIds((prev) => {
              const next = new Set(prev);
              next.delete(data.pageId);
              return next;
            });
            setPages((prev) =>
              prev.map((p) => (p.id === data.pageId ? { ...p, status: 'error' } : p)),
            );
          } else if (eventType === 'done') {
            setProcessingStep('Hotovo');
            setProcessingProgress(100);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba');
      setPages((prev) =>
        prev.map((p) => (processingPageIds.has(p.id) ? { ...p, status: 'error' } : p)),
      );
    } finally {
      setProcessingPageIds(new Set());
      setTimeout(() => {
        setProcessingStep(undefined);
        setProcessingProgress(undefined);
      }, 2000);
    }
  }, [selected, pages, processingPageIds]);

  // ---- Move pages (drag & drop) ----
  const handleMovePages = useCallback(
    async (pageIds: string[], targetCollectionId: string | null): Promise<void> => {
      // Optimistically remove moved pages from current view
      setPages((prev) => prev.filter((p) => !pageIds.includes(p.id)));

      // Fire API calls
      await Promise.all(
        pageIds.map((id) =>
          fetch(`/api/pages/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collectionId: targetCollectionId }),
          }).catch(() => {
            // On error, reload pages to restore correct state
            void loadPages(selectedCollectionId);
          }),
        ),
      );

      // Refresh collection counts
      void loadCollections();
    },
    [selectedCollectionId, loadCollections, loadPages],
  );

  // ---- Delete ----
  const handleDeletePage = useCallback(
    async (pageId: string): Promise<void> => {
      const page = pages.find((p) => p.id === pageId);
      if (!page) return;

      if (page.status === 'done' || page.document) {
        try {
          await fetch(`/api/pages/${pageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'archived' }),
          });
          setPages((prev) => prev.filter((p) => p.id !== pageId));
        } catch {
          // ignore
        }
      } else {
        try {
          await fetch(`/api/pages/${pageId}`, { method: 'DELETE' });
          setPages((prev) => prev.filter((p) => p.id !== pageId));
        } catch {
          // ignore
        }
      }
      if (panelResult?.id === page.document?.id) setPanelResult(null);
    },
    [pages, panelResult],
  );

  const handleDeleteSelected = useCallback(async (): Promise<void> => {
    for (const id of Array.from(selected)) {
      await handleDeletePage(id);
    }
    setSelected(new Set());
  }, [selected, handleDeletePage]);

  // ---- Page click (open panel) ----
  const handlePageClick = useCallback(async (page: PageItem): Promise<void> => {
    if (!page.document) return;
    setPanelResult(null);
    setPanelLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${page.document.id}`);
      if (!res.ok) throw new Error('Nepodařilo se načíst dokument');
      const doc = (await res.json()) as {
        id: string;
        transcription: string;
        detectedLanguage: string;
        context: string;
        translations: { language: string; text: string }[];
        glossary: { term: string; definition: string }[];
      };

      const translation = doc.translations[0];
      setPanelResult({
        id: doc.id,
        transcription: doc.transcription,
        detectedLanguage: doc.detectedLanguage,
        translation: translation?.text ?? '',
        translationLanguage: translation?.language ?? '',
        context: doc.context,
        glossary: doc.glossary,
        cached: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba');
    } finally {
      setPanelLoading(false);
    }
  }, []);

  // ---- Derived values ----
  const isProcessing = processingPageIds.size > 0;
  const pendingSelectedCount = Array.from(selected).filter((id) => {
    const p = pages.find((pg) => pg.id === id);
    return p && (p.status === 'pending' || p.status === 'error');
  }).length;
  const doneCount = pages.filter((p) => p.status === 'done').length;

  // Collections visible only in "all" view (no specific collection selected)
  const visibleCollections = selectedCollectionId === null ? collections : [];

  // Drag-and-drop on content area to open upload
  const handleContentDrop = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setContentDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      setUploadOpen(true);
    }
  }, []);

  return (
    <AppShell
      selectedCollectionId={selectedCollectionId}
      selectedCollection={selectedCollection}
      collections={collections}
      loadingCollections={loadingCollections}
      onCollectionSelect={handleCollectionSelect}
      onCollectionCreated={(col) => {
        setCollections((prev) => [col, ...prev]);
      }}
      onRefreshCollections={loadCollections}
      onMovePages={(ids, targetId) => void handleMovePages(ids, targetId)}
    >
      {/* Toolbar */}
      <Toolbar
        totalCount={pages.length}
        doneCount={doneCount}
        selectedCount={selected.size}
        pendingSelectedCount={pendingSelectedCount}
        isProcessing={isProcessing}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onUploadClick={() => setUploadOpen(true)}
        onProcessSelected={() => void handleProcessSelected()}
        onDeleteSelected={() => void handleDeleteSelected()}
        processingStep={processingStep}
        processingProgress={processingProgress}
      />

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700"
        >
          <strong className="font-semibold">Chyba: </strong>
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-red-600">
            ×
          </button>
        </div>
      )}

      {/* Content area */}
      <div
        ref={contentAreaRef}
        className={[
          'relative flex-1 overflow-y-auto transition-colors',
          contentDragOver ? 'bg-blue-50 ring-2 ring-inset ring-blue-400' : '',
        ].join(' ')}
        onDragOver={(e) => {
          e.preventDefault();
          // Only show upload overlay for OS file drags, not internal page-card drags
          const isPageDrag = e.dataTransfer.types.includes('application/x-page-ids');
          if (!isPageDrag) setContentDragOver(true);
        }}
        onDragLeave={() => setContentDragOver(false)}
        onDrop={handleContentDrop}
      >
        {loadingPages ? (
          <div className="flex items-center justify-center py-20">
            <svg className="h-6 w-6 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
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
        ) : viewMode === 'grid' ? (
          <FileGrid
            pages={pages}
            collections={visibleCollections}
            selected={selected}
            onToggleSelect={handleToggleSelect}
            onPageClick={(page) => void handlePageClick(page)}
            onCollectionClick={handleCollectionSelect}
            processingPageIds={processingPageIds}
            showCollections={selectedCollectionId === null}
            onMovePages={(ids, targetId) => void handleMovePages(ids, targetId)}
          />
        ) : (
          <FileList
            pages={pages}
            collections={visibleCollections}
            selected={selected}
            onToggleSelect={handleToggleSelect}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            onPageClick={(page) => void handlePageClick(page)}
            onCollectionClick={handleCollectionSelect}
            onDelete={(id) => void handleDeletePage(id)}
            processingPageIds={processingPageIds}
            showCollections={selectedCollectionId === null}
          />
        )}

        {/* Drag overlay hint */}
        {contentDragOver && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-xl bg-blue-600/90 px-8 py-4 text-white shadow-xl">
              <p className="text-lg font-semibold">Pusťte soubory pro nahrání</p>
            </div>
          </div>
        )}
      </div>

      {/* Upload modal */}
      <FileUploadZone
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onFilesUploaded={handleFilesUploaded}
        collectionId={selectedCollectionId}
      />

      {/* Document panel */}
      <DocumentPanel
        result={panelResult}
        isLoading={panelLoading}
        onClose={() => {
          setPanelResult(null);
          setPanelLoading(false);
        }}
      />
    </AppShell>
  );
}
