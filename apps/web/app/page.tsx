'use client';

import { useState, useCallback } from 'react';
import { FileUpload } from '@/components/FileUpload';
import { ProcessingStatus } from '@/components/ProcessingStatus';
import { ResultViewer, type DocumentResult } from '@/components/ResultViewer';
import { DocumentList } from '@/components/DocumentList';

export default function HomePage(): React.JSX.Element {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [result, setResult] = useState<DocumentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleFileUploaded = useCallback(async (url: string): Promise<void> => {
    setIsProcessing(true);
    setCurrentStep('Nahrávám…');
    setProgress(5);
    setResult(null);
    setError(null);

    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url, language: 'cs' }),
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
          const eventMatch = eventStr.match(/^event: (\w+)\ndata: (.+)$/s);
          if (!eventMatch) continue;
          const eventType = eventMatch[1];
          const dataStr = eventMatch[2];
          if (!eventType || !dataStr) continue;

          if (eventType === 'progress') {
            const data = JSON.parse(dataStr) as { message: string; progress: number };
            setCurrentStep(data.message);
            setProgress(data.progress);
          } else if (eventType === 'result') {
            setResult(JSON.parse(dataStr) as DocumentResult);
            setRefreshKey((k) => k + 1);
          } else if (eventType === 'error') {
            const data = JSON.parse(dataStr) as { error: string };
            throw new Error(data.error);
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba');
    } finally {
      setIsProcessing(false);
      setCurrentStep(undefined);
      setProgress(undefined);
    }
  }, []);

  const handleSelectDocument = useCallback(async (id: string): Promise<void> => {
    setError(null);
    try {
      const res = await fetch(`/api/documents/${id}`);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neznámá chyba');
    }
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-stone-900">Čtečka starých textů</h1>
        <p className="text-stone-600">
          Nahrajte obrázek historického dokumentu. Systém přepíše text, přeloží ho a přidá kontext.
        </p>
      </div>

      <FileUpload
        onFileUploaded={(url) => {
          void handleFileUploaded(url);
        }}
      />

      <ProcessingStatus isProcessing={isProcessing} currentStep={currentStep} progress={progress} />

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <strong className="font-semibold">Chyba: </strong>
          {error}
        </div>
      )}

      {result && <ResultViewer result={result} />}

      <div>
        <h2 className="mb-3 text-lg font-semibold text-stone-800">Knihovna dokumentů</h2>
        <DocumentList onSelect={(id) => void handleSelectDocument(id)} refreshKey={refreshKey} />
      </div>
    </div>
  );
}
