'use client';

interface ConfidenceHighlightProps {
  text: string;
}

// Matches {?...?}, [?...?], and [...]
const UNCERTAIN_PATTERN = /(\{\?[^}]*\?\}|\[\?[^\]]*\?\]|\[\.\.\.?\])/g;

interface TextSegment {
  value: string;
  type: 'normal' | 'uncertain' | 'unreadable';
}

function segmentText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(UNCERTAIN_PATTERN)) {
    const start = match.index ?? 0;
    const matched = match[0] ?? '';

    if (start > lastIndex) {
      segments.push({ value: text.slice(lastIndex, start), type: 'normal' });
    }

    const isUnreadable = matched.startsWith('[...');
    segments.push({
      value: matched,
      type: isUnreadable ? 'unreadable' : 'uncertain',
    });

    lastIndex = start + matched.length;
  }

  if (lastIndex < text.length) {
    segments.push({ value: text.slice(lastIndex), type: 'normal' });
  }

  return segments;
}

export function ConfidenceHighlight({ text }: ConfidenceHighlightProps): React.JSX.Element {
  const segments = segmentText(text);

  return (
    <span>
      {segments.map((segment, index) => {
        if (segment.type === 'uncertain') {
          return (
            <mark
              key={index}
              className="rounded bg-amber-100 px-0.5 text-amber-800"
              title="Nejisté čtení"
            >
              {segment.value}
            </mark>
          );
        }
        if (segment.type === 'unreadable') {
          return (
            <mark
              key={index}
              className="rounded bg-red-100 px-0.5 text-red-700"
              title="Nečitelné místo"
            >
              {segment.value}
            </mark>
          );
        }
        return <span key={index}>{segment.value}</span>;
      })}
    </span>
  );
}
