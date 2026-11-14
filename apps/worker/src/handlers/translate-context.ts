/**
 * Worker handler for translating collection context to another language.
 */

import { createBilledMessage } from '../lib/billed-message';
import { LANGUAGE_NAMES } from '../lib/languages';
import { prisma } from '@ai-sedlacek/db';
import { LLM_MAX_TOKENS, TEXT_MODEL } from '@ai-sedlacek/shared';

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

  // Rezervace před voláním, vyúčtování hned po něm (BIL-1) – i když se výsledek
  // neuloží, tokeny se spotřebovaly. Bez volného kreditu se model nezavolá.
  const { response } = await createBilledMessage(
    {
      userId,
      jobId,
      // Deterministický klíč z jobu (BIL-3, dřív Date.now())
      referenceId: `translate-context:${jobId}:${collectionId}:${targetLanguage}`,
      description: `Překlad kontextu svazku ${collection.name} do ${targetLang}`,
    },
    {
      model: TEXT_MODEL,
      // Dlouhý kontext se do 4096 tokenů nevešel a useknutý překlad nahradil originál.
      maxTokens: LLM_MAX_TOKENS.translateContext,
      messages: [
        {
          role: 'user',
          content: `Translate the following historical manuscript context from ${sourceLang} to ${targetLang}. Keep the markdown formatting intact. Translate naturally — this is scholarly/academic text about a historical manuscript.

${collection.context}`,
        },
      ],
    },
  );

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
