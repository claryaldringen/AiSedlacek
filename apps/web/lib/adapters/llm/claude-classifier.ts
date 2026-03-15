import Anthropic from '@anthropic-ai/sdk';
import type { ILayoutClassifier } from '@ai-sedlacek/shared';
import type { DocumentClassification } from '@ai-sedlacek/shared';
import { CLASSIFY_LAYOUT_PROMPT } from '@ai-sedlacek/shared';

const FALLBACK_CLASSIFICATION: DocumentClassification = {
  tier: 'tier1',
  scriptType: 'print',
  layoutComplexity: 'simple',
  detectedFeatures: [],
  confidence: 0,
  reasoning: 'Klasifikace selhala – použit výchozí tier1',
};

export class ClaudeLayoutClassifier implements ILayoutClassifier {
  async classify(image: Buffer): Promise<DocumentClassification> {
    try {
      const client = new Anthropic();
      const imageBase64 = image.toString('base64');

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: CLASSIFY_LAYOUT_PROMPT,
              },
            ],
          },
        ],
      });

      const firstContent = response.content[0];
      const content = firstContent?.type === 'text' ? firstContent.text : '';

      return this.parseClassification(content);
    } catch {
      console.warn('[ClaudeLayoutClassifier] API error, falling back to tier1');
      return FALLBACK_CLASSIFICATION;
    }
  }

  private parseClassification(content: string): DocumentClassification {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn('[ClaudeLayoutClassifier] No JSON found in response, falling back to tier1');
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
        typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5;
      const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : '';

      return { tier, scriptType, layoutComplexity, detectedFeatures, confidence, reasoning };
    } catch {
      console.warn('[ClaudeLayoutClassifier] Failed to parse JSON, falling back to tier1');
      return FALLBACK_CLASSIFICATION;
    }
  }
}
