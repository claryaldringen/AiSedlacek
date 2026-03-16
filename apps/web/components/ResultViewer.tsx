import Image from 'next/image';
import type { ProcessingResult } from '@ai-sedlacek/shared';

interface ResultViewerProps {
  result: ProcessingResult;
}

export function ResultViewer({ result }: ResultViewerProps): React.JSX.Element {
  const ocrText = result.ocrResults[0]?.text ?? '';

  return (
    <div className="space-y-6">
      {/* Main output */}
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
          <h2 className="text-sm font-semibold text-stone-700">Výsledek</h2>
          {result.ocrResults[0] && (
            <p className="text-xs text-stone-400">
              {result.ocrResults[0].engine} – {result.ocrResults[0].processingTimeMs}ms
            </p>
          )}
        </div>
        <div className="whitespace-pre-wrap p-6 text-sm leading-relaxed text-stone-800">
          {ocrText}
        </div>
      </div>

      {/* Images: original + preprocessed */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
            <h3 className="text-sm font-semibold text-stone-700">Originál</h3>
          </div>
          <div className="p-4">
            <Image
              src={result.originalImage}
              alt="Originální dokument"
              width={1200}
              height={800}
              className="max-h-[600px] w-full rounded object-contain"
              unoptimized
            />
          </div>
        </div>

        {result.preprocessedImage && (
          <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
            <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
              <h3 className="text-sm font-semibold text-stone-700">Po předzpracování</h3>
            </div>
            <div className="p-4">
              <Image
                src={result.preprocessedImage}
                alt="Předzpracovaný dokument"
                width={1200}
                height={800}
                className="max-h-[600px] w-full rounded object-contain"
                unoptimized
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
