/**
 * Worker handler for translating collection context to another language.
 */

import { createMessage } from '../lib/llm';
import { LANGUAGE_NAMES } from '../lib/languages';
import { prisma } from '@ai-sedlacek/db';
import { deductTokensIfSufficient } from '@ai-sedlacek/db/billing';
import { TEXT_MODEL } from '@ai-sedlacek/shared';

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
    model: TEXT_MODEL,
    // Dlouhý kontext se do 4096 tokenů nevešel a useknutý překlad nahradil originál.
    maxTokens: 16_000,
    messages: [
      {
        role: 'user',
        content: `Translate the following historical manuscript context from ${sourceLang} to ${targetLang}. Keep the markdown formatting intact. Translate naturally — this is scholarly/academic text about a historical manuscript.

${collection.context}`,
      },
    ],
  });

  // Odečíst hned po volání (BIL-3) – i když se výsledek neuloží, tokeny
  // se spotřebovaly.
  await deductTokensIfSufficient(
    userId,
    response.inputTokens,
    response.outputTokens,
    `Překlad kontextu svazku ${collection.name} do ${targetLang}`,
    // Deterministický klíč z jobu (BIL-3, dřív Date.now())
    `translate-context:${jobId}:${collectionId}:${targetLanguage}`,
  ).catch((err) => {
    console.warn('[Worker:translate-context] Token deduction failed:', err);
  });

  // Kontext svazku nemá historii a překlad nahrazuje originál – přepsat ho smí
  // jen kompletní, neprázdný výstup (DAT-2).
  const context = response.text.trim();
  if (response.stopReason !== 'end_turn' || context === '') {
    throw new Error('Model nevrátil kompletní překlad kontextu – kontext svazku zůstal beze změny');
  }

  await prisma.collection.update({
    where: { id: collectionId },
    data: { context, contextLanguage: targetLanguage },
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
