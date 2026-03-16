'use client';

import { useState, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { MarkdownEditor, type MarkdownEditorHandle } from './MarkdownEditor';

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
          body: JSON.stringify({ language: result.translationLanguage }),
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
    </div>
  );
}
