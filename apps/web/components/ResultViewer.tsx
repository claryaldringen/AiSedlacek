'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor';
import { VersionHistory } from './VersionHistory';
import { chargeForUsage, formatCzk } from '@/lib/pricing';
import { apiFetch, apiFetchOk, ApiError } from '@/lib/infrastructure/api-client';

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
  /** Cizí dokument – bez editace textů a obnovy verzí (historie zůstane k prohlížení). */
  readOnly?: boolean;
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

function HighlightedMarkdown({
  content,
  query,
}: {
  content: string;
  query?: string;
}): React.JSX.Element {
  if (!query || query.length < 2) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');

  const highlightText = (text: string): React.ReactNode => {
    const parts = text.split(regex);
    if (parts.length <= 1) return text;
    return parts.map((part, i) =>
      regex.test(part) ? (
        <mark key={i} className="bg-yellow-200 rounded px-0.5">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children, ...props }) => <p {...props}>{processChildren(children, highlightText)}</p>,
        li: ({ children, ...props }) => (
          <li {...props}>{processChildren(children, highlightText)}</li>
        ),
        td: ({ children, ...props }) => (
          <td {...props}>{processChildren(children, highlightText)}</td>
        ),
        th: ({ children, ...props }) => (
          <th {...props}>{processChildren(children, highlightText)}</th>
        ),
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
  readOnly = false,
  lockedReason,
}: {
  title: string;
  subtitle?: string;
  content: string;
  /** Vrací true po úspěšném uložení – při chybě zůstane editor otevřený s rozepsaným textem. */
  onSave: (newContent: string) => Promise<boolean>;
  saving?: boolean;
  highlightQuery?: string;
  readOnly?: boolean;
  /**
   * Dočasný zámek (běžící retranslace) – úprava ani uložení nejdou, důvod se
   * ukáže v tooltipu a u otevřeného editoru i textem. Rozepsaný text zůstane.
   */
  lockedReason?: string;
}): React.JSX.Element {
  const tc = useTranslations('common');
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [draft, setDraft] = useState('');

  const handleEdit = useCallback((): void => {
    setDraft(content);
    setEditing(true);
  }, [content]);

  const handleSave = useCallback(async (): Promise<void> => {
    const md = editorRef.current?.getMarkdown() ?? draft;
    if (await onSave(md)) setEditing(false);
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
        {readOnly ? null : !editing ? (
          // Zakázané tlačítko nevyvolá tooltip – title nese obalující span.
          <span title={lockedReason}>
            <button
              onClick={handleEdit}
              disabled={Boolean(lockedReason)}
              className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {tc('edit')}
            </button>
          </span>
        ) : (
          <div className="flex gap-1">
            <button
              onClick={handleCancel}
              className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              {tc('cancel')}
            </button>
            <span title={lockedReason}>
              <button
                onClick={() => void handleSave()}
                disabled={saving || Boolean(lockedReason)}
                className="rounded bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? tc('saving') : tc('save')}
              </button>
            </span>
          </div>
        )}
      </div>
      {editing && !readOnly ? (
        <div className="p-2">
          {lockedReason && <p className="px-1 pb-2 text-xs text-amber-700">{lockedReason}</p>}
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

export function ResultViewer({
  result,
  onUpdate,
  highlightQuery,
  readOnly = false,
}: ResultViewerProps): React.JSX.Element {
  const t = useTranslations('document');
  const tc = useTranslations('common');
  const locale = useLocale();
  // Cena pro uživatele – stejný výpočet jako účtování kreditů.
  const formatCharge = (
    model: string | null | undefined,
    inputTokens: number | null | undefined,
    outputTokens: number | null | undefined,
  ): string | null => {
    const charge = chargeForUsage(model, inputTokens, outputTokens);
    return charge
      ? t('chargeValue', {
          czk: formatCzk(charge.czk, locale),
          credits: charge.credits.toLocaleString(locale),
        })
      : null;
  };
  const [saving, setSaving] = useState(false);
  const [retranslating, setRetranslating] = useState(false);
  // Během retranslace se texty needitují – ruční úprava překladu by se srazila
  // s výsledkem jobu (přepsal by ji) a nová transkripce by spustila další
  // souběžnou retranslaci.
  const retranslateLock = retranslating ? t('editLockedWhileRetranslating') : undefined;

  // Interval pro polling retranslace ukládáme do refu, aby šel uklidit.
  const retranslatePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Vždy aktuální id zobrazeného dokumentu — pro ověření, že doběhlý poll
  // patří k dokumentu, který je stále otevřený.
  const currentResultIdRef = useRef(result.id);
  currentResultIdRef.current = result.id;

  const stopRetranslatePoll = useCallback((): void => {
    if (retranslatePollRef.current) {
      clearInterval(retranslatePollRef.current);
      retranslatePollRef.current = null;
    }
  }, []);

  // Úklid pollu při přepnutí na jiný dokument i při unmountu — jinak by poll
  // po dokončení přepsal panel zobrazující už jiný dokument a leakoval.
  useEffect(() => {
    return () => stopRetranslatePoll();
  }, [result.id, stopRetranslatePoll]);

  // Chyba posledního uložení – bez ní se dřív editace při chybě serveru tvářila
  // jako uložená (apiFetch nevyhazuje na ne-2xx odpovědi, proto apiFetchOk).
  const [saveError, setSaveError] = useState<string | null>(null);
  // Neúspěšná retranslace (useknutý výstup, odmítnutí modelem, konflikt s ruční
  // úpravou, nedostatek kreditu) – bez hlášky by překlad tiše zůstal starý.
  const [retranslateError, setRetranslateError] = useState<string | null>(null);

  const saveField = useCallback(
    async (
      field: 'transcription' | 'translation' | 'context',
      value: string,
      translationLanguage: string = result.translationLanguage,
    ): Promise<DocumentResult> => {
      setSaving(true);
      setSaveError(null);
      try {
        const body: Record<string, string> = { [field]: value };
        if (field === 'translation') {
          body.translationLanguage = translationLanguage;
        }
        await apiFetchOk(`/api/documents/${result.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).catch((e: unknown) => {
          // Chyba serveru nese vlastní hlášku; síťová chyba (offline, abort) obecnou,
          // aby uživatel nepřišel o zpětnou vazbu, že se nic neuložilo.
          setSaveError(e instanceof ApiError ? e.message : tc('unknownError'));
          throw e;
        });
        // Překlad v jiném jazyce (obnova verze) nemění zobrazený překlad.
        if (field === 'translation' && translationLanguage !== result.translationLanguage) {
          return result;
        }
        const updated = { ...result, [field]: value };
        onUpdate?.(updated);
        return updated;
      } finally {
        setSaving(false);
      }
    },
    [result, onUpdate, tc],
  );

  const trySaveField = useCallback(
    async (
      field: 'transcription' | 'translation' | 'context',
      value: string,
      translationLanguage?: string,
    ): Promise<boolean> => {
      try {
        await saveField(field, value, translationLanguage);
        return true;
      } catch {
        return false;
      }
    },
    [saveField],
  );

  const handleTranscriptionSave = useCallback(
    async (newText: string): Promise<boolean> => {
      // Dokument, pro který tento poll běží — výsledek aplikujeme jen pokud
      // je při dokončení stále otevřený tentýž dokument.
      const docId = result.id;
      let updated: DocumentResult;
      try {
        updated = await saveField('transcription', newText);
      } catch {
        // Neuložená transkripce nesmí spustit (placenou) retranslaci.
        return false;
      }

      // Re-translate based on updated transcription via worker job
      setRetranslating(true);
      setRetranslateError(null);
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
          // Transkripce je uložená, jen překlad se nespustil (kredit, souběžný job).
          const data = (await res.json().catch(() => ({}))) as { error?: unknown };
          setRetranslateError(
            res.status === 402 || data.error === 'insufficient_tokens'
              ? t('retranslationInsufficientCredit')
              : typeof data.error === 'string'
                ? data.error
                : t('retranslationFailed'),
          );
          setRetranslating(false);
          return true;
        }
        const { jobId } = (await res.json()) as { jobId: string };

        // Poll for job completion — interval v refu, ať ho lze uklidit.
        stopRetranslatePoll();
        retranslatePollRef.current = setInterval(async () => {
          try {
            const statusRes = await apiFetch(`/api/pages/process/status?jobId=${jobId}`);
            if (!statusRes.ok) {
              stopRetranslatePoll();
              setRetranslating(false);
              return;
            }
            const statusData = (await statusRes.json()) as {
              status: string;
              currentStep?: string | null;
              errors?: string[];
            };
            if (
              statusData.status === 'completed' ||
              statusData.status === 'error' ||
              statusData.status === 'cancelled'
            ) {
              stopRetranslatePoll();
              setRetranslating(false);
              if (statusData.status === 'error' && currentResultIdRef.current === docId) {
                // Worker ukládá důvod do errors (poslední = tento běh), jinak obecná hláška.
                setRetranslateError(statusData.errors?.at(-1) || t('retranslationFailed'));
              }
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
                  // Aplikuj jen pokud je stále otevřený dokument, pro který poll běžel.
                  if (translation && currentResultIdRef.current === docId) {
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
            stopRetranslatePoll();
            setRetranslating(false);
          }
        }, 2000);
      } catch {
        setRetranslating(false);
      }
      return true;
    },
    [result, onUpdate, saveField, stopRetranslatePoll, t],
  );

  return (
    <div className="flex flex-col">
      {saveError && (
        <ErrorBanner
          message={`${t('savingFailed')}: ${saveError}`}
          onDismiss={() => setSaveError(null)}
        />
      )}
      {retranslateError && (
        <ErrorBanner message={retranslateError} onDismiss={() => setRetranslateError(null)} />
      )}
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
            onSave={handleTranscriptionSave}
            saving={saving}
            highlightQuery={highlightQuery}
            readOnly={readOnly}
            lockedReason={retranslateLock}
          />
        </div>
        <div className="flex flex-col">
          <EditableSection
            title={t('translation')}
            subtitle={`${t('translationLanguage', { lang: result.translationLanguage })}${retranslating ? ' ' + t('translationUpdating') : ''}`}
            content={result.translation}
            onSave={(text) => trySaveField('translation', text)}
            saving={saving}
            highlightQuery={highlightQuery}
            readOnly={readOnly}
            lockedReason={retranslateLock}
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
            onSave={(text) => trySaveField('context', text)}
            saving={saving}
            readOnly={readOnly}
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
                          in: (result.inputTokens ?? 0).toLocaleString(locale),
                          out: (result.outputTokens ?? 0).toLocaleString(locale),
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
                  value={formatCharge(result.model, result.inputTokens, result.outputTokens)}
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
                            in: (result.translationInputTokens ?? 0).toLocaleString(locale),
                            out: (result.translationOutputTokens ?? 0).toLocaleString(locale),
                          })
                        : null
                    }
                  />
                  <MetadataRow
                    label={t('totalPrice')}
                    value={formatCharge(
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
                      in: (result.chatInputTokens ?? 0).toLocaleString(locale),
                      out: (result.chatOutputTokens ?? 0).toLocaleString(locale),
                    })}
                  />
                  <MetadataRow
                    label={t('totalPrice')}
                    value={formatCharge(
                      result.chatModel,
                      result.chatInputTokens,
                      result.chatOutputTokens,
                    )}
                  />
                </MetadataGroup>
              )}

              {(() => {
                const charges = [
                  chargeForUsage(result.model, result.inputTokens, result.outputTokens),
                  chargeForUsage(
                    result.translationModel,
                    result.translationInputTokens,
                    result.translationOutputTokens,
                  ),
                  chargeForUsage(result.chatModel, result.chatInputTokens, result.chatOutputTokens),
                ];
                const czk = charges.reduce((sum, c) => sum + (c?.czk ?? 0), 0);
                const credits = charges.reduce((sum, c) => sum + (c?.credits ?? 0), 0);
                return credits > 0 ? (
                  <MetadataGroup title={t('grandTotal')}>
                    <MetadataRow
                      label={t('totalGrandPrice')}
                      value={t('chargeValue', {
                        czk: formatCzk(czk, locale),
                        credits: credits.toLocaleString(locale),
                      })}
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
                onRestore={
                  // Obnova překladu/transkripce by se během retranslace srazila s jobem.
                  readOnly || retranslating
                    ? undefined
                    : (field, content) => {
                        if (field === 'transcription') {
                          void handleTranscriptionSave(content);
                        } else if (field.startsWith('translation:')) {
                          // Verze nese jazyk v názvu pole – obnovit do něj, ne do zobrazeného.
                          void trySaveField(
                            'translation',
                            content,
                            field.slice('translation:'.length),
                          );
                        } else if (field === 'context') {
                          void trySaveField('context', content);
                        }
                      }
                }
              />
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
    >
      <span>{message}</span>
      <button
        onClick={onDismiss}
        className="rounded px-2 py-0.5 text-xs text-red-600 hover:bg-red-100"
        aria-label="×"
      >
        ×
      </button>
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
