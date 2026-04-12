'use client';

import { useState, useCallback, useEffect, useRef, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { AppShell } from '@/components/AppShell';
import { Toolbar } from '@/components/Toolbar';
import { FileGrid, type PageItem } from '@/components/FileGrid';
import { FileList } from '@/components/FileList';
import { ImportDialog, type UploadedPage } from '@/components/ImportDialog';
import { DocumentPanel } from '@/components/DocumentPanel';
import { CollectionContextDialog } from '@/components/CollectionContextDialog';
import { ShareDialog } from '@/components/ShareDialog';
import type { Collection, Workspace } from '@/components/Sidebar';
import type { DocumentResult } from '@/components/ResultViewer';
import { useDesktopSelection } from '@/hooks/useDesktopSelection';
import { useProcessingJob } from '@/hooks/useProcessingJob';
import { useJobPolling } from '@/hooks/useJobPolling';
import { useWorkspaceKeyboard } from '@/hooks/useWorkspaceKeyboard';
import { CollectionMetadataEditor } from '@/components/CollectionMetadataEditor';
import { CreateCollectionDialog } from '@/components/CreateCollectionDialog';
import { CreateWorkspaceDialog } from '@/components/CreateWorkspaceDialog';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { apiFetch } from '@/lib/infrastructure/api-client';

/** Shape of a document API response with translations */
interface DocApiResponse {
  id: string;
  transcription: string;
  detectedLanguage: string;
  context: string;
  hash?: string;
  translations: {
    language: string;
    text: string;
    context?: string | null;
    glossaryJson?: string | null;
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
}

/** Map a document API response + page metadata into a DocumentResult */
function mapDocToResult(
  doc: DocApiResponse,
  page: {
    mimeType?: string | null;
    fileSize?: number | null;
    width?: number | null;
    height?: number | null;
    createdAt?: string;
  },
  locale: string,
  cached: boolean,
): DocumentResult | null {
  const translation = doc.translations.find((tr) => tr.language === locale);
  if (!translation) return null;
  const context = translation?.context || doc.context;
  const glossary: { term: string; definition: string }[] = translation?.glossaryJson
    ? (JSON.parse(translation.glossaryJson) as { term: string; definition: string }[])
    : doc.glossary;

  return {
    id: doc.id,
    transcription: doc.transcription,
    detectedLanguage: doc.detectedLanguage,
    translation: translation?.text ?? '',
    translationLanguage: translation?.language ?? '',
    context,
    glossary,
    cached,
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
  };
}

export default function HomePage(): React.JSX.Element {
  return (
    <Suspense>
      <WorkspaceContent />
    </Suspense>
  );
}

function WorkspaceContent(): React.JSX.Element {
  const t = useTranslations('workspace');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Workspace state
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const selectedWorkspaceId = searchParams.get('workspace');

  // Navigation state – synced with URL ?workspace=WSID&collection=CID
  const selectedCollectionId = searchParams.get('collection');
  const [collections, setCollections] = useState<Collection[]>([]);
  // Loading state managed internally by loadCollections callback
  const [, setLoadingCollections] = useState(true);

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
  const [translatingContext, setTranslatingContext] = useState(false);

  // Share dialog
  const [shareTarget, setShareTarget] = useState<{
    id: string;
    type: 'collection' | 'page';
    name: string;
    isPublic: boolean;
    slug: string | null;
  } | null>(null);

  // Blank detection
  const [detectingBlank, setDetectingBlank] = useState(false);

  // Generate context from selected pages
  const [generatingContext, setGeneratingContext] = useState(false);

  // Create collection dialog
  const [createCollectionDialogOpen, setCreateCollectionDialogOpen] = useState(false);

  // Create workspace dialog
  const [createWorkspaceDialogOpen, setCreateWorkspaceDialogOpen] = useState(false);

  // Document panel
  const [panelPage, setPanelPage] = useState<PageItem | null>(null);
  const [panelResult, setPanelResult] = useState<DocumentResult | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateStep, setRegenerateStep] = useState<string | undefined>(undefined);
  const [regenerateProgress, setRegenerateProgress] = useState<number | undefined>(undefined);

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

  // ---- Processing job hook (Inngest + DB polling) ----
  const {
    processingPageIds,
    processingStep,
    processingProgress,
    isProcessing,
    handleProcessSelected,
    handleCancelProcessing,
    setError,
    error,
  } = useProcessingJob({
    pages,
    setPages,
    selected,
    collections,
    loadingPages,
    locale,
  });

  const { pollJob } = useJobPolling();

  // ---- Load workspaces ----
  const loadWorkspaces = useCallback(async (): Promise<void> => {
    setLoadingWorkspaces(true);
    try {
      const res = await apiFetch('/api/workspaces');
      if (!res.ok) return;
      const data = (await res.json()) as Workspace[];
      setWorkspaces(data);
    } catch {
      // ignore
    } finally {
      setLoadingWorkspaces(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  // Auto-select home workspace when workspaces load and none is selected
  useEffect(() => {
    if (loadingWorkspaces || workspaces.length === 0) return;
    if (selectedWorkspaceId !== null) return;
    const home = workspaces.find((ws) => ws.type === 'home');
    if (home) {
      router.replace(`/workspace?workspace=${home.id}`);
    }
  }, [loadingWorkspaces, workspaces, selectedWorkspaceId, router]);

  // ---- Load collections (filtered by workspace) ----
  const loadCollections = useCallback(async (): Promise<void> => {
    if (!selectedWorkspaceId) return;
    setLoadingCollections(true);
    try {
      const res = await apiFetch(`/api/collections?workspaceId=${selectedWorkspaceId}`);
      if (!res.ok) return;
      const data = (await res.json()) as Collection[];
      setCollections(data);
    } catch {
      // ignore
    } finally {
      setLoadingCollections(false);
    }
  }, [selectedWorkspaceId]);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  // ---- Load pages ----
  const loadPages = useCallback(
    async (collectionId: string | null): Promise<void> => {
      setLoadingPages(true);
      try {
        const url = collectionId !== null ? `/api/collections/${collectionId}` : '/api/pages';
        const res = await apiFetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as
          | PageItem[]
          | { pages: PageItem[] }
          | { id: string; pages: PageItem[] };

        // Pages with status 'done' but no translation in the current locale
        // should appear as 'pending' (needs translation)
        const adjustStatus = (pages: PageItem[]): PageItem[] =>
          pages.map((p) => {
            if (
              p.status === 'done' &&
              p.document &&
              !p.document.translations.some((tr) => tr.language === locale)
            ) {
              return { ...p, status: 'pending' };
            }
            return p;
          });

        if (Array.isArray(data)) {
          setPages(adjustStatus(data));
        } else if ('pages' in data) {
          setPages(adjustStatus((data as { pages: PageItem[] }).pages));
        }
      } catch {
        // ignore
      } finally {
        setLoadingPages(false);
      }
    },
    [locale],
  );

  useEffect(() => {
    void loadPages(selectedCollectionId);
  }, [loadPages, selectedCollectionId]);

  // ---- Workspace navigation ----
  const handleWorkspaceSelect = useCallback(
    (id: string): void => {
      router.push(`/workspace?workspace=${id}`);
      setPanelResult(null);
      setPages([]);
    },
    [router],
  );

  // ---- Collection navigation (URL-based for browser back/forward) ----
  const fixDocumentContexts = useCallback(
    async (collectionId: string): Promise<void> => {
      setFixingContexts(true);
      setFixingContextsProgress(null);
      try {
        const res = await apiFetch(`/api/collections/${collectionId}/fix-document-contexts`, {
          method: 'POST',
        });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          setError(errData.error ?? t('contextFixFailed'));
          setFixingContexts(false);
          setFixingContextsProgress(null);
          return;
        }
        const { jobId } = (await res.json()) as { jobId: string };

        const result = await pollJob(jobId, {
          onStep: (step) => setFixingContextsProgress(step),
        });
        setFixingContexts(false);
        setFixingContextsProgress(null);
        if (result === 'error') {
          setError(t('contextFixesFailed'));
        }
        // Reload pages to get updated contexts
        void loadPages(selectedCollectionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('error'));
        setFixingContexts(false);
        setFixingContextsProgress(null);
      }
    },
    [setError, selectedCollectionId, loadPages, pollJob],
  );

  const translateContext = useCallback(
    async (collectionId: string): Promise<void> => {
      setTranslatingContext(true);
      try {
        const res = await apiFetch(`/api/collections/${collectionId}/translate-context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetLanguage: locale }),
        });
        if (!res.ok) {
          const errData = (await res.json().catch(() => ({}))) as { error?: string };
          setError(errData.error ?? 'Translation failed');
          setTranslatingContext(false);
          return;
        }
        const { jobId } = (await res.json()) as { jobId: string };

        const result = await pollJob(jobId);
        setTranslatingContext(false);
        if (result === 'error') {
          setError('Context translation failed');
        }
        void loadCollections();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Error');
        setTranslatingContext(false);
      }
    },
    [locale, loadCollections, setError, pollJob],
  );

  const handleCollectionSelect = useCallback(
    (id: string | null): void => {
      const wsParam = selectedWorkspaceId ? `workspace=${selectedWorkspaceId}` : '';
      if (id === null) {
        router.push(wsParam ? `/workspace?${wsParam}` : '/workspace');
      } else {
        const params = wsParam ? `${wsParam}&collection=${id}` : `collection=${id}`;
        router.push(`/workspace?${params}`);
      }
      setPanelPage(null);
      setPanelResult(null);
    },
    [router, selectedWorkspaceId],
  );

  const selectedCollection =
    selectedCollectionId !== null
      ? (collections.find((c) => c.id === selectedCollectionId) ?? null)
      : null;

  // When on "all" view, detect if exactly one collection is selected in the grid
  const selectedGridCollection = useMemo(() => {
    if (selectedCollectionId !== null) return null;
    const collectionIds = new Set(collections.map((c) => c.id));
    const selectedCols = [...selected].filter((id) => collectionIds.has(id));
    if (selectedCols.length === 1) {
      return collections.find((c) => c.id === selectedCols[0]) ?? null;
    }
    return null;
  }, [selectedCollectionId, collections, selected]);

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

  // ---- Blank detection & toggle ----
  const handleToggleBlank = useCallback(
    async (pageIds: string[], blank: boolean): Promise<void> => {
      const newStatus = blank ? 'blank' : 'pending';
      setPages((prev) =>
        prev.map((p) => (pageIds.includes(p.id) ? { ...p, status: newStatus } : p)),
      );
      await Promise.all(
        pageIds.map((id) =>
          apiFetch(`/api/pages/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus }),
          }).catch(() => {
            // Revert on error
            void loadPages(selectedCollectionId);
          }),
        ),
      );
    },
    [selectedCollectionId, loadPages],
  );

  const handleDetectBlank = useCallback(async (): Promise<void> => {
    const pendingPages = pages.filter((p) => p.status === 'pending');
    if (pendingPages.length === 0) return;

    setDetectingBlank(true);
    try {
      const res = await apiFetch('/api/pages/detect-blank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds: pendingPages.map((p) => p.id) }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          results: { pageId: string; blank: boolean }[];
        };
        const blankIds = new Set(data.results.filter((r) => r.blank).map((r) => r.pageId));
        if (blankIds.size > 0) {
          setPages((prev) => prev.map((p) => (blankIds.has(p.id) ? { ...p, status: 'blank' } : p)));
        }
      }
    } catch {
      // ignore
    } finally {
      setDetectingBlank(false);
    }
  }, [pages]);

  // ---- Generate context from selected pages ----
  const handleGenerateContext = useCallback(async (): Promise<void> => {
    if (!selectedCollectionId) return;
    const donePageIds = Array.from(selected).filter((id) => {
      const p = pages.find((pg) => pg.id === id);
      return p && p.status === 'done';
    });
    if (donePageIds.length === 0) return;

    setGeneratingContext(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/collections/${selectedCollectionId}/generate-context`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageIds: donePageIds }),
      });
      let data: { jobId?: string; error?: string };
      try {
        data = (await res.json()) as { jobId?: string; error?: string };
      } catch {
        throw new Error(`Server returned ${res.status}`);
      }
      if (!res.ok) throw new Error(data.error ?? t('generationFailed'));

      const { jobId } = data;
      if (!jobId) throw new Error('Server nevrátil jobId');

      const result = await pollJob(jobId);
      setGeneratingContext(false);
      if (result === 'completed') {
        // Reload collection to get updated context and metadata
        void loadCollections();
      } else if (result === 'error') {
        setError(t('generationFailed'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error'));
      setGeneratingContext(false);
    }
  }, [selectedCollectionId, selected, pages, setError, loadCollections, pollJob]);

  // ---- Rename collection ----
  const handleRenameCollection = useCallback(async (): Promise<void> => {
    // Determine which collection to rename: the one navigated into, or the one selected in grid
    const colId = selectedCollectionId ?? selectedGridCollection?.id;
    if (!colId) return;
    const col = collections.find((c) => c.id === colId);
    if (!col) return;

    // Use the title from metadata if available, otherwise the current name
    const currentName = col.title ?? col.name;
    const newName = window.prompt(t('renameCollectionPrompt'), currentName);
    if (!newName || newName.trim() === '' || newName.trim() === currentName) return;

    try {
      const res = await apiFetch(`/api/collections/${colId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        setCollections((prev) =>
          prev.map((c) => (c.id === colId ? { ...c, name: newName.trim() } : c)),
        );
      }
    } catch {
      // ignore
    }
  }, [selectedCollectionId, selectedGridCollection, collections]);

  // ---- Move pages (drag & drop) ----
  const handleMovePages = useCallback(
    async (pageIds: string[], targetCollectionId: string | null): Promise<void> => {
      // Optimistically remove moved pages from current view
      setPages((prev) => prev.filter((p) => !pageIds.includes(p.id)));

      // Fire API calls
      await Promise.all(
        pageIds.map((id) =>
          apiFetch(`/api/pages/${id}`, {
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

  // ---- Reorder pages via DnD ----
  const handleReorderPages = useCallback(
    async (draggedIds: string[], targetPageId: string, position: 'before' | 'after') => {
      const draggedSet = new Set(draggedIds);
      const remaining = pages.filter((p) => !draggedSet.has(p.id));
      const dragged = pages.filter((p) => draggedSet.has(p.id));
      const targetIndex = remaining.findIndex((p) => p.id === targetPageId);
      if (targetIndex === -1) return;

      const insertAt = position === 'before' ? targetIndex : targetIndex + 1;
      const reordered = [
        ...remaining.slice(0, insertAt),
        ...dragged,
        ...remaining.slice(insertAt),
      ];

      // Optimistic update
      const withOrder = reordered.map((p, i) => ({ ...p, order: i }));
      setPages(withOrder);

      // Persist only changed pages
      const orderMap = new Map(pages.map((p) => [p.id, p.order]));
      const changed = withOrder.filter((p) => orderMap.get(p.id) !== p.order);

      try {
        await Promise.all(
          changed.map((p) =>
            apiFetch(`/api/pages/${p.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ order: p.order }),
            }),
          ),
        );
      } catch {
        void loadPages(selectedCollectionId);
      }
    },
    [pages, selectedCollectionId, loadPages],
  );

  // ---- Delete ----
  const handleDeletePage = useCallback(
    async (pageId: string): Promise<void> => {
      const page = pages.find((p) => p.id === pageId);
      if (!page) return;

      if (page.status === 'done' || page.document) {
        try {
          await apiFetch(`/api/pages/${pageId}`, {
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
          await apiFetch(`/api/pages/${pageId}`, { method: 'DELETE' });
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

  // ---- Update URL with page parameter ----
  const setPageInUrl = useCallback((pageId: string | null): void => {
    const params = new URLSearchParams(window.location.search);
    if (pageId) {
      params.set('page', pageId);
    } else {
      params.delete('page');
    }
    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }, []);

  // ---- Page double-click (open panel for any status) ----
  const handlePageDoubleClick = useCallback(
    async (page: PageItem): Promise<void> => {
      setPanelPage(page);
      setPanelResult(null);
      setError(null);
      setPageInUrl(page.id);

      if (page.document) {
        setPanelLoading(true);
        try {
          const res = await apiFetch(`/api/documents/${page.document.id}`);
          if (!res.ok) throw new Error(t('failedToLoadDocument'));
          const doc = (await res.json()) as DocApiResponse;
          setPanelResult(mapDocToResult(doc, page, locale, true));
        } catch (err) {
          setError(err instanceof Error ? err.message : t('error'));
        } finally {
          setPanelLoading(false);
        }
      } else {
        // Fetch full page data for metadata (width, height, etc.)
        try {
          const res = await apiFetch(`/api/pages/${page.id}`);
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
    },
    [setError, setPageInUrl],
  );

  // ---- Restore panel from URL ?page=ID on initial load ----
  const pageIdFromUrl = searchParams.get('page');
  const restoredPageRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pageIdFromUrl || loadingPages || pages.length === 0) return;
    if (restoredPageRef.current === pageIdFromUrl) return; // already restored
    const page = pages.find((p) => p.id === pageIdFromUrl);
    if (page) {
      restoredPageRef.current = pageIdFromUrl;
      void handlePageDoubleClick(page);
    }
  }, [pageIdFromUrl, pages, loadingPages, handlePageDoubleClick]);

  // ---- Keyboard shortcuts hook ----
  const { focusedItemId, setColumnsCount } = useWorkspaceKeyboard({
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
    onCollectionSelect: (id: string) => handleCollectionSelect(id),
    onPageOpen: (page: PageItem) => {
      void handlePageDoubleClick(page);
    },
    onDeleteSelected: () => {
      void handleDeleteSelected();
    },
    isPanelOpen: panelPage !== null,
  });

  // ---- Regenerate document ----
  const handleRegenerate = useCallback(
    async (pageId: string): Promise<void> => {
      setRegenerating(true);
      setRegenerateStep(t('preparingRetranslation'));
      setRegenerateProgress(0);
      setPanelResult(null);
      try {
        const page = pages.find((p) => p.id === pageId);

        // Document exists but missing translation for current locale → retranslate only
        if (page?.document) {
          const docRes = await apiFetch(`/api/documents/${page.document.id}`);
          if (docRes.ok) {
            const doc = (await docRes.json()) as DocApiResponse;
            const hasLocaleTranslation = doc.translations.some((tr) => tr.language === locale);
            if (!hasLocaleTranslation && doc.transcription) {
              setRegenerateStep(t('callingModel'));
              const retransRes = await apiFetch(
                `/api/documents/${page.document.id}/retranslate`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ language: locale }),
                },
              );
              if (!retransRes.ok) {
                const errData = (await retransRes.json()) as { error?: string };
                throw new Error(errData.error ?? `HTTP ${retransRes.status}`);
              }
              const { jobId } = (await retransRes.json()) as { jobId: string };
              await pollJob(jobId, {
                onStep: (step) => setRegenerateStep(step),
                onProgress: (completed, total) => {
                  if (total > 0) setRegenerateProgress(Math.round((completed / total) * 100));
                },
              });
              // Reload page and document with new translation
              const pageRes = await apiFetch(`/api/pages/${pageId}`);
              if (pageRes.ok) {
                const updatedPage = (await pageRes.json()) as PageItem;
                setPanelPage(updatedPage);
                setPages((prev) => prev.map((p) => (p.id === pageId ? updatedPage : p)));
                if (updatedPage.document) {
                  const reloadDoc = await apiFetch(
                    `/api/documents/${updatedPage.document.id}`,
                  );
                  if (reloadDoc.ok) {
                    const updatedDoc = (await reloadDoc.json()) as DocApiResponse;
                    setPanelResult(mapDocToResult(updatedDoc, updatedPage, locale, false));
                  }
                }
              }
              return;
            }
          }
        }

        // No document at all → full processing
        if (page?.document) {
          // Try re-parsing from stored rawResponse first (free, no API call)
          setRegenerateStep(t('tryingToFixParsing'));
          const reparseRes = await apiFetch(`/api/documents/${page.document.id}/reparse`, {
            method: 'POST',
          });
          if (reparseRes.ok) {
            // Re-parse succeeded — reload document
            const pageRes = await apiFetch(`/api/pages/${pageId}`);
            if (pageRes.ok) {
              const updatedPage = (await pageRes.json()) as PageItem;
              setPanelPage(updatedPage);
              setPages((prev) => prev.map((p) => (p.id === pageId ? updatedPage : p)));
              if (updatedPage.document) {
                const docRes = await apiFetch(`/api/documents/${updatedPage.document.id}`);
                if (docRes.ok) {
                  const doc = (await docRes.json()) as DocApiResponse;
                  setPanelResult(mapDocToResult(doc, updatedPage, locale, false));
                }
              }
            }
            return; // Done — no API call needed
          }
          // Re-parse failed — fall through to full regeneration
          console.log('[Regenerate] Re-parse failed, falling back to full regeneration');
          await apiFetch(`/api/documents/${page.document.id}`, { method: 'DELETE' });
        }
        // Reset page status
        await apiFetch(`/api/pages/${pageId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'pending' }),
        });
        // Process again via Inngest background job
        setRegenerateStep(t('callingModel'));
        const response = await apiFetch('/api/pages/process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageIds: [pageId], language: locale }),
        });
        if (!response.ok) {
          const errData = (await response.json()) as { error?: string };
          throw new Error(errData.error ?? `HTTP ${response.status}`);
        }
        const { jobId } = (await response.json()) as { jobId: string };

        await pollJob(jobId, {
          onStep: (step) => setRegenerateStep(step),
          onProgress: (completed, total) => {
            if (total > 0) setRegenerateProgress(Math.round((completed / total) * 100));
          },
        });

        // Reload the document after job completes
        const pageRes = await apiFetch(`/api/pages/${pageId}`);
        if (pageRes.ok) {
          const updatedPage = (await pageRes.json()) as PageItem;
          setPanelPage(updatedPage);
          setPages((prev) => prev.map((p) => (p.id === pageId ? updatedPage : p)));
          if (updatedPage.document) {
            const docRes = await apiFetch(`/api/documents/${updatedPage.document.id}`);
            if (docRes.ok) {
              const doc = (await docRes.json()) as DocApiResponse;
              setPanelResult(mapDocToResult(doc, updatedPage, locale, false));
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t('regenerationFailed'));
      } finally {
        setRegenerating(false);
        setRegenerateStep(undefined);
        setRegenerateProgress(undefined);
      }
    },
    [pages, setError, pollJob],
  );

  // ---- Derived values ----
  const pendingSelectedCount = useMemo(() => {
    const selectedIds = Array.from(selected);
    const collectionIds = new Set(collections.map((c) => c.id));
    const expandedPageIds = new Set<string>();
    let collectionPageEstimate = 0;

    for (const id of selectedIds) {
      if (collectionIds.has(id)) {
        // In root view, pages of this collection are NOT in `pages` array.
        // Use _count as estimate so the button is enabled.
        const col = collections.find((c) => c.id === id);
        if (col) collectionPageEstimate += col.processableCount;
      } else {
        expandedPageIds.add(id);
      }
    }

    const localPending = Array.from(expandedPageIds).filter((id) => {
      const p = pages.find((pg) => pg.id === id);
      return p && (p.status === 'pending' || p.status === 'error');
    }).length;

    return localPending + collectionPageEstimate;
  }, [selected, collections, pages]);
  const doneCount = pages.filter((p) => p.status === 'done').length;
  const doneSelectedCount = useMemo(() => {
    return Array.from(selected).filter((id) => {
      const p = pages.find((pg) => pg.id === id);
      return p && p.status === 'done';
    }).length;
  }, [selected, pages]);

  // Drag-and-drop on content area to open upload
  const handleContentDrop = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setContentDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      setUploadOpen(true);
    }
  }, []);

  // ---- Share item ----
  const handleShareItem = useCallback(
    (id: string, type: 'collection' | 'page'): void => {
      if (type === 'collection') {
        const col = collections.find((c) => c.id === id);
        if (!col) return;
        setShareTarget({
          id,
          type,
          name: col.name,
          isPublic: col.isPublic ?? false,
          slug: col.slug ?? null,
        });
      } else {
        const page = pages.find((p) => p.id === id);
        if (!page) return;
        setShareTarget({
          id,
          type,
          name: page.displayName ?? page.filename,
          isPublic: page.isPublic ?? false,
          slug: page.slug ?? null,
        });
      }
    },
    [collections, pages],
  );

  const handleShareUpdate = useCallback(
    (isPublic: boolean, slug: string | null): void => {
      if (!shareTarget) return;
      if (shareTarget.type === 'collection') {
        setCollections((prev) =>
          prev.map((c) => (c.id === shareTarget.id ? { ...c, isPublic, slug } : c)),
        );
      } else {
        setPages((prev) =>
          prev.map((p) => (p.id === shareTarget.id ? { ...p, isPublic, slug } : p)),
        );
      }
      setShareTarget((prev) => (prev ? { ...prev, isPublic, slug } : null));
    },
    [shareTarget],
  );

  return (
    <AppShell
      workspaces={workspaces}
      selectedWorkspaceId={selectedWorkspaceId}
      onWorkspaceSelect={handleWorkspaceSelect}
      onCreateWorkspace={() => setCreateWorkspaceDialogOpen(true)}
      loadingWorkspaces={loadingWorkspaces}
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
        onCreateCollection={() => setCreateCollectionDialogOpen(true)}
        onSortByName={
          selectedCollectionId
            ? async () => {
                const sorted = [...pages].sort((a, b) => {
                  const nameA = (a.displayName || a.filename).toLowerCase();
                  const nameB = (b.displayName || b.filename).toLowerCase();
                  return nameA.localeCompare(nameB, 'cs', { numeric: true });
                });
                setPages(sorted);
                await Promise.all(
                  sorted.map((p, i) =>
                    apiFetch(`/api/pages/${p.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ order: i }),
                    }),
                  ),
                );
              }
            : undefined
        }
        onEditContext={() => setContextDialogOpen(true)}
        hasCollection={selectedCollectionId !== null}
        processingStep={processingStep}
        processingProgress={processingProgress}
        onCancelProcessing={isProcessing ? handleCancelProcessing : undefined}
        onPauseProcessing={undefined}
        onResumeProcessing={undefined}
        isPaused={false}
        onDetectBlank={() => void handleDetectBlank()}
        detectingBlank={detectingBlank}
        onShareCollection={
          selectedCollectionId
            ? () => handleShareItem(selectedCollectionId, 'collection')
            : selectedGridCollection
              ? () => handleShareItem(selectedGridCollection.id, 'collection')
              : undefined
        }
        isCollectionPublic={
          selectedCollectionId
            ? (collections.find((c) => c.id === selectedCollectionId)?.isPublic ?? false)
            : (selectedGridCollection?.isPublic ?? false)
        }
        onGenerateContext={selectedCollectionId ? () => void handleGenerateContext() : undefined}
        generatingContext={generatingContext}
        doneSelectedCount={doneSelectedCount}
        onRenameCollection={
          (selectedCollectionId ?? selectedGridCollection)
            ? () => void handleRenameCollection()
            : undefined
        }
      />

      {/* Generating context banner */}
      {generatingContext && (
        <div className="mx-4 mt-3 overflow-hidden rounded-lg border border-blue-200 bg-blue-50">
          <div className="flex items-center gap-2 px-4 py-2.5 text-sm text-blue-700">
            <svg className="h-4 w-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
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
            <span>{t('generatingContextFromSelected')}</span>
          </div>
          <div className="h-1 bg-blue-200">
            <div
              className="h-full w-2/5 rounded-full bg-blue-600"
              style={{ animation: 'indeterminate 1.5s ease-in-out infinite' }}
            />
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700"
        >
          <strong className="font-semibold">{t('errorPrefix')} </strong>
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-red-600">
            x
          </button>
        </div>
      )}

      {/* Interrupted processing banner removed — Inngest handles recovery via DB-based jobs */}

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
        {/* Collection info cards: structured data + context + metadata (3-column) */}
        {selectedCollection && (
          <div className="mx-4 mt-3 grid gap-3 lg:grid-cols-3">
            {/* Strukturovaná data — 1/3 */}
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <details>
                <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                  {t('structuredData')}
                </summary>
                <div className="border-t border-slate-100 px-4 py-3">
                  <CollectionMetadataEditor
                    collectionId={selectedCollection.id}
                    metadata={{
                      title: selectedCollection.title,
                      author: selectedCollection.author,
                      yearFrom: selectedCollection.yearFrom,
                      yearTo: selectedCollection.yearTo,
                      librarySignature: selectedCollection.librarySignature,
                      abstract: selectedCollection.abstract,
                    }}
                    hasContext={!!selectedCollection.context}
                    onSaved={() => void loadCollections()}
                  />
                </div>
              </details>
            </div>

            {/* Kontext díla — 1/3 */}
            {selectedCollection.context &&
            (selectedCollection.contextLanguage ?? 'cs') === locale ? (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <details>
                  <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                    {t('collectionContextTitle', { name: selectedCollection.name })}
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
                          {fixingContextsProgress ?? t('fixing')}
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
                          {t('fixContextFromCollection')}
                        </>
                      )}
                    </button>
                  </div>
                </details>
              </div>
            ) : selectedCollection.context &&
              (selectedCollection.contextLanguage ?? 'cs') !== locale ? (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <details>
                  <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                    {t('collectionContextTitle', { name: selectedCollection.name })}
                  </summary>
                  <div className="border-t border-slate-100 px-4 py-3">
                    <button
                      onClick={() => void translateContext(selectedCollection.id)}
                      disabled={translatingContext}
                      className="flex items-center gap-1.5 rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
                    >
                      {translatingContext ? (
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
                          {t('translatingContext')}
                        </>
                      ) : (
                        t('translateContext')
                      )}
                    </button>
                  </div>
                </details>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <details>
                  <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                    {t('collectionContextTitle', { name: selectedCollection.name })}
                  </summary>
                  <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-400">
                    {t('contextNotSet')}
                  </div>
                </details>
              </div>
            )}

            {/* Metadata card — 1/3 */}
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <details>
                <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">
                  {t('collectionMetadata')}
                </summary>
                <div className="border-t border-slate-100 px-4 py-3 space-y-3">
                  {/* Status counts */}
                  <div>
                    <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      {t('pageStatus')}
                    </h4>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-slate-500">{t('total')}</span>
                        <span className="font-medium text-slate-700">
                          {selectedCollection._count.pages}
                        </span>
                      </div>
                      {selectedCollection.stats?.done > 0 && (
                        <div className="flex justify-between">
                          <span className="text-green-600">{t('done')}</span>
                          <span className="font-medium text-green-700">
                            {selectedCollection.stats?.done}
                          </span>
                        </div>
                      )}
                      {selectedCollection.stats?.pending > 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">{t('pending')}</span>
                          <span className="font-medium text-slate-700">
                            {selectedCollection.stats?.pending}
                          </span>
                        </div>
                      )}
                      {selectedCollection.stats?.error > 0 && (
                        <div className="flex justify-between">
                          <span className="text-red-600">{t('error')}</span>
                          <span className="font-medium text-red-700">
                            {selectedCollection.stats?.error}
                          </span>
                        </div>
                      )}
                      {selectedCollection.stats?.blank > 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">{t('blank')}</span>
                          <span className="font-medium text-slate-500">
                            {selectedCollection.stats?.blank}
                          </span>
                        </div>
                      )}
                    </div>
                    {/* Status bar */}
                    {selectedCollection._count.pages > 0 && (
                      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-100">
                        {selectedCollection.stats?.done > 0 && (
                          <div
                            className="bg-green-500"
                            style={{
                              width: `${(selectedCollection.stats?.done / selectedCollection._count.pages) * 100}%`,
                            }}
                          />
                        )}
                        {selectedCollection.stats?.error > 0 && (
                          <div
                            className="bg-red-400"
                            style={{
                              width: `${(selectedCollection.stats?.error / selectedCollection._count.pages) * 100}%`,
                            }}
                          />
                        )}
                        {selectedCollection.stats?.blank > 0 && (
                          <div
                            className="bg-slate-300"
                            style={{
                              width: `${(selectedCollection.stats?.blank / selectedCollection._count.pages) * 100}%`,
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>

                  {/* Tokens & cost */}
                  {(selectedCollection.stats?.inputTokens > 0 ||
                    selectedCollection.stats?.outputTokens > 0) && (
                    <div>
                      <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        {t('consumption')}
                      </h4>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-slate-500">{t('inputTokens')}</span>
                          <span className="font-medium text-slate-700">
                            {(selectedCollection.stats?.inputTokens / 1000).toFixed(1)}k
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">{t('outputTokens')}</span>
                          <span className="font-medium text-slate-700">
                            {(selectedCollection.stats?.outputTokens / 1000).toFixed(1)}k
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-slate-100 pt-1">
                          <span className="font-medium text-slate-600">{t('price')}</span>
                          <span className="font-semibold text-slate-800">
                            {'$'}
                            {selectedCollection.stats?.costUsd.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </details>
            </div>
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
            onReorderPages={(ids, targetId, pos) => void handleReorderPages(ids, targetId, pos)}
            onSetSelected={setSelected}
            onSelectAll={handleSelectAll}
            onDeselectAll={handleDeselectAll}
            onProcessSelected={() => void handleProcessSelected()}
            onDeleteSelected={() => void handleDeleteSelected()}
            onImportClick={() => setUploadOpen(true)}
            focusedItemId={focusedItemId}
            onColumnsChange={setColumnsCount}
            onToggleBlank={(ids, blank) => void handleToggleBlank(ids, blank)}
            onShareItem={handleShareItem}
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
              <p className="text-lg font-semibold">{t('dropFilesHere')}</p>
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
          initialContextUrls={selectedCollection.contextUrls}
          onSaved={(context, contextUrls) => {
            setCollections((prev) =>
              prev.map((c) =>
                c.id === selectedCollection.id ? { ...c, context, contextUrls } : c,
              ),
            );
            setContextDialogOpen(false);
          }}
        />
      )}

      {/* Share dialog */}
      {shareTarget && (
        <ShareDialog
          isOpen={true}
          onClose={() => setShareTarget(null)}
          itemId={shareTarget.id}
          itemType={shareTarget.type}
          itemName={shareTarget.name}
          currentIsPublic={shareTarget.isPublic}
          currentSlug={shareTarget.slug}
          onUpdate={handleShareUpdate}
        />
      )}

      {/* Create collection dialog */}
      <CreateCollectionDialog
        open={createCollectionDialogOpen}
        onClose={() => setCreateCollectionDialogOpen(false)}
        onCreated={(collection) => {
          void loadCollections();
          handleCollectionSelect(collection.id);
        }}
      />

      {/* Create workspace dialog */}
      <CreateWorkspaceDialog
        open={createWorkspaceDialogOpen}
        onClose={() => setCreateWorkspaceDialogOpen(false)}
        onCreated={(workspace) => {
          setWorkspaces((prev) => [...prev, workspace]);
          handleWorkspaceSelect(workspace.id);
        }}
      />

      {/* Document panel */}
      <DocumentPanel
        page={panelPage}
        result={panelResult}
        isLoading={panelLoading}
        onClose={() => {
          setPanelPage(null);
          setPanelResult(null);
          setPanelLoading(false);
          setPageInUrl(null);
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
