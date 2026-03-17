'use client';

import { useState, forwardRef, useImperativeHandle } from 'react';

export interface MarkdownEditorHandle {
  getMarkdown: () => string;
}

interface MarkdownEditorProps {
  initialValue: string;
  onChange?: (value: string) => void;
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ initialValue, onChange }, ref) {
    const [value, setValue] = useState(initialValue);

    useImperativeHandle(ref, () => ({
      getMarkdown: () => value,
    }));

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
      setValue(e.target.value);
      onChange?.(e.target.value);
    };

    const wrapSelection = (before: string, after: string): void => {
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-md-editor]');
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selected = value.slice(start, end);
      const newValue = value.slice(0, start) + before + selected + after + value.slice(end);
      setValue(newValue);
      onChange?.(newValue);

      // Restore cursor position
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = start + before.length;
        textarea.selectionEnd = end + before.length;
      });
    };

    const insertAtLineStart = (prefix: string): void => {
      const textarea = document.querySelector<HTMLTextAreaElement>('[data-md-editor]');
      if (!textarea) return;

      const start = textarea.selectionStart;
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const newValue = value.slice(0, lineStart) + prefix + value.slice(lineStart);
      setValue(newValue);
      onChange?.(newValue);

      requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = start + prefix.length;
        textarea.selectionEnd = start + prefix.length;
      });
    };

    return (
      <div className="overflow-hidden rounded border border-slate-200">
        {/* Toolbar */}
        <div className="flex gap-0.5 border-b border-slate-200 bg-slate-50 px-2 py-1">
          <button
            type="button"
            onClick={() => wrapSelection('**', '**')}
            className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200"
            title="Tučné (Ctrl+B)"
          >
            B
          </button>
          <button
            type="button"
            onClick={() => wrapSelection('*', '*')}
            className="rounded px-2 py-1 text-xs italic text-slate-600 hover:bg-slate-200"
            title="Kurzíva (Ctrl+I)"
          >
            I
          </button>
          <div className="mx-1 w-px bg-slate-200" />
          <button
            type="button"
            onClick={() => insertAtLineStart('# ')}
            className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200"
            title="Nadpis 1"
          >
            H1
          </button>
          <button
            type="button"
            onClick={() => insertAtLineStart('## ')}
            className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200"
            title="Nadpis 2"
          >
            H2
          </button>
          <button
            type="button"
            onClick={() => insertAtLineStart('### ')}
            className="rounded px-2 py-1 text-xs font-bold text-slate-600 hover:bg-slate-200"
            title="Nadpis 3"
          >
            H3
          </button>
          <div className="mx-1 w-px bg-slate-200" />
          <button
            type="button"
            onClick={() => insertAtLineStart('- ')}
            className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200"
            title="Odrážka"
          >
            • List
          </button>
          <button
            type="button"
            onClick={() => insertAtLineStart('> ')}
            className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-200"
            title="Citace"
          >
            ❝ Quote
          </button>
        </div>

        {/* Textarea */}
        <textarea
          data-md-editor
          value={value}
          onChange={handleChange}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
              e.preventDefault();
              wrapSelection('**', '**');
            } else if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
              e.preventDefault();
              wrapSelection('*', '*');
            }
          }}
          className="block w-full resize-y bg-white p-4 font-mono text-sm leading-relaxed text-stone-800 focus:outline-none"
          rows={Math.max(12, initialValue.split('\n').length + 3)}
          spellCheck={false}
        />
      </div>
    );
  },
);
