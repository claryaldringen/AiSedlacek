'use client';

import { useState } from 'react';
import type { ProcessingResult } from '@ai-sedlacek/shared';
import { FileUpload } from '@/components/FileUpload.js';
import { ProcessingStatus } from '@/components/ProcessingStatus.js';
import { ResultViewer } from '@/components/ResultViewer.js';

export default function HomePage(): React.JSX.Element {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileUploaded = async (url: string): Promise<void> => {
    setIsProcessing(true);
    setCurrentStep('Spouštím OCR pipeline…');
    setResult(null);
    setError(null);

    try {
      setCurrentStep('Předzpracovávám obrázek…');
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url }),
      });

      const data = (await response.json()) as ProcessingResult | { error: string };

      if (!response.ok) {
        const errData = data as { error: string };
        throw new Error(errData.error ?? 'Zpracování selhalo');
      }

      setResult(data as ProcessingResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Neznámá chyba';
      setError(message);
    } finally {
      setIsProcessing(false);
      setCurrentStep(undefined);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold text-stone-900">Čtečka starých textů</h1>
        <p className="text-stone-600">Nahrajte obrázek středověkého dokumentu pro OCR a překlad.</p>
      </div>

      <div className="mx-auto max-w-2xl">
        <FileUpload
          onFileUploaded={(url) => {
            void handleFileUploaded(url);
          }}
        />
      </div>

      <ProcessingStatus isProcessing={isProcessing} currentStep={currentStep} />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          <strong className="font-semibold">Chyba: </strong>
          {error}
        </div>
      )}

      {result && <ResultViewer result={result} />}
    </div>
  );
}
