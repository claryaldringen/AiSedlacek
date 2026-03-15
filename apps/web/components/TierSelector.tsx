'use client';

import type { DocumentClassification } from '@ai-sedlacek/shared';

interface TierSelectorProps {
  classification: DocumentClassification | null;
}

export function TierSelector({ classification }: TierSelectorProps): React.JSX.Element {
  if (!classification) {
    return (
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
        <p className="text-sm text-stone-500">
          Klasifikace tieru bude dostupná po zpracování dokumentu.
        </p>
      </div>
    );
  }

  const isTier2 = classification.tier === 'tier2';

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-stone-700">Doporučený OCR tier</h2>

      {/* Tier badge */}
      <div className="mb-3 flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
            isTier2 ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
          }`}
        >
          {isTier2 ? 'Tier 2 – složitý layout' : 'Tier 1 – standardní'}
        </span>

        {/* Confidence */}
        <span className="text-xs text-stone-500">
          Spolehlivost: {Math.round(classification.confidence * 100)} %
        </span>
      </div>

      {/* Tier 2 VPS warning */}
      {isTier2 && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="text-xs font-medium text-amber-700">Tier 2 vyžaduje VPS worker</span>
        </div>
      )}

      {/* Reasoning */}
      {classification.reasoning && (
        <p className="mb-3 text-sm italic text-stone-500">{classification.reasoning}</p>
      )}

      {/* Detected features */}
      {classification.detectedFeatures.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-stone-600">Detekované rysy:</p>
          <div className="flex flex-wrap gap-1">
            {classification.detectedFeatures.map((feature) => (
              <span
                key={feature}
                className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600"
              >
                {feature}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
