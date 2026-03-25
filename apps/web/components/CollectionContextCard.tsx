'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function CollectionContextCard({ context }: { context: string }): React.JSX.Element {
  const t = useTranslations('collection');
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-8 overflow-hidden rounded-xl border border-[#d4c5a9] bg-[#f5edd6]">
      <div className="relative bg-[#f0e6d0]">
        <div
          className={`prose prose-sm max-w-none overflow-hidden p-5 prose-headings:font-serif prose-headings:text-[#3d2b1f] prose-p:text-[#5a4a3a] prose-strong:text-[#3d2b1f] prose-a:text-[#8b1a1a] ${expanded ? '' : 'max-h-48'}`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{context}</ReactMarkdown>
        </div>
        {!expanded && (
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#f0e6d0] to-transparent" />
        )}
      </div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-center gap-1.5 border-t border-[#d4c5a9] bg-[#ebe0c8] px-5 py-2 font-serif text-xs font-medium text-[#7a6652] transition-colors hover:text-[#3d2b1f]"
      >
        {expanded ? t('collapseContext') : t('showFullContext')}
        <svg
          className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
        </svg>
      </button>
    </div>
  );
}
