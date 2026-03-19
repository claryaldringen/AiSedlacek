'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { Toolbar } from '@/components/Toolbar';
import { FileGrid, type PageItem } from '@/components/FileGrid';
import { FileList } from '@/components/FileList';
import { ImportDialog, type UploadedPage } from '@/components/ImportDialog';
import { DocumentPanel } from '@/components/DocumentPanel';
import { CollectionContextDialog } from '@/components/CollectionContextDialog';
import type { Collection } from '@/components/Sidebar';
import type { DocumentResult } from '@/components/ResultViewer';
import { useDesktopSelection } from '@/hooks/useDesktopSelection';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

  // View mode
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Dialogs
  const [uploadOpen, setUploadOpen] = useState(false);
  const [contextDialogOpen, setContextDialogOpen] = useState(false);
  const [fixingContexts, setFixingContexts] = useState(false);
  const [fixingContextsProgress, setFixingContextsProgress] = useState<string | null>(null);

  // Processing
  const [processingMode, setProcessingMode] = useState<'transcribe+translate' | 'translate'>('transcribe+translate');
  const [processingPageIds, setProcessingPageIds] = useState<Set<string>>(new Set());
  const [processingStep, setProcessingStep] = useState<string | undefined>(undefined);
  const [processingProgress, setProcessingProgress] = useState<number | undefined>(undefined);
  const [batchInfo, setBatchInfo] = useState<{
    batchNumber: number;
    totalBatches: number;
    pageCount: number;
  } | null>(null);
  const batchInfoRef = useRef(batchInfo);
  batchInfoRef.current = batchInfo;

  // Document panel
  const [panelPage, setPanelPage] = useState<PageItem | null>(null);
  const [panelResult, setPanelResult] = useState<DocumentResult | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateStep, setRegenerateStep] = useState<string | undefined>(undefined);
  const [regenerateProgress, setRegenerateProgress] = useState<number | undefined>(undefined);

  // Error
  const [error, setError] = useState<string | null>(null);

  // Drag-over for whole content area
  const [contentDragOver, setContentDragOver] = useState(false);
  const contentAreaRef = useRef<HTMLDivElement>(null);

  // Collections visible only in "all" view (no specific collection selected)
  const visibleCollections = selectedCollectionId === null ? collections : [];

  // All selectable item IDs in visual order (collections first, then pages)
  const allItemIds = useMemo(() => {
    const ids: string[] = [];
    if (selectedCollectionId === null) {
      for (const col of collections) {
        ids.push(col.id);
      }
    }
    for (const page of pages) {
      ids.push(page.id);
    }
    return ids;
  }, [collections, pages, selectedCollectionId]);

  // Desktop selection hook
  const {
    selected,
    lastClickedId,
    handleItemClick,
    selectAll: handleSelectAll,
    deselectAll: handleDeselectAll,
    setSelected,
    selectRange,
    setAnchor,
  } = useDesktopSelection({ itemIds: allItemIds });

  // Keyboard focus cursor (independent from selection anchor)
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  // Actual columns count reported by FileGrid via ResizeObserver
  const [columnsCount, setColumnsCount] = useState(4);

  const columnsCountRef = useRef(columnsCount);
  columnsCountRef.current = columnsCount;

  const allItemIdsRef = useRef(allItemIds);
  allItemIdsRef.current = allItemIds;

  // Stable refs for callbacks defined later in the file, so the keyboard
  // useEffect can read the latest version without a forward-reference dep.
  const handleCollectionSelectRef = useRef<((id: string) => void) | null>(null);
  const handlePageDoubleClickRef = useRef<((page: PageItem) => Promise<void>) | null>(null);
  const handleDeleteSelectedRef = useRef<(() => Promise<void>) | null>(null);

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
          handleCollectionSelectRef.current?.(col.id);
          return;
        }
        // Otherwise it's a page
        const page = pagesRef.current.find((p) => p.id === focused);
        if (page?.status === 'done') {
          void handlePageDoubleClickRef.current?.(page);
        }
        return;
      }

      // Delete / Backspace = delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedRef.current.size === 0) return;
        e.preventDefault();
        void handleDeleteSelectedRef.current?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleSelectAll, handleDeselectAll, selectRange, setSelected, setAnchor]);

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
  const fixDocumentContexts = useCallback(async (collectionId: string): Promise<void> => {
    setFixingContexts(true);
    setFixingContextsProgress(null);
    try {
      const res = await fetch(`/api/collections/${collectionId}/fix-document-contexts`, {
        method: 'POST',
      });
      if (!res.ok || !res.body) {
        setError('Oprava kontextů selhala');
        return;
      }
      const reader = res.body.getReader();
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
          const data = JSON.parse(match[2]!) as { message?: string; progress?: number };
          if (data.message) setFixingContextsProgress(data.message);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba');
    } finally {
      setFixingContexts(false);
      setFixingContextsProgress(null);
    }
  }, []);

  const handleCollectionSelect = useCallback(
    (id: string | null): void => {
      if (id === null) {
        router.push('/workspace');
      } else {
        router.push(`/workspace?collection=${id}`);
      }
      setPanelResult(null);
    },
    [router],
  );
  // Keep ref in sync (used by keyboard handler to avoid forward-reference dep)
  handleCollectionSelectRef.current = (id: string) => handleCollectionSelect(id);

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

  // ---- Processing ----
  const handleProcessSelected = useCallback(async (): Promise<void> => {
    const pageIds = Array.from(selected).filter((id) => {
      const p = pages.find((pg) => pg.id === id);
      return p && (p.status === 'pending' || p.status === 'error');
    });
    if (pageIds.length === 0) return;

    setProcessingPageIds(new Set(pageIds));
    setProcessingStep('Spoustim zpracovani...');
    setProcessingProgress(0);
    setError(null);

    setPages((prev) =>
      prev.map((p) => (pageIds.includes(p.id) ? { ...p, status: 'processing' } : p)),
    );

    try {
      const response = await fetch('/api/pages/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds, language: 'cs', mode: processingMode }),
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
            const bi = batchInfoRef.current;
            const batchPrefix =
              bi && bi.totalBatches > 1 ? `Dávka ${bi.batchNumber}/${bi.totalBatches} — ` : '';
            setProcessingStep(batchPrefix + data.message);
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
          } else if (eventType === 'batch_info') {
            const data = JSON.parse(dataStr) as {
              batchNumber: number;
              totalBatches: number;
              pageCount: number;
            };
            setBatchInfo(data);
            batchInfoRef.current = data;
          } else if (eventType === 'batch_progress') {
            const data = JSON.parse(dataStr) as {
              batchNumber: number;
              outputTokens: number;
              estimatedTotal: number;
            };
            const bi = batchInfoRef.current;
            const totalBatches = bi?.totalBatches ?? '?';
            setProcessingStep(`Dávka ${data.batchNumber}/${totalBatches}`);
            setProcessingProgress(Math.round((data.outputTokens / data.estimatedTotal) * 100));
          } else if (eventType === 'done') {
            setBatchInfo(null);
            batchInfoRef.current = null;
            setProcessingStep('Hotovo');
            setProcessingProgress(100);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznama chyba');
      setPages((prev) =>
        prev.map((p) => (processingPageIds.has(p.id) ? { ...p, status: 'error' } : p)),
      );
    } finally {
      setProcessingPageIds(new Set());
      setBatchInfo(null);
      batchInfoRef.current = null;
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
      if (panelPage?.id === pageId) {
        setPanelPage(null);
        setPanelResult(null);
      }
    },
    [pages, panelPage],
  );

  const handleDeleteSelected = useCallback(async (): Promise<void> => {
    for (const id of Array.from(selected)) {
      await handleDeletePage(id);
    }
    setSelected(new Set());
  }, [selected, handleDeletePage, setSelected]);
  // Keep ref in sync
  handleDeleteSelectedRef.current = handleDeleteSelected;

  // ---- Page double-click (open panel for any status) ----
  const handlePageDoubleClick = useCallback(async (page: PageItem): Promise<void> => {
    setPanelPage(page);
    setPanelResult(null);
    setError(null);

    if (page.document) {
      setPanelLoading(true);
      try {
        const res = await fetch(`/api/documents/${page.document.id}`);
        if (!res.ok) throw new Error('Nepodarilo se nacist dokument');
        const doc = (await res.json()) as {
          id: string;
          transcription: string;
          detectedLanguage: string;
          context: string;
          hash: string;
          translations: {
            language: string;
            text: string;
            model?: string;
            inputTokens?: number;
            outputTokens?: number;
          }[];
          glossary: { term: string; definition: string }[];
          model?: string;
          inputTokens?: number;
          outputTokens?: number;
          processingTimeMs?: number;
          createdAt?: string;
          updatedAt?: string;
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
          // Processing metadata
          model: doc.model,
          inputTokens: doc.inputTokens,
          outputTokens: doc.outputTokens,
          processingTimeMs: doc.processingTimeMs,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          hash: doc.hash,
          // Page metadata
          mimeType: page.mimeType,
          fileSize: page.fileSize,
          width: page.width,
          height: page.height,
          pageCreatedAt: page.createdAt,
          // Translation metadata
          translationModel: translation?.model,
          translationInputTokens: translation?.inputTokens,
          translationOutputTokens: translation?.outputTokens,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Neznama chyba');
      } finally {
        setPanelLoading(false);
      }
    } else {
      // Fetch full page data for metadata (width, height, etc.)
      try {
        const res = await fetch(`/api/pages/${page.id}`);
        if (res.ok) {
          const fullPage = (await res.json()) as PageItem & {
            width?: number;
            height?: number;
            fileSize?: number;
            errorMessage?: string;
          };
          setPanelPage(fullPage);
        }
      } catch {
        // use what we have
      }
    }
  }, []);
  // Keep ref in sync
  handlePageDoubleClickRef.current = handlePageDoubleClick;

  // ---- Regenerate document ----
  const handleRegenerate = useCallback(
    async (pageId: string): Promise<void> => {
      setRegenerating(true);
      setRegenerateStep('Připravuji…');
      setRegenerateProgress(0);
      setPanelResult(null);
      try {
        // Try re-parsing from stored rawResponse first (free, no API call)
        const page = pages.find((p) => p.id === pageId);
        if (page?.document) {
          setRegenerateStep('Zkouším opravit parsování…');
          const reparseRes = await fetch(`/api/documents/${page.document.id}/reparse`, {
            method: 'POST',
          });
          if (reparseRes.ok) {
            // Re-parse succeeded — reload document
            const pageRes = await fetch(`/api/pages/${pageId}`);
            if (pageRes.ok) {
              const updatedPage = (await pageRes.json()) as PageItem;
              setPanelPage(updatedPage);
              setPages((prev) => prev.map((p) => (p.id === pageId ? updatedPage : p)));
              if (updatedPage.document) {
                const docRes = await fetch(`/api/documents/${updatedPage.document.id}`);
                if (docRes.ok) {
                  const doc = (await docRes.json()) as {
                    id: string;
                    transcription: string;
                    detectedLanguage: string;
                    context: string;
                    hash: string;
                    translations: {
                      language: string;
                      text: string;
                      model?: string;
                      inputTokens?: number;
                      outputTokens?: number;
                    }[];
                    glossary: { term: string; definition: string }[];
                    model?: string;
                    inputTokens?: number;
                    outputTokens?: number;
                    processingTimeMs?: number;
                    createdAt?: string;
                    updatedAt?: string;
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
                    cached: false,
                    model: doc.model,
                    inputTokens: doc.inputTokens,
                    outputTokens: doc.outputTokens,
                    processingTimeMs: doc.processingTimeMs,
                    createdAt: doc.createdAt,
                    updatedAt: doc.updatedAt,
                    hash: doc.hash,
                    mimeType: page.mimeType,
                    fileSize: page.fileSize,
                    width: page.width,
                    height: page.height,
                    pageCreatedAt: page.createdAt,
                    translationModel: translation?.model,
                    translationInputTokens: translation?.inputTokens,
                    translationOutputTokens: translation?.outputTokens,
                  });
                }
              }
            }
            return; // Done — no API call needed
          }
          // Re-parse failed — fall through to full regeneration
          console.log('[Regenerate] Re-parse failed, falling back to full regeneration');
          await fetch(`/api/documents/${page.document.id}`, { method: 'DELETE' });
        }
        // Reset page status
        await fetch(`/api/pages/${pageId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'pending' }),
        });
        // Process again with full API call
        setRegenerateStep('Volám model…');
        const response = await fetch('/api/pages/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageIds: [pageId], language: 'cs' }),
        });
        if (response.body) {
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
                const data = JSON.parse(dataStr) as { message: string; progress: number };
                setRegenerateStep(data.message);
                setRegenerateProgress(data.progress);
              } else if (eventType === 'page_done') {
                // Reload the document
                const pageRes = await fetch(`/api/pages/${pageId}`);
                if (pageRes.ok) {
                  const updatedPage = (await pageRes.json()) as PageItem;
                  setPanelPage(updatedPage);
                  setPages((prev) => prev.map((p) => (p.id === pageId ? updatedPage : p)));
                  if (updatedPage.document) {
                    const docRes = await fetch(`/api/documents/${updatedPage.document.id}`);
                    if (docRes.ok) {
                      const doc = (await docRes.json()) as {
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
                        cached: false,
                      });
                    }
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Přegenerování selhalo');
      } finally {
        setRegenerating(false);
        setRegenerateStep(undefined);
        setRegenerateProgress(undefined);
      }
    },
    [pages],
  );

  // ---- Derived values ----
  const isProcessing = processingPageIds.size > 0;
  const pendingSelectedCount = Array.from(selected).filter((id) => {
    const p = pages.find((pg) => pg.id === id);
    return p && (p.status === 'pending' || p.status === 'error');
  }).length;
  const doneCount = pages.filter((p) => p.status === 'done').length;

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
        onImportClick={() => setUploadOpen(true)}
        onProcessSelected={() => void handleProcessSelected()}
        onDeleteSelected={() => void handleDeleteSelected()}
        onCreateCollection={async (name) => {
          const res = await fetch('/api/collections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
          });
          if (res.ok) {
            const data = (await res.json()) as { id: string };
            void loadCollections();
            handleCollectionSelect(data.id);
          }
        }}
        onSortByName={async () => {
          const sorted = [...pages].sort((a, b) => {
            const nameA = (a.displayName || a.filename).toLowerCase();
            const nameB = (b.displayName || b.filename).toLowerCase();
            return nameA.localeCompare(nameB, 'cs', { numeric: true });
          });
          setPages(sorted);
          // Persist new order
          await Promise.all(
            sorted.map((p, i) =>
              fetch(`/api/pages/${p.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order: i }),
              }),
            ),
          );
        }}
        onEditContext={() => setContextDialogOpen(true)}
        hasCollection={selectedCollectionId !== null}
        processingStep={processingStep}
        processingProgress={processingProgress}
        processingMode={processingMode}
        onProcessingModeChange={setProcessingMode}
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
            x
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
        {/* Collection context card */}
        {selectedCollection?.context && (
          <div className="mx-4 mt-3 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <details>
              <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                Kontext díla: {selectedCollection.name}
              </summary>
              <div className="border-t border-slate-100 px-4 py-3 prose prose-sm prose-stone max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {selectedCollection.context}
                </ReactMarkdown>
              </div>
              <div className="border-t border-slate-100 px-4 py-2.5">
                <button
                  onClick={() => void fixDocumentContexts(selectedCollection.id)}
                  disabled={fixingContexts}
                  className="flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
                >
                  {fixingContexts ? (
                    <>
                      <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
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
                      {fixingContextsProgress ?? 'Opravuji…'}
                    </>
                  ) : (
                    <>
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182"
                        />
                      </svg>
                      Opravit kontext dokumentů podle kontextu díla
                    </>
                  )}
                </button>
              </div>
            </details>
          </div>
        )}

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
            onItemClick={handleItemClick}
            onPageDoubleClick={(page) => void handlePageDoubleClick(page)}
            onCollectionDoubleClick={handleCollectionSelect}
            processingPageIds={processingPageIds}
            showCollections={selectedCollectionId === null}
            onMovePages={(ids, targetId) => void handleMovePages(ids, targetId)}
            onSetSelected={setSelected}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            onProcessSelected={() => void handleProcessSelected()}
            onDeleteSelected={() => void handleDeleteSelected()}
            onImportClick={() => setUploadOpen(true)}
            focusedItemId={focusedItemId}
            onColumnsChange={setColumnsCount}
          />
        ) : (
          <FileList
            pages={pages}
            collections={visibleCollections}
            selected={selected}
            onToggleSelect={(id) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            onPageClick={(page) => void handlePageDoubleClick(page)}
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
              <p className="text-lg font-semibold">Pustte soubory pro nahrani</p>
            </div>
          </div>
        )}
      </div>

      {/* Upload modal */}
      <ImportDialog
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onPagesImported={handleFilesUploaded}
        collectionId={selectedCollectionId}
      />

      {/* Collection context dialog */}
      {selectedCollection && (
        <CollectionContextDialog
          isOpen={contextDialogOpen}
          onClose={() => setContextDialogOpen(false)}
          collectionId={selectedCollection.id}
          collectionName={selectedCollection.name}
          initialContext={selectedCollection.context}
          initialContextUrl={selectedCollection.contextUrl}
          onSaved={(context, contextUrl) => {
            setCollections((prev) =>
              prev.map((c) => (c.id === selectedCollection.id ? { ...c, context, contextUrl } : c)),
            );
            setContextDialogOpen(false);
          }}
        />
      )}

      {/* Document panel */}
      <DocumentPanel
        page={panelPage}
        result={panelResult}
        isLoading={panelLoading}
        onClose={() => {
          setPanelPage(null);
          setPanelResult(null);
          setPanelLoading(false);
        }}
        onResultUpdate={(updated) => setPanelResult(updated)}
        onPageUpdate={(updated) => {
          setPanelPage(updated);
          setPages((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
        }}
        onRegenerate={(pageId) => void handleRegenerate(pageId)}
        isRegenerating={regenerating}
        regenerateStep={regenerateStep}
        regenerateProgress={regenerateProgress}
        hasPrevious={(() => {
          if (!panelPage) return false;
          const idx = pages.findIndex((p) => p.id === panelPage.id);
          return idx > 0;
        })()}
        hasNext={(() => {
          if (!panelPage) return false;
          const idx = pages.findIndex((p) => p.id === panelPage.id);
          return idx >= 0 && idx < pages.length - 1;
        })()}
        onPrevious={() => {
          if (!panelPage) return;
          const idx = pages.findIndex((p) => p.id === panelPage.id);
          if (idx > 0) void handlePageDoubleClick(pages[idx - 1]!);
        }}
        onNext={() => {
          if (!panelPage) return;
          const idx = pages.findIndex((p) => p.id === panelPage.id);
          if (idx >= 0 && idx < pages.length - 1) void handlePageDoubleClick(pages[idx + 1]!);
        }}
      />
    </AppShell>
  );
}
