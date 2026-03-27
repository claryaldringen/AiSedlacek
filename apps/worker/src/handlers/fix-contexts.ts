/**
 * Worker handler for fixing document-level contexts against collection context.
 */

import { createMessage } from '../lib/llm';
import { prisma } from '@ai-sedlacek/db';
import { createVersion } from '@ai-sedlacek/db/versioning';
import { deductTokensIfSufficient } from '@ai-sedlacek/db/billing';

export interface FixContextsJobData {
  collectionId: string;
  userId: string;
}

export async function handleFixContexts(jobId: string, data: FixContextsJobData): Promise<void> {
  const { collectionId, userId } = data;

  await prisma.processingJob.update({
    where: { id: jobId },
    data: { currentStep: 'Načítám svazek a dokumenty…' },
  });

  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    include: {
      pages: {
        where: { status: 'done' },
        include: {
          document: { select: { id: true, context: true, transcription: true } },
        },
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!collection || collection.userId !== userId) {
    throw new Error('Svazek nenalezen');
  }

  if (!collection.context) {
    throw new Error('Svazek nemá kontext');
  }

  const documents = collection.pages.filter((p) => p.document !== null).map((p) => p.document!);

  if (documents.length === 0) {
    throw new Error('Žádné zpracované dokumenty');
  }

  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      totalPages: documents.length,
      completedPages: 0,
      currentStep: `Opravuji kontext (0/${documents.length})…`,
    },
  });

  let completed = 0;
  const errors: string[] = [];

  for (const doc of documents) {
    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        currentStep: `Opravuji kontext (${completed + 1}/${documents.length})…`,
      },
    });

    try {
      const response = await createMessage({
        model: 'claude-sonnet-4-6',
        maxTokens: 2048,
        messages: [
          {
            role: 'user',
            content: `Máš k dispozici kontext celého díla (svazku) a kontext jednoho konkrétního dokumentu (stránky) z tohoto díla. Kontext dokumentu byl vytvořen bez znalosti kontextu díla a může obsahovat obecné informace o díle, které patří spíše do kontextu svazku.

Tvým úkolem je přepsat kontext dokumentu tak, aby:
1. Neobsahoval informace, které už jsou v kontextu díla (neopakuj je)
2. Obsahoval pouze informace specifické pro tuto konkrétní stránku/folium
3. Pokud je to relevantní, zmínil co je na této stránce (typ obsahu, zajímavosti)
4. Byl stručný a konkrétní

Pokud dokument nemá žádné specifické informace navíc oproti kontextu díla, vrať krátkou větu popisující obsah stránky na základě transkripce.

=== KONTEXT DÍLA (svazku) ===
${collection.context}

=== AKTUÁLNÍ KONTEXT DOKUMENTU ===
${doc.context}

=== TRANSKRIPCE DOKUMENTU (pro orientaci) ===
${doc.transcription.slice(0, 2000)}

Vrať POUZE nový kontext dokumentu v markdown, bez komentáře.`,
          },
        ],
      });

      const newContext = response.text;

      if (newContext && newContext !== doc.context) {
        await createVersion(doc.id, 'context', doc.context, 'ai_regenerate', response.model);
        await prisma.document.update({
          where: { id: doc.id },
          data: { context: newContext },
        });
      }

      // Deduct tokens
      await deductTokensIfSufficient(
        userId,
        response.inputTokens,
        response.outputTokens,
        `Oprava kontextu dokumentu ${doc.id} [${collection.name}]`,
        `fix-context:${doc.id}:${Date.now()}`,
      ).catch((err) => {
        console.warn('[Worker:fix-contexts] Token deduction failed:', err);
      });

      completed++;
    } catch (err) {
      completed++;
      const message = err instanceof Error ? err.message : 'Chyba';
      errors.push(`Dokument ${doc.id}: ${message}`);
    }

    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        completedPages: completed,
        currentStep: `Opravuji kontext (${completed}/${documents.length})…`,
      },
    });

    // Check if job was cancelled
    const jobRecord = await prisma.processingJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (jobRecord?.status === 'cancelled') {
      return;
    }
  }

  // Mark job as completed
  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: errors.length > 0 && completed === 0 ? 'error' : 'completed',
      currentStep: 'Hotovo',
      completedPages: completed,
      errors,
    },
  });
}
