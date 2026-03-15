import type { ILayoutClassifier } from '@ai-sedlacek/shared';
import type { DocumentClassification, OllamaConfig } from '@ai-sedlacek/shared';
import { CLASSIFY_LAYOUT_PROMPT } from '@ai-sedlacek/shared';

interface OllamaChatResponse {
  message: { content: string };
}

const FALLBACK_CLASSIFICATION: DocumentClassification = {
  tier: 'tier1',
  scriptType: 'print',
  layoutComplexity: 'simple',
  detectedFeatures: [],
  confidence: 0,
  reasoning: 'Klasifikace selhala – použit výchozí tier1',
};

export class OllamaLayoutClassifier implements ILayoutClassifier {
  constructor(private readonly config: OllamaConfig) {}

  async classify(image: Buffer): Promise<DocumentClassification> {
    const imageBase64 = image.toString('base64');

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        stream: false,
        messages: [
          {
            role: 'user',
            content: CLASSIFY_LAYOUT_PROMPT,
            images: [imageBase64],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn(
        `[OllamaLayoutClassifier] API error ${response.status}, falling back to tier1`,
      );
      return FALLBACK_CLASSIFICATION;
    }

    const data = (await response.json()) as OllamaChatResponse;
    const content = data.message.content;

    return this.parseClassification(content);
  }

  private parseClassification(content: string): DocumentClassification {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn('[OllamaLayoutClassifier] No JSON found in response, falling back to tier1');
      return FALLBACK_CLASSIFICATION;
    }

    try {
      const parsed = JSON.parse(match[0]) as Partial<DocumentClassification>;

      const tier = parsed.tier === 'tier2' ? 'tier2' : 'tier1';
      const scriptType = parsed.scriptType === 'manuscript' ? 'manuscript' : 'print';
      const layoutComplexity = parsed.layoutComplexity === 'complex' ? 'complex' : 'simple';
      const detectedFeatures = Array.isArray(parsed.detectedFeatures)
        ? parsed.detectedFeatures.filter((f): f is string => typeof f === 'string')
        : [];
      const confidence =
        typeof parsed.confidence === 'number'
          ? Math.max(0, Math.min(1, parsed.confidence))
          : 0.5;
      const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

      return { tier, scriptType, layoutComplexity, detectedFeatures, confidence, reasoning };
    } catch {
      console.warn('[OllamaLayoutClassifier] Failed to parse JSON, falling back to tier1');
      return FALLBACK_CLASSIFICATION;
    }
  }
}
