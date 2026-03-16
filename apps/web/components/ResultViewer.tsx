'use client';

import ReactMarkdown from 'react-markdown';

export interface DocumentResult {
  id: string;
  transcription: string;
  detectedLanguage: string;
  translation: string;
  translationLanguage: string;
  context: string;
  glossary: { term: string; definition: string }[];
  cached: boolean;
}

interface ResultViewerProps {
  result: DocumentResult;
}

export function ResultViewer({ result }: ResultViewerProps): React.JSX.Element {
  return (
    <div className="space-y-6">
      {result.cached && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Nalezen v knihovně – bez API volání
        </div>
      )}

      {/* Transcription */}
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
          <h2 className="text-sm font-semibold text-stone-700">Transkripce</h2>
          <p className="text-xs text-stone-400">
            Jazyk originálu: {result.detectedLanguage}
          </p>
        </div>
        <div className="prose prose-stone prose-sm max-w-none p-6">
          <ReactMarkdown>{result.transcription}</ReactMarkdown>
        </div>
      </div>

      {/* Translation */}
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
          <h2 className="text-sm font-semibold text-stone-700">Překlad</h2>
          <p className="text-xs text-stone-400">
            Jazyk: {result.translationLanguage}
          </p>
        </div>
        <div className="prose prose-stone prose-sm max-w-none p-6">
          <ReactMarkdown>{result.translation}</ReactMarkdown>
        </div>
      </div>

      {/* Context */}
      {result.context && (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
            <h2 className="text-sm font-semibold text-stone-700">Kontext</h2>
          </div>
          <div className="prose prose-stone prose-sm max-w-none p-6">
            <ReactMarkdown>{result.context}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Glossary */}
      {result.glossary.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
            <h2 className="text-sm font-semibold text-stone-700">Slovníček</h2>
          </div>
          <div className="p-6">
            <dl className="space-y-3">
              {result.glossary.map((entry, i) => (
                <div key={i}>
                  <dt className="text-sm font-semibold text-stone-800">{entry.term}</dt>
                  <dd className="mt-0.5 text-sm text-stone-600">{entry.definition}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
