import { ConfidenceHighlight } from '@/components/ConfidenceHighlight';

interface TextColumnProps {
  title: string;
  text: string;
  highlight?: boolean;
}

export function TextColumn({ title, text, highlight = false }: TextColumnProps): React.JSX.Element {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
        <h3 className="text-sm font-semibold text-stone-700">{title}</h3>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
          {highlight ? <ConfidenceHighlight text={text} /> : text}
        </p>
      </div>
    </div>
  );
}
