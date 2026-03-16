import ReactMarkdown from 'react-markdown';
import type { ProcessingResult } from '@ai-sedlacek/shared';

interface ResultViewerProps {
  result: ProcessingResult;
}

export function ResultViewer({ result }: ResultViewerProps): React.JSX.Element {
  const ocrText = result.ocrResults[0]?.text ?? '';

  return (
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
        <h2 className="text-sm font-semibold text-stone-700">Výsledek</h2>
        {result.ocrResults[0] && (
          <p className="text-xs text-stone-400">
            {result.ocrResults[0].engine} – {result.ocrResults[0].processingTimeMs}ms
          </p>
        )}
      </div>
      <div className="prose prose-stone prose-sm max-w-none p-6">
        <ReactMarkdown>{ocrText}</ReactMarkdown>
      </div>
    </div>
  );
}
