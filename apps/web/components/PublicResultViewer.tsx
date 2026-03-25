import { getTranslations } from 'next-intl/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export interface PublicDocument {
  transcription: string;
  detectedLanguage: string;
  context: string;
  translations: { language: string; text: string }[];
  glossary: { term: string; definition: string }[];
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-[#d4c5a9] bg-[#f5edd6]">
      <div className="border-b border-[#d4c5a9] bg-[#ebe0c8] px-5 py-3">
        <h2 className="font-serif text-sm font-semibold text-[#3d2b1f]">{title}</h2>
      </div>
      <div className="flex-1 bg-[#f0e6d0] p-5">{children}</div>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }): React.JSX.Element {
  return (
    <div className="prose prose-sm max-w-none prose-headings:font-serif prose-headings:text-[#3d2b1f] prose-p:text-[#5a4a3a] prose-strong:text-[#3d2b1f] prose-a:text-[#8b1a1a]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export async function PublicResultViewer({
  document,
}: {
  document: PublicDocument;
}): Promise<React.JSX.Element> {
  const t = await getTranslations('view');
  const translation = document.translations[0];

  return (
    <div className="flex flex-col gap-4">
      {/* Row 1: Transcription | Translation */}
      <div className="flex flex-1 gap-4">
        <Card title={t('transcription', { lang: document.detectedLanguage })}>
          <MarkdownContent content={document.transcription} />
        </Card>
        {translation && (
          <Card title={t('translation', { lang: translation.language })}>
            <MarkdownContent content={translation.text} />
          </Card>
        )}
      </div>

      {/* Row 2: Glossary | Page Context */}
      {(document.glossary.length > 0 || document.context) && (
        <div className="flex gap-4">
          {document.glossary.length > 0 && (
            <Card title={t('glossary')}>
              <dl className="space-y-3">
                {document.glossary.map((g) => (
                  <div key={g.term}>
                    <dt className="font-serif text-sm font-semibold text-[#3d2b1f]">{g.term}</dt>
                    <dd className="mt-0.5 text-sm leading-relaxed text-[#7a6652]">
                      {g.definition}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
          {document.context && (
            <Card title={t('pageContext')}>
              <MarkdownContent content={document.context} />
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
