'use client';

import { useState, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor';
import { VersionHistory } from './VersionHistory';

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
}

function EditableSection({
  title,
  subtitle,
  content,
  onSave,
  saving,
}: {
  title: string;
  subtitle?: string;
  content: string;
  onSave: (newContent: string) => void;
  saving?: boolean;
}): React.JSX.Element {
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
    <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
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
            Upravit
          </button>
        ) : (
          <div className="flex gap-1">
            <button
              onClick={handleCancel}
              className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              Zrušit
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? 'Ukládám…' : 'Uložit'}
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="p-2">
          <MarkdownEditor
            ref={editorRef}
            initialValue={content}
            onChange={setDraft}
          />
        </div>
      ) : (
        <div className="prose prose-stone prose-sm max-w-none p-6">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  );
}

export function ResultViewer({ result, onUpdate }: ResultViewerProps): React.JSX.Element {
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
        await fetch(`/api/documents/${result.id}`, {
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

      // Re-translate based on updated transcription
      setRetranslating(true);
      try {
        const res = await fetch(`/api/documents/${result.id}/retranslate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            language: result.translationLanguage,
            previousTranslation: result.translation,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { translation: string };
          onUpdate?.({ ...updated, translation: data.translation });
        }
      } finally {
        setRetranslating(false);
      }
    },
    [result, onUpdate, saveField],
  );

  return (
    <div className="space-y-6">
      {retranslating && (
        <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700">
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Překlad se aktualizuje na základě upravené transkripce…
        </div>
      )}

      <EditableSection
        title="Transkripce"
        subtitle={`Jazyk originálu: ${result.detectedLanguage}`}
        content={result.transcription}
        onSave={(text) => void handleTranscriptionSave(text)}
        saving={saving}
      />

      <EditableSection
        title="Překlad"
        subtitle={`Jazyk: ${result.translationLanguage}${retranslating ? ' (aktualizuje se…)' : ''}`}
        content={result.translation}
        onSave={(text) => void saveField('translation', text)}
        saving={saving}
      />

      {result.context && (
        <EditableSection
          title="Kontext"
          content={result.context}
          onSave={(text) => void saveField('context', text)}
          saving={saving}
        />
      )}

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

      {/* Version history */}
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
        <details>
          <summary className="cursor-pointer border-b border-stone-200 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">
            Historie verzí
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

      {/* Metadata */}
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
        <details>
          <summary className="cursor-pointer border-b border-stone-200 bg-stone-50 px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">
            Metadata
          </summary>
          <div className="divide-y divide-stone-100 text-sm">
            {/* Document processing */}
            <MetadataGroup title="Zpracování">
              <MetadataRow label="Model" value={result.model} />
              <MetadataRow
                label="Tokeny"
                value={
                  result.inputTokens != null || result.outputTokens != null
                    ? `${result.inputTokens ?? '?'} vstup / ${result.outputTokens ?? '?'} výstup`
                    : null
                }
              />
              <MetadataRow
                label="Čas zpracování"
                value={result.processingTimeMs != null ? formatDuration(result.processingTimeMs) : null}
              />
              <MetadataRow
                label="Cena"
                value={formatCost(result.model, result.inputTokens, result.outputTokens)}
              />
              <MetadataRow label="Vytvořeno" value={result.createdAt ? formatDate(result.createdAt) : null} />
              <MetadataRow label="Upraveno" value={result.updatedAt ? formatDate(result.updatedAt) : null} />
            </MetadataGroup>

            {/* Translation */}
            {(result.translationModel || result.translationInputTokens != null) && (
              <MetadataGroup title="Překlad">
                <MetadataRow label="Model" value={result.translationModel} />
                <MetadataRow
                  label="Tokeny"
                  value={
                    result.translationInputTokens != null || result.translationOutputTokens != null
                      ? `${result.translationInputTokens ?? '?'} vstup / ${result.translationOutputTokens ?? '?'} výstup`
                      : null
                  }
                />
                <MetadataRow
                  label="Cena"
                  value={formatCost(result.translationModel, result.translationInputTokens, result.translationOutputTokens)}
                />
              </MetadataGroup>
            )}

            {/* Chat */}
            {(result.chatInputTokens ?? 0) > 0 && (
              <MetadataGroup title="Chat">
                <MetadataRow label="Model" value={result.chatModel} />
                <MetadataRow
                  label="Tokeny"
                  value={`${result.chatInputTokens ?? 0} vstup / ${result.chatOutputTokens ?? 0} výstup`}
                />
                <MetadataRow
                  label="Cena"
                  value={formatCost(result.chatModel, result.chatInputTokens, result.chatOutputTokens)}
                />
              </MetadataGroup>
            )}

            {/* Total cost */}
            {(() => {
              const processCost = computeCostRaw(result.model, result.inputTokens, result.outputTokens);
              const translationCost = computeCostRaw(result.translationModel, result.translationInputTokens, result.translationOutputTokens);
              const chatCost = computeCostRaw(result.chatModel, result.chatInputTokens, result.chatOutputTokens);
              const total = processCost + translationCost + chatCost;
              return total > 0 ? (
                <MetadataGroup title="Celkem">
                  <MetadataRow label="Celková cena" value={total < 0.01 ? `$${total.toFixed(4)}` : `$${total.toFixed(3)}`} />
                </MetadataGroup>
              ) : null;
            })()}

            {/* Image / Page */}
            {(result.mimeType || result.width || result.hash) && (
              <MetadataGroup title="Obrázek">
                <MetadataRow label="Formát" value={result.mimeType} />
                <MetadataRow
                  label="Rozměry"
                  value={result.width && result.height ? `${result.width} × ${result.height} px` : null}
                />
                <MetadataRow
                  label="Velikost"
                  value={result.fileSize != null ? formatFileSize(result.fileSize) : null}
                />
                <MetadataRow label="Nahráno" value={result.pageCreatedAt ? formatDate(result.pageCreatedAt) : null} />
                <MetadataRow label="SHA-256" value={result.hash} mono />
              </MetadataGroup>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

function MetadataGroup({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="px-4 py-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">{title}</h3>
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
      <dd className={`text-stone-800 ${mono ? 'truncate font-mono text-xs leading-5' : ''}`}>{value}</dd>
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

// Pricing per million tokens (USD), May 2025
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
};

function computeCostRaw(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): number {
  if (!model || inputTokens == null || outputTokens == null) return 0;
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

function formatCost(
  model: string | null | undefined,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): string | null {
  const cost = computeCostRaw(model, inputTokens, outputTokens);
  if (cost === 0) return null;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
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
