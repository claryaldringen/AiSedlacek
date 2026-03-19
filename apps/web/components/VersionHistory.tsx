'use client';

import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Version {
  id: string;
  version: number;
  field: string;
  source: string;
  model: string | null;
  createdAt: string;
  content: string;
}

const SOURCE_LABEL: Record<string, string> = {
  ai_initial: 'AI zpracování',
  ai_retranslate: 'AI retranslace',
  ai_regenerate: 'AI přegenerování',
  manual_edit: 'Ruční úprava',
};

const FIELD_LABEL: Record<string, string> = {
  transcription: 'Transkripce',
  context: 'Kontext',
};

function fieldLabel(field: string): string {
  if (field.startsWith('translation:')) {
    const lang = field.split(':')[1];
    return `Překlad (${lang})`;
  }
  return FIELD_LABEL[field] ?? field;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'právě teď';
  if (minutes < 60) return `před ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `před ${hours} h`;
  const days = Math.floor(hours / 24);
  return `před ${days} dny`;
}

interface VersionHistoryProps {
  documentId: string;
  onRestore?: (field: string, content: string) => void;
}

export function VersionHistory({ documentId, onRestore }: VersionHistoryProps): React.JSX.Element {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/versions`);
      if (res.ok) {
        setVersions((await res.json()) as Version[]);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="py-4 text-center text-xs text-slate-400">Načítám historii…</p>;
  }

  if (versions.length === 0) {
    return <p className="py-4 text-center text-xs text-slate-400">Žádná historie verzí.</p>;
  }

  // Group by field
  const fields = [...new Set(versions.map((v) => v.field))];

  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const fieldVersions = versions.filter((v) => v.field === field);
        return (
          <div key={field}>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              {fieldLabel(field)}
            </h4>
            <div className="space-y-1">
              {fieldVersions.map((v) => {
                const isExpanded = expandedId === v.id;
                return (
                  <div key={v.id} className="rounded border border-slate-100 bg-white">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : v.id)}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-slate-50"
                    >
                      <span className="font-mono text-slate-300">v{v.version}</span>
                      <span
                        className={[
                          'rounded px-1.5 py-0.5 text-[10px] font-medium',
                          v.source.startsWith('ai')
                            ? 'bg-blue-50 text-blue-600'
                            : 'bg-amber-50 text-amber-600',
                        ].join(' ')}
                      >
                        {SOURCE_LABEL[v.source] ?? v.source}
                      </span>
                      {v.model && <span className="text-[10px] text-slate-300">{v.model}</span>}
                      <span className="ml-auto text-slate-400">{timeAgo(v.createdAt)}</span>
                      <svg
                        className={`h-3 w-3 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="m19.5 8.25-7.5 7.5-7.5-7.5"
                        />
                      </svg>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-slate-100">
                        <div className="max-h-60 overflow-y-auto p-3">
                          <div className="prose prose-stone prose-xs max-w-none">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{v.content}</ReactMarkdown>
                          </div>
                        </div>
                        {onRestore && (
                          <div className="border-t border-slate-100 px-3 py-2">
                            <button
                              onClick={() => onRestore(v.field, v.content)}
                              className="rounded bg-slate-800 px-2.5 py-1 text-xs text-white hover:bg-slate-700"
                            >
                              Obnovit tuto verzi
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
