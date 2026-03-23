/**
 * Worker handler for retranslation jobs.
 *
 * Ported from /api/documents/[id]/retranslate/route.ts to run
 * in the long-lived VPS worker process (no serverless timeout).
 */

import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../lib/infrastructure/db';
import { createVersion } from '../lib/infrastructure/versioning';
import { deductTokensIfSufficient } from '../lib/infrastructure/billing';

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
      page: { select: { userId: true } },
    },
  });

  if (!doc) {
    throw new Error(`Dokument ${documentId} nenalezen`);
  }

  if (doc.page.userId !== userId) {
    throw new Error('Přístup zamítnut');
  }

  const langName: Record<string, string> = {
    cs: 'češtiny',
    en: 'angličtiny',
    de: 'němčiny',
    fr: 'francouzštiny',
    la: 'latiny',
  };

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
    prompt = `Přelož tento historický přepis do moderní ${langName[targetLang] ?? targetLang}. Zachovej strukturu, všechny reference a citace. Hranaté závorky použij pro vysvětlení archaických pojmů. Formátuj jako markdown.\n\n${doc.transcription}`;
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  const translatedText = response.content[0]?.type === 'text' ? response.content[0].text : '';

  await prisma.processingJob.update({
    where: { id: jobId },
    data: { currentStep: 'Ukládám překlad…' },
  });

  // Atomically check balance and deduct tokens
  const deductResult = await deductTokensIfSufficient(
    userId,
    response.usage.input_tokens,
    response.usage.output_tokens,
    `Retranslace dokumentu ${documentId}`,
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
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    create: {
      documentId,
      language: targetLang,
      text: translatedText,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
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
