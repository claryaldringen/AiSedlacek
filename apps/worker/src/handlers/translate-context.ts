/**
 * Worker handler for translating collection context to another language.
 */

import { createMessage } from '../lib/llm';
import { LANGUAGE_NAMES } from '../lib/languages';
import { prisma } from '@ai-sedlacek/db';
import { deductTokensIfSufficient } from '@ai-sedlacek/db/billing';

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

  const response = await createMessage({
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    messages: [
      {
        role: 'user',
        content: `Translate the following historical manuscript context from ${sourceLang} to ${targetLang}. Keep the markdown formatting intact. Translate naturally — this is scholarly/academic text about a historical manuscript.

${collection.context}`,
      },
    ],
  });

  const context = response.text;

  await prisma.collection.update({
    where: { id: collectionId },
    data: { context, contextLanguage: targetLanguage },
  });

  // Deduct tokens
  await deductTokensIfSufficient(
    userId,
    response.inputTokens,
    response.outputTokens,
    `Překlad kontextu svazku ${collection.name} do ${targetLang}`,
    `translate-context:${collectionId}:${Date.now()}`,
  ).catch((err) => {
    console.warn('[Worker:translate-context] Token deduction failed:', err);
  });

  // Mark job as completed
  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: 'completed',
      currentStep: 'Hotovo',
      completedPages: 1,
    },
  });
}
