/**
 * Worker handler for translating collection context to another language.
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@ai-sedlacek/db';
import { deductTokens } from '@ai-sedlacek/db/billing';

const LANGUAGE_NAMES: Record<string, string> = {
  cs: 'Czech',
  en: 'English',
};

export interface TranslateContextJobData {
  collectionId: string;
  targetLanguage: string;
  userId: string;
}

export async function handleTranslateContext(
  jobId: string,
  data: TranslateContextJobData,
): Promise<void> {
  const { collectionId, targetLanguage, userId } = data;

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { context: true, contextLanguage: true, name: true },
  });

  if (!collection || !collection.context) {
    throw new Error(`Collection ${collectionId} not found or has no context`);
  }

  await prisma.processingJob.update({
    where: { id: jobId },
    data: { currentStep: 'Translating context…' },
  });

  const sourceLang =
    LANGUAGE_NAMES[collection.contextLanguage ?? 'cs'] ?? collection.contextLanguage ?? 'Czech';
  const targetLang = LANGUAGE_NAMES[targetLanguage] ?? targetLanguage;

  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `Translate the following historical manuscript context from ${sourceLang} to ${targetLang}. Keep the markdown formatting intact. Translate naturally — this is scholarly/academic text about a historical manuscript.

${collection.context}`,
      },
    ],
  });

  const context = response.content[0]?.type === 'text' ? response.content[0].text : '';

  await prisma.collection.update({
    where: { id: collectionId },
    data: { context, contextLanguage: targetLanguage },
  });

  // Deduct tokens
  await deductTokens(
    userId,
    response.usage.input_tokens,
    response.usage.output_tokens,
    `Překlad kontextu svazku ${collection.name} do ${targetLang}`,
    `translate-context:${collectionId}:${Date.now()}`,
  ).catch(() => {
    // Non-critical
  });
}
