'use client';

import dynamic from 'next/dynamic';
import { useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import type { MDXEditorMethods } from '@mdxeditor/editor';

// MDXEditor must be loaded client-side only (uses DOM APIs)
const MDXEditorComponent = dynamic(
  () =>
    import('@mdxeditor/editor').then((mod) => {
      const {
        MDXEditor,
        headingsPlugin,
        listsPlugin,
        quotePlugin,
        thematicBreakPlugin,
        markdownShortcutPlugin,
        toolbarPlugin,
        BoldItalicUnderlineToggles,
        BlockTypeSelect,
        ListsToggle,
        UndoRedo,
      } = mod;

      function ToolbarContents(): React.JSX.Element {
        return (
          <>
            <UndoRedo />
            <BoldItalicUnderlineToggles />
            <BlockTypeSelect />
            <ListsToggle />
          </>
        );
      }

      // eslint-disable-next-line react/display-name
      const Editor = forwardRef<MDXEditorMethods, { markdown: string; onChange?: (md: string) => void }>(
        ({ markdown, onChange }, ref) => (
          <MDXEditor
            ref={ref}
            markdown={markdown}
            onChange={onChange}
            contentEditableClassName="prose prose-stone prose-sm max-w-none min-h-[200px] focus:outline-none"
            plugins={[
              headingsPlugin(),
              listsPlugin(),
              quotePlugin(),
              thematicBreakPlugin(),
              markdownShortcutPlugin(),
              toolbarPlugin({ toolbarContents: () => <ToolbarContents /> }),
            ]}
          />
        ),
      );

      return Editor;
    }),
  { ssr: false, loading: () => <div className="p-4 text-sm text-slate-400">Načítám editor…</div> },
);

export interface MarkdownEditorHandle {
  getMarkdown: () => string;
}

interface MarkdownEditorProps {
  initialValue: string;
  onChange?: (value: string) => void;
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor({ initialValue, onChange }, outerRef) {
    const editorRef = useRef<MDXEditorMethods>(null);

    useImperativeHandle(outerRef, () => ({
      getMarkdown: () => editorRef.current?.getMarkdown() ?? initialValue,
    }));

    const handleChange = useCallback(
      (md: string) => {
        onChange?.(md);
      },
      [onChange],
    );

    return (
      <div className="overflow-hidden rounded border border-slate-200">
        <MDXEditorComponent
          ref={editorRef}
          markdown={initialValue}
          onChange={handleChange}
        />
      </div>
    );
  },
);
