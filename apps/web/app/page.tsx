'use client';

import { useState, useCallback, useEffect } from 'react';
import { FileUpload, type UploadedPage } from '@/components/FileUpload';
import { ProcessingStatus } from '@/components/ProcessingStatus';
import { ResultViewer, type DocumentResult } from '@/components/ResultViewer';
import { PageGrid, type PageItem } from '@/components/PageGrid';
import { CollectionSelector } from '@/components/CollectionSelector';

export default function HomePage(): React.JSX.Element {
  // Collection state
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);

  // Pages state
  const [pages, setPages] = useState<PageItem[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);

  // Processing state
  const [processingPageIds, setProcessingPageIds] = useState<Set<string>>(new Set());
  const [processingStep, setProcessingStep] = useState<string | undefined>(undefined);
  const [processingProgress, setProcessingProgress] = useState<number | undefined>(undefined);

  // Result state
  const [result, setResult] = useState<DocumentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load pages from API
  const loadPages = useCallback(async (collectionId: string | null) => {
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

  const handleCollectionSelect = useCallback((id: string | null) => {
    setSelectedCollectionId(id);
  }, []);

  const handleFilesUploaded = useCallback((uploadedPages: UploadedPage[]) => {
    const newPageItems: PageItem[] = uploadedPages.map((p) => ({
      id: p.id,
      filename: p.filename,
      imageUrl: p.imageUrl,
      status: p.status,
      order: p.order,
      collectionId: p.collectionId,
      document: null,
    }));
    setPages((prev) => {
      const existingIds = new Set(prev.map((p) => p.id));
      const truly_new = newPageItems.filter((p) => !existingIds.has(p.id));
      return [...truly_new, ...prev];
    });
  }, []);

  const handleProcessSelected = useCallback(
    async (pageIds: string[]) => {
      setProcessingPageIds(new Set(pageIds));
      setProcessingStep('Spouštím zpracování…');
      setProcessingProgress(0);
      setError(null);

      // Mark pages as processing optimistically
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
              // Update page status in local state
              setPages((prev) =>
                prev.map((p) => (p.id === data.pageId ? { ...p, status: 'done' } : p)),
              );
              // Load fresh page data to get document info
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
              const data = JSON.parse(dataStr) as {
                pageId: string;
                progress: number;
              };
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
        // Revert processing pages to error status
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
    },
    [processingPageIds],
  );

  const handlePageClick = useCallback(async (page: PageItem): Promise<void> => {
    if (!page.document) return;
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
      setResult({
        id: doc.id,
        transcription: doc.transcription,
        detectedLanguage: doc.detectedLanguage,
        translation: translation?.text ?? '',
        translationLanguage: translation?.language ?? '',
        context: doc.context,
        glossary: doc.glossary,
        cached: true,
      });

      // Scroll to result
      setTimeout(() => {
        document.getElementById('result-section')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba');
    }
  }, []);

  const handleDeletePage = useCallback(async (pageId: string): Promise<void> => {
    const page = pages.find((p) => p.id === pageId);
    if (!page) return;

    if (page.status === 'done' || page.document) {
      // Processed page – archive (soft delete via status)
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
      // Unprocessed page – hard delete
      try {
        await fetch(`/api/pages/${pageId}`, { method: 'DELETE' });
        setPages((prev) => prev.filter((p) => p.id !== pageId));
      } catch {
        // ignore
      }
    }
  }, [pages]);

  const isProcessing = processingPageIds.size > 0;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-stone-900">Čtečka starých textů</h1>
        <p className="text-stone-600">
          Nahrajte obrázky historických dokumentů. Systém přepíše text, přeloží ho a přidá kontext.
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        {/* Left: Collection selector */}
        <aside>
          <CollectionSelector selectedId={selectedCollectionId} onSelect={handleCollectionSelect} />
        </aside>

        {/* Right: Main content */}
        <div className="space-y-6">
          {/* Upload area */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-stone-700">Nahrát soubory</h2>
            <FileUpload onFilesUploaded={handleFilesUploaded} collectionId={selectedCollectionId} />
          </section>

          {/* Processing status */}
          <ProcessingStatus
            isProcessing={isProcessing}
            currentStep={processingStep}
            progress={processingProgress}
          />

          {/* Error */}
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
            >
              <strong className="font-semibold">Chyba: </strong>
              {error}
            </div>
          )}

          {/* Page grid */}
          <section>
            <h2 className="mb-3 text-sm font-semibold text-stone-700">
              Stránky
              {loadingPages && (
                <span className="ml-2 text-xs font-normal text-stone-400">Načítám…</span>
              )}
            </h2>
            <PageGrid
              pages={pages}
              onProcessSelected={(ids) => void handleProcessSelected(ids)}
              onPageClick={(page) => void handlePageClick(page)}
              onDelete={(id) => void handleDeletePage(id)}
              processingPageIds={processingPageIds}
            />
          </section>

          {/* Result viewer */}
          {result && (
            <section id="result-section">
              <h2 className="mb-3 text-sm font-semibold text-stone-700">Výsledek</h2>
              <ResultViewer result={result} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
