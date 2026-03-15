import Image from 'next/image';
import type { ProcessingResult } from '@ai-sedlacek/shared';
import { TextColumn } from '@/components/TextColumn';

interface ResultViewerProps {
  result: ProcessingResult;
}

const TIER_LABEL: Record<string, string> = {
  tier1: 'Tier 1 (standardní)',
  tier2: 'Tier 2 (složitý layout)',
};

const SCRIPT_LABEL: Record<string, string> = {
  print: 'Tisk',
  manuscript: 'Rukopis',
};

const COMPLEXITY_LABEL: Record<string, string> = {
  simple: 'Jednoduchý',
  complex: 'Složitý',
};

export function ResultViewer({ result }: ResultViewerProps): React.JSX.Element {
  const { classification, ocrResults, confidenceNotes } = result;

  // Concatenate OCR text from all recognizer engines
  const ocrText = ocrResults
    .filter((r) => r.role === 'recognizer')
    .map((r) => `[${r.engine}]\n${r.text}`)
    .join('\n\n---\n\n');

  return (
    <div className="space-y-4">
      {/* Classification info */}
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
        <h2 className="mb-2 text-sm font-semibold text-stone-600">Klasifikace dokumentu</h2>
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-800">
            {TIER_LABEL[classification.tier] ?? classification.tier}
          </span>
          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-stone-700">
            {SCRIPT_LABEL[classification.scriptType] ?? classification.scriptType}
          </span>
          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-stone-700">
            Layout:{' '}
            {COMPLEXITY_LABEL[classification.layoutComplexity] ?? classification.layoutComplexity}
          </span>
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-800">
            Spolehlivost: {Math.round(classification.confidence * 100)} %
          </span>
        </div>
        {classification.reasoning && (
          <p className="mt-2 text-sm text-stone-500 italic">{classification.reasoning}</p>
        )}
        {classification.detectedFeatures.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {classification.detectedFeatures.map((feature) => (
              <span
                key={feature}
                className="rounded bg-stone-200 px-1.5 py-0.5 text-xs text-stone-600"
              >
                {feature}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 4-column result grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <TextColumn title="Originál" text="" />
        <TextColumn title="OCR přepis" text={ocrText} highlight />
        <TextColumn title="Doslovný překlad" text={result.literalTranslation} highlight />
        <TextColumn title="Učesaný překlad" text={result.polishedTranslation} />
      </div>

      {/* Original image */}
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm">
        <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
          <h3 className="text-sm font-semibold text-stone-700">Originální obrázek</h3>
        </div>
        <div className="relative p-4">
          <Image
            src={result.originalImage}
            alt="Originální dokument"
            width={1200}
            height={800}
            className="max-h-[600px] w-full rounded object-contain"
            unoptimized
          />
        </div>
      </div>

      {/* Confidence notes */}
      {confidenceNotes.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-amber-800">
            Poznámky o nejistých místech
          </h3>
          <ul className="list-inside list-disc space-y-1">
            {confidenceNotes.map((note, index) => (
              <li key={index} className="text-sm text-amber-700">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
