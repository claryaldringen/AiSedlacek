'use client';

import React, { useState, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor';
import { VersionHistory } from './VersionHistory';
import { computeCostRaw, formatCost, TOKEN_MULTIPLIER } from '@/lib/pricing';
import { apiFetch } from '@/lib/infrastructure/api-client';

export interface DocumentResult {
  id: string;
  transcription: string;
  detectedLanguage: string;
  translation: string;
  translationLanguage: string;
  context: string;
  glossary: { term: string; definition: string }[];
  cached: boolean;
  // Processing metadata
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  processingTimeMs?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  // Page metadata (passed through)
  hash?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  pageCreatedAt?: string | null;
  // Translation metadata
  translationModel?: string | null;
  translationInputTokens?: number | null;
  translationOutputTokens?: number | null;
  // Chat accumulated cost
  chatInputTokens?: number;
  chatOutputTokens?: number;
  chatModel?: string;
}

interface ResultViewerProps {
  result: DocumentResult;
  onUpdate?: (updated: DocumentResult) => void;
  highlightQuery?: string;
}

function processChildren(
  children: React.ReactNode,
  transform: (text: string) => React.ReactNode,
): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') return transform(child);
    return child;
  });
}

function HighlightedMarkdown({ content, query }: { content: string; query?: string }): React.JSX.Element {
  if (!query || query.length < 2) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');

  const highlightText = (text: string): React.ReactNode => {
    const parts = text.split(regex);
    if (parts.length <= 1) return text;
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i} className="bg-yellow-200 rounded px-0.5">{part}</mark> : part
    );
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children, ...props }) => <p {...props}>{processChildren(children, highlightText)}</p>,
        li: ({ children, ...props }) => <li {...props}>{processChildren(children, highlightText)}</li>,
        td: ({ children, ...props }) => <td {...props}>{processChildren(children, highlightText)}</td>,
        th: ({ children, ...props }) => <th {...props}>{processChildren(children, highlightText)}</th>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function EditableSection({
  title,
  subtitle,
  content,
  onSave,
  saving,
  highlightQuery,
}: {
  title: string;
  subtitle?: string;
  content: string;
  onSave: (newContent: string) => void;
  saving?: boolean;
  highlightQuery?: string;
}): React.JSX.Element {
  const tc = useTranslations('common');
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [draft, setDraft] = useState('');

  const handleEdit = useCallback((): void => {
    setDraft(content);
    setEditing(true);
  }, [content]);

  const handleSave = useCallback((): void => {
    const md = editorRef.current?.getMarkdown() ?? draft;
    onSave(md);
    setEditing(false);
  }, [draft, onSave]);

  const handleCancel = useCallback((): void => {
    setEditing(false);
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-4 py-2">
        <div>
          <h2 className="text-sm font-semibold text-stone-700">{title}</h2>
          {subtitle && <p className="text-xs text-stone-400">{subtitle}</p>}
        </div>
        {!editing ? (
          <button
            onClick={handleEdit}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          >
            {tc('edit')}
          </button>
        ) : (
          <div className="flex gap-1">
            <button
              onClick={handleCancel}
              className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              {tc('cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? tc('saving') : tc('save')}
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="p-2">
          <MarkdownEditor ref={editorRef} initialValue={content} onChange={setDraft} />
        </div>
      ) : (
        <div className="prose prose-stone prose-sm max-w-none p-4">
          <HighlightedMarkdown content={content} query={highlightQuery} />
        </div>
      )}
    </div>
  );
}

export function ResultViewer({ result, onUpdate, highlightQuery }: ResultViewerProps): React.JSX.Element {
  const t = useTranslations('document');
  const [saving, setSaving] = useState(false);
  const [retranslating, setRetranslating] = useState(false);

  const saveField = useCallback(
    async (field: string, value: string): Promise<DocumentResult> => {
      setSaving(true);
      try {
        const body: Record<string, string> = { [field]: value };
        if (field === 'translation') {
          body.translationLanguage = result.translationLanguage;
        }
        await apiFetch(`/api/documents/${result.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const updated = { ...result, [field]: value };
        onUpdate?.(updated);
        return updated;
      } finally {
        setSaving(false);
      }
    },
    [result, onUpdate],
  );

  const handleTranscriptionSave = useCallback(
    async (newText: string): Promise<void> => {
      const updated = await saveField('transcription', newText);

      // Re-translate based on updated transcription via worker job
      setRetranslating(true);
      try {
        const res = await apiFetch(`/api/documents/${result.id}/retranslate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            language: result.translationLanguage,
            previousTranslation: result.translation,
          }),
        });
        if (!res.ok) {
          setRetranslating(false);
          return;
        }
        const { jobId } = (await res.json()) as { jobId: string };

        // Poll for job completion
        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await apiFetch(`/api/pages/process/status?jobId=${jobId}`);
            if (!statusRes.ok) {
              clearInterval(pollInterval);
              setRetranslating(false);
              return;
            }
            const statusData = (await statusRes.json()) as {
              status: string;
              currentStep?: string;
            };
            if (
              statusData.status === 'completed' ||
              statusData.status === 'error' ||
              statusData.status === 'cancelled'
            ) {
              clearInterval(pollInterval);
              setRetranslating(false);
              if (statusData.status === 'completed') {
                // Reload the document to get the new translation
                const docRes = await apiFetch(`/api/documents/${result.id}`);
                if (docRes.ok) {
                  const doc = (await docRes.json()) as {
                    translations: {
                      language: string;
                      text: string;
                      model?: string;
                      inputTokens?: number;
                      outputTokens?: number;
                    }[];
                  };
                  const translation = doc.translations.find(
                    (t: { language: string }) => t.language === result.translationLanguage,
                  );
                  if (translation) {
                    onUpdate?.({
                      ...updated,
                      translation: translation.text,
                      translationModel: translation.model,
                      translationInputTokens: translation.inputTokens,
                      translationOutputTokens: translation.outputTokens,
                    });
                  }
                }
              }
            }
          } catch {
            clearInterval(pollInterval);
            setRetranslating(false);
          }
        }, 2000);
      } catch {
        setRetranslating(false);
      }
    },
    [result, onUpdate, saveField],
  );

  return (
    <div className="flex flex-col">
      {retranslating && (
        <div className="overflow-hidden border-b border-blue-200 bg-blue-50">
          <div className="flex items-center gap-2 px-4 py-2 text-sm text-blue-700">
            <svg className="h-4 w-4 shrink-0 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            {t('translationUpdatingFromTranscription')}
          </div>
          <div className="h-1 bg-blue-200">
            <div
              className="h-full w-2/5 rounded-full bg-blue-600"
              style={{ animation: 'indeterminate 1.5s ease-in-out infinite' }}
            />
          </div>
        </div>
      )}

      {/* Row 1: Transcription | Translation */}
      <div className="grid flex-1 grid-cols-2 divide-x divide-slate-200">
        <div className="flex flex-col">
          <EditableSection
            title={t('transcription')}
            subtitle={t('originalLanguage', { lang: result.detectedLanguage })}
            content={result.transcription}
            onSave={(text) => void handleTranscriptionSave(text)}
            saving={saving}
            highlightQuery={highlightQuery}
          />
        </div>
        <div className="flex flex-col">
          <EditableSection
            title={t('translation')}
            subtitle={`${t('translationLanguage', { lang: result.translationLanguage })}${retranslating ? ' ' + t('translationUpdating') : ''}`}
            content={result.translation}
            onSave={(text) => void saveField('translation', text)}
            saving={saving}
            highlightQuery={highlightQuery}
          />
        </div>
      </div>

      {/* Row 2: Glossary | Context */}
      <div className="grid grid-cols-2 divide-x divide-slate-200 border-t border-slate-200">
        <div className="flex flex-col">
          {result.glossary.length > 0 ? (
            <div>
              <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
                <h2 className="text-sm font-semibold text-stone-700">{t('glossary')}</h2>
              </div>
              <div className="p-4">
                <dl className="space-y-2">
                  {result.glossary.map((entry, i) => (
                    <div key={i}>
                      <dt className="text-sm font-semibold text-stone-800">{entry.term}</dt>
                      <dd className="mt-0.5 text-sm text-stone-600">{entry.definition}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          ) : (
            <div>
              <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
                <h2 className="text-sm font-semibold text-stone-700">{t('glossary')}</h2>
              </div>
              <div className="p-4 text-sm text-slate-400">{t('noTerms')}</div>
            </div>
          )}
        </div>
        <div className="flex flex-col">
          <EditableSection
            title={t('context')}
            content={result.context || ''}
            onSave={(text) => void saveField('context', text)}
            saving={saving}
          />
        </div>
      </div>

      {/* Row 3: Metadata | Version history */}
      <div className="grid grid-cols-2 divide-x divide-slate-200 border-t border-slate-200">
        {/* Metadata */}
        <div>
          <details>
            <summary className="cursor-pointer border-b border-stone-200 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">
              {t('metadata')}
            </summary>
            <div className="divide-y divide-stone-100 text-sm">
              <MetadataGroup title={t('processingSection')}>
                <MetadataRow label="Model" value={result.model} />
                <MetadataRow
                  label={t('tokens')}
                  value={
                    result.inputTokens != null || result.outputTokens != null
                      ? t('tokensInOut', {
                          in: (result.inputTokens ?? 0) * TOKEN_MULTIPLIER,
                          out: (result.outputTokens ?? 0) * TOKEN_MULTIPLIER,
                        })
                      : null
                  }
                />
                <MetadataRow
                  label={t('processingTime')}
                  value={
                    result.processingTimeMs != null ? formatDuration(result.processingTimeMs) : null
                  }
                />
                <MetadataRow
                  label={t('totalPrice')}
                  value={formatCost(result.model, result.inputTokens, result.outputTokens)}
                />
                <MetadataRow
                  label={t('createdAt')}
                  value={result.createdAt ? formatDate(result.createdAt) : null}
                />
                <MetadataRow
                  label={t('updatedAt')}
                  value={result.updatedAt ? formatDate(result.updatedAt) : null}
                />
              </MetadataGroup>

              {(result.translationModel || result.translationInputTokens != null) && (
                <MetadataGroup title={t('translationSection')}>
                  <MetadataRow label="Model" value={result.translationModel} />
                  <MetadataRow
                    label={t('tokens')}
                    value={
                      result.translationInputTokens != null ||
                      result.translationOutputTokens != null
                        ? t('tokensInOut', {
                            in: (result.translationInputTokens ?? 0) * TOKEN_MULTIPLIER,
                            out: (result.translationOutputTokens ?? 0) * TOKEN_MULTIPLIER,
                          })
                        : null
                    }
                  />
                  <MetadataRow
                    label={t('totalPrice')}
                    value={formatCost(
                      result.translationModel,
                      result.translationInputTokens,
                      result.translationOutputTokens,
                    )}
                  />
                </MetadataGroup>
              )}

              {(result.chatInputTokens ?? 0) > 0 && (
                <MetadataGroup title={t('chat')}>
                  <MetadataRow label="Model" value={result.chatModel} />
                  <MetadataRow
                    label={t('tokens')}
                    value={t('tokensInOut', {
                      in: (result.chatInputTokens ?? 0) * TOKEN_MULTIPLIER,
                      out: (result.chatOutputTokens ?? 0) * TOKEN_MULTIPLIER,
                    })}
                  />
                  <MetadataRow
                    label={t('totalPrice')}
                    value={formatCost(
                      result.chatModel,
                      result.chatInputTokens,
                      result.chatOutputTokens,
                    )}
                  />
                </MetadataGroup>
              )}

              {(() => {
                const processCost = computeCostRaw(
                  result.model,
                  result.inputTokens,
                  result.outputTokens,
                );
                const translationCost = computeCostRaw(
                  result.translationModel,
                  result.translationInputTokens,
                  result.translationOutputTokens,
                );
                const chatCost = computeCostRaw(
                  result.chatModel,
                  result.chatInputTokens,
                  result.chatOutputTokens,
                );
                const total = processCost + translationCost + chatCost;
                return total > 0 ? (
                  <MetadataGroup title={t('grandTotal')}>
                    <MetadataRow
                      label={t('totalGrandPrice')}
                      value={total < 0.01 ? `$${total.toFixed(4)}` : `$${total.toFixed(3)}`}
                    />
                  </MetadataGroup>
                ) : null;
              })()}

              {(result.mimeType || result.width || result.hash) && (
                <MetadataGroup title={t('imageSection')}>
                  <MetadataRow label={t('format')} value={result.mimeType} />
                  <MetadataRow
                    label={t('dimensions')}
                    value={
                      result.width && result.height ? `${result.width} × ${result.height} px` : null
                    }
                  />
                  <MetadataRow
                    label={t('fileSize')}
                    value={result.fileSize != null ? formatFileSize(result.fileSize) : null}
                  />
                  <MetadataRow
                    label={t('uploadedAt')}
                    value={result.pageCreatedAt ? formatDate(result.pageCreatedAt) : null}
                  />
                  <MetadataRow label={t('sha256')} value={result.hash} mono />
                </MetadataGroup>
              )}
            </div>
          </details>
        </div>

        {/* Version history */}
        <div>
          <details>
            <summary className="cursor-pointer border-b border-stone-200 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">
              {t('versionHistory')}
            </summary>
            <div className="p-4">
              <VersionHistory
                documentId={result.id}
                onRestore={(field, content) => {
                  if (field === 'transcription') {
                    void handleTranscriptionSave(content);
                  } else if (field.startsWith('translation:')) {
                    void saveField('translation', content);
                  } else if (field === 'context') {
                    void saveField('context', content);
                  }
                }}
              />
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function MetadataGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
        {title}
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">{children}</dl>
    </div>
  );
}

function MetadataRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number | null | undefined;
  mono?: boolean;
}): React.JSX.Element | null {
  if (value == null || value === '') return null;
  return (
    <>
      <dt className="text-stone-500">{label}</dt>
      <dd className={`text-stone-800 ${mono ? 'truncate font-mono text-xs leading-5' : ''}`}>
        {value}
      </dd>
    </>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return `${m} min ${rest} s`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
