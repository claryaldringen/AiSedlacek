'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ProposedUpdate {
  field: 'transcription' | 'translation' | 'context';
  content: string;
  applied: boolean;
}

export interface ChatTokenUsage {
  inputTokens: number;
  outputTokens: number;
  model: string;
}

interface DocumentChatProps {
  documentId: string;
  currentFields: { transcription: string; translation: string; context: string };
  onApplyUpdate: (field: string, content: string) => void;
  onTokenUsage?: (usage: ChatTokenUsage) => void;
}

function parseUpdates(text: string): { cleanText: string; updates: ProposedUpdate[] } {
  const updates: ProposedUpdate[] = [];
  const cleanText = text.replace(
    /<update field="(transcription|translation|context)">\n?([\s\S]*?)\n?<\/update>/g,
    (_match, field: string, content: string) => {
      updates.push({ field: field as ProposedUpdate['field'], content: content.trim(), applied: false });
      return `%%UPDATE_${updates.length - 1}%%`;
    },
  );
  return { cleanText, updates };
}

const FIELD_LABELS: Record<string, string> = {
  transcription: 'Transkripce',
  translation: 'Překlad',
  context: 'Kontext',
};

// Simple word-level diff
interface DiffSegment {
  type: 'equal' | 'added' | 'removed';
  text: string;
}

function computeWordDiff(oldText: string, newText: string): DiffSegment[] {
  const oldWords = oldText.split(/(\s+)/);
  const newWords = newText.split(/(\s+)/);

  // Simple LCS-based diff for reasonable-sized texts
  const m = oldWords.length;
  const n = newWords.length;

  // For very long texts, fall back to line-level diff
  if (m * n > 500_000) {
    return computeLineDiff(oldText, newText);
  }

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack
  const segments: DiffSegment[] = [];
  let i = m;
  let j = n;
  const result: DiffSegment[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      result.push({ type: 'equal', text: oldWords[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      result.push({ type: 'added', text: newWords[j - 1]! });
      j--;
    } else {
      result.push({ type: 'removed', text: oldWords[i - 1]! });
      i--;
    }
  }

  result.reverse();

  // Merge adjacent segments of same type
  for (const seg of result) {
    const last = segments[segments.length - 1];
    if (last && last.type === seg.type) {
      last.text += seg.text;
    } else {
      segments.push({ ...seg });
    }
  }

  return segments;
}

function computeLineDiff(oldText: string, newText: string): DiffSegment[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const segments: DiffSegment[] = [];

  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);

  // Simple: show removed lines, then added lines, then equal
  // This is a rough approximation for very long texts
  let oi = 0;
  let ni = 0;
  while (oi < oldLines.length || ni < newLines.length) {
    if (oi < oldLines.length && ni < newLines.length && oldLines[oi] === newLines[ni]) {
      segments.push({ type: 'equal', text: oldLines[oi]! + '\n' });
      oi++;
      ni++;
    } else if (oi < oldLines.length && !newSet.has(oldLines[oi]!)) {
      segments.push({ type: 'removed', text: oldLines[oi]! + '\n' });
      oi++;
    } else if (ni < newLines.length && !oldSet.has(newLines[ni]!)) {
      segments.push({ type: 'added', text: newLines[ni]! + '\n' });
      ni++;
    } else {
      // Both present somewhere — advance the one that's "behind"
      if (oi < oldLines.length) {
        segments.push({ type: 'removed', text: oldLines[oi]! + '\n' });
        oi++;
      }
      if (ni < newLines.length) {
        segments.push({ type: 'added', text: newLines[ni]! + '\n' });
        ni++;
      }
    }
  }
  return segments;
}

export function DocumentChat({ documentId, currentFields, onApplyUpdate, onTokenUsage }: DocumentChatProps): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [appliedUpdates, setAppliedUpdates] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback((): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    setMessages([]);
    setInput('');
    setAppliedUpdates(new Set());
  }, [documentId]);

  const handleSend = useCallback(async (): Promise<void> => {
    const text = input.trim();
    if (!text || streaming) return;

    const userMessage: ChatMessage = { role: 'user', content: text };
    const allMessages = [...messages, userMessage];
    setMessages(allMessages);
    setInput('');
    setStreaming(true);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const res = await fetch(`/api/documents/${documentId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: allMessages }),
        signal: abortController.signal,
      });

      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Chyba serveru');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Chybí response stream');

      const decoder = new TextDecoder();
      let assistantText = '';

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6)) as {
            type: string;
            text?: string;
            error?: string;
            usage?: { inputTokens: number; outputTokens: number; model: string };
          };

          if (data.type === 'text' && data.text) {
            assistantText += data.text;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: assistantText };
              return updated;
            });
          } else if (data.type === 'done' && data.usage) {
            onTokenUsage?.(data.usage);
          } else if (data.type === 'error') {
            throw new Error(data.error ?? 'Neznámá chyba');
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const errorMessage = err instanceof Error ? err.message : 'Neznámá chyba';
      setMessages((prev) => [
        ...prev.filter((m) => m.content !== ''),
        { role: 'assistant', content: `Chyba: ${errorMessage}` },
      ]);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, messages, documentId, streaming, onTokenUsage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleApplyUpdate = useCallback(
    (msgIndex: number, updateIndex: number, field: string, content: string): void => {
      const key = `${msgIndex}-${updateIndex}`;
      if (appliedUpdates.has(key)) return;
      onApplyUpdate(field, content);
      setAppliedUpdates((prev) => new Set(prev).add(key));
    },
    [onApplyUpdate, appliedUpdates],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-stone-400">Zeptejte se na cokoliv o tomto dokumentu</p>
              <p className="mt-1 text-xs text-stone-300">
                Model vidí obrázek, transkripci, překlad i glosář
              </p>
            </div>
          </div>
        )}
        <div className="space-y-4">
          {messages.map((msg, msgIndex) => (
            <MessageBubble
              key={msgIndex}
              message={msg}
              msgIndex={msgIndex}
              appliedUpdates={appliedUpdates}
              onApplyUpdate={handleApplyUpdate}
              currentFields={currentFields}
              streaming={streaming && msgIndex === messages.length - 1 && msg.role === 'assistant'}
            />
          ))}
        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-stone-200 bg-white p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Napište zprávu… (Enter = odeslat, Shift+Enter = nový řádek)"
            rows={2}
            className="flex-1 resize-none rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            disabled={streaming}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || streaming}
            className="self-end rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-40"
          >
            {streaming ? (
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  msgIndex,
  appliedUpdates,
  onApplyUpdate,
  currentFields,
  streaming,
}: {
  message: ChatMessage;
  msgIndex: number;
  appliedUpdates: Set<string>;
  onApplyUpdate: (msgIndex: number, updateIndex: number, field: string, content: string) => void;
  currentFields: { transcription: string; translation: string; context: string };
  streaming: boolean;
}): React.JSX.Element {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-slate-800 px-4 py-2.5 text-sm text-white">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  const { cleanText, updates } = parseUpdates(message.content);
  const parts = cleanText.split(/(%%UPDATE_\d+%%)/);

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-2">
        {parts.map((part, i) => {
          const updateMatch = part.match(/^%%UPDATE_(\d+)%%$/);
          if (updateMatch) {
            const updateIdx = parseInt(updateMatch[1]!, 10);
            const update = updates[updateIdx];
            if (!update) return null;
            const key = `${msgIndex}-${updateIdx}`;
            const isApplied = appliedUpdates.has(key);
            const original = currentFields[update.field] ?? '';
            const diff = original ? computeWordDiff(original, update.content) : null;
            const hasChanges = diff ? diff.some((s) => s.type !== 'equal') : true;

            return (
              <div
                key={i}
                className={`rounded-lg border p-3 ${isApplied ? 'border-green-200 bg-green-50' : 'border-blue-200 bg-blue-50'}`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-stone-500">
                    Navrhovaná úprava: {FIELD_LABELS[update.field] ?? update.field}
                  </span>
                  <button
                    onClick={() => onApplyUpdate(msgIndex, updateIdx, update.field, update.content)}
                    disabled={isApplied}
                    className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                      isApplied
                        ? 'bg-green-100 text-green-700'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {isApplied ? 'Použito' : 'Použít'}
                  </button>
                </div>
                {diff && hasChanges ? (
                  <div className="max-h-80 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
                    {diff.map((seg, si) =>
                      seg.type === 'equal' ? (
                        <span key={si}>{seg.text}</span>
                      ) : seg.type === 'added' ? (
                        <span key={si} className="bg-green-200 text-green-900">{seg.text}</span>
                      ) : (
                        <span key={si} className="bg-red-200 text-red-800 line-through">{seg.text}</span>
                      ),
                    )}
                  </div>
                ) : (
                  <div className="prose prose-sm prose-stone max-w-none text-sm">
                    <ReactMarkdown>{update.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            );
          }

          const trimmed = part.trim();
          if (!trimmed) return null;

          return (
            <div key={i} className="rounded-lg bg-stone-100 px-4 py-2.5 text-sm text-stone-800">
              <div className="prose prose-sm prose-stone max-w-none">
                <ReactMarkdown>{trimmed}</ReactMarkdown>
              </div>
              {streaming && i === parts.length - 1 && (
                <span className="inline-block h-4 w-1 animate-pulse bg-stone-400" />
              )}
            </div>
          );
        })}
        {streaming && message.content === '' && (
          <div className="rounded-lg bg-stone-100 px-4 py-2.5">
            <span className="inline-block h-4 w-1 animate-pulse bg-stone-400" />
          </div>
        )}
      </div>
    </div>
  );
}
