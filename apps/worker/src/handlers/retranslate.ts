/**
 * Worker handler for retranslation jobs.
 */

import { createMessage } from '../lib/llm';
import { LANGUAGE_NAMES_CS_GENITIVE } from '../lib/languages';
import { prisma } from '@ai-sedlacek/db';
import { createVersion } from '@ai-sedlacek/db/versioning';
import { deductTokensIfSufficient } from '@ai-sedlacek/db/billing';

export interface RetranslateJobData {
  documentId: string;
  language: string;
  userId: string;
  previousTranslation?: string;
}

export async function handleRetranslate(jobId: string, data: RetranslateJobData): Promise<void> {
  const { documentId, language, userId, previousTranslation } = data;
  const targetLang = language || 'cs';

  await prisma.processingJob.update({
    where: { id: jobId },
    data: { currentStep: 'Načítám dokument…' },
  });

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      translations: { where: { language: targetLang } },
      page: { select: { userId: true, collection: { select: { name: true } } } },
    },
  });

  if (!doc) {
    throw new Error(`Dokument ${documentId} nenalezen`);
  }

  if (doc.page.userId !== userId) {
    throw new Error('Přístup zamítnut');
  }

  const existingTranslation = previousTranslation ?? doc.translations[0]?.text;

  await prisma.processingJob.update({
    where: { id: jobId },
    data: { currentStep: 'Volám model pro retranslaci…' },
  });

  let prompt: string;
  if (existingTranslation) {
    prompt = `Transkripce historického textu byla upravena. Aktualizuj existující překlad tak, aby odpovídal změnám v transkripci. Měň JEN ta místa, která se změnila – zbytek překladu ponech beze změny.

UPRAVENÁ TRANSKRIPCE:
${doc.transcription}

STÁVAJÍCÍ PŘEKLAD (uprav jen změněná místa):
${existingTranslation}

Vrať POUZE aktualizovaný překlad v markdown, nic dalšího.`;
  } else {
    prompt = `Přelož tento historický přepis do moderní ${LANGUAGE_NAMES_CS_GENITIVE[targetLang] ?? targetLang}. Zachovej strukturu, všechny reference a citace. Hranaté závorky použij pro vysvětlení archaických pojmů. Formátuj jako markdown.\n\n${doc.transcription}`;
  }

  const response = await createMessage({
    model: 'claude-sonnet-4-6',
    maxTokens: 8192,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  const translatedText = response.text;

  await prisma.processingJob.update({
    where: { id: jobId },
    data: { currentStep: 'Ukládám překlad…' },
  });

  // Atomically check balance and deduct tokens
  const deductResult = await deductTokensIfSufficient(
    userId,
    response.inputTokens,
    response.outputTokens,
    `Retranslace dokumentu ${documentId}${doc.page.collection?.name ? ` [${doc.page.collection.name}]` : ''}`,
    `retranslate-${documentId}-${Date.now()}`,
  );

  if (!deductResult.success) {
    console.warn(
      `[Worker:retranslate] Insufficient balance for user ${userId}, saving result anyway`,
    );
  }

  // Save old translation as version before overwriting
  if (existingTranslation) {
    await createVersion(
      documentId,
      `translation:${targetLang}`,
      existingTranslation,
      'ai_retranslate',
      response.model,
    );
  }

  await prisma.translation.upsert({
    where: { documentId_language: { documentId, language: targetLang } },
    update: {
      text: translatedText,
      model: response.model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    },
    create: {
      documentId,
      language: targetLang,
      text: translatedText,
      model: response.model,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    },
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
