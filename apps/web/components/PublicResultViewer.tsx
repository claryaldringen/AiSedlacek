import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface PublicDocument {
  transcription: string;
  detectedLanguage: string;
  context: string;
  translations: { language: string; text: string }[];
  glossary: { term: string; definition: string }[];
}

function Section({ title, content }: { title: string; content: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
        <h2 className="text-sm font-semibold text-stone-700">{title}</h2>
      </div>
      <div className="prose prose-stone prose-sm max-w-none p-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

export function PublicResultViewer({ document }: { document: PublicDocument }): React.JSX.Element {
  const translation = document.translations[0];

  return (
    <div className="flex flex-col gap-px bg-stone-200">
      {/* Row 1: Transcription | Translation */}
      <div className="flex flex-1 gap-px">
        <Section
          title={`Transkripce (${document.detectedLanguage})`}
          content={document.transcription}
        />
        {translation && (
          <Section title={`Překlad (${translation.language})`} content={translation.text} />
        )}
      </div>

      {/* Row 2: Glossary | Context */}
      {(document.glossary.length > 0 || document.context) && (
        <div className="flex gap-px">
          {document.glossary.length > 0 && (
            <div className="flex flex-1 flex-col">
              <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
                <h2 className="text-sm font-semibold text-stone-700">Glosář</h2>
              </div>
              <div className="p-4">
                <dl className="space-y-2">
                  {document.glossary.map((g) => (
                    <div key={g.term}>
                      <dt className="text-sm font-medium text-stone-800">{g.term}</dt>
                      <dd className="text-sm text-stone-600">{g.definition}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          )}
          {document.context && <Section title="Kontext" content={document.context} />}
        </div>
      )}
    </div>
  );
}
