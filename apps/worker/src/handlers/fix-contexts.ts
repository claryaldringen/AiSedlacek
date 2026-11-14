/**
 * Worker handler for fixing document-level contexts against collection context.
 */

import { createBilledMessage } from '../lib/billed-message';
import { prisma } from '@ai-sedlacek/db';
import { createVersion } from '@ai-sedlacek/db/versioning';
import { InsufficientCreditError } from '@ai-sedlacek/db/billing';
import { isCreditBusy } from '../lib/job-error';
import { LLM_MAX_TOKENS, TEXT_MODEL } from '@ai-sedlacek/shared';
import { errorsKeepingReclaimMarkers } from '../lib/reclaim';

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
  let succeeded = 0;
  let outOfCredit = false;
  const errors: string[] = [];

  for (const doc of documents) {
    const referenceId = `fix-context:${jobId}:${doc.id}`;

    await prisma.processingJob.update({
      where: { id: jobId },
      data: {
        currentStep: `Opravuji kontext (${completed + 1}/${documents.length})…`,
      },
    });

    try {
      // Rezervace před každým voláním a vyúčtování hned po něm (BIL-1) – spotřeba
      // vznikla, i když se výsledek neuloží. Deterministický referenceId (bez
      // Date.now()) – opakovaný běh jobu neúčtuje tentýž dokument dvakrát.
      const { response } = await createBilledMessage(
        {
          userId,
          jobId,
          referenceId,
          description: `Oprava kontextu dokumentu ${doc.id} [${collection.name}]`,
          collectionId,
        },
        {
          model: TEXT_MODEL,
          maxTokens: LLM_MAX_TOKENS.fixContext,
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
        },
      );

      // Useknutý (max_tokens) nebo odmítnutý výstup kontext nepřepíše
      if (response.stopReason !== 'end_turn') {
        throw new Error(
          `Model nevrátil kompletní kontext (${response.stopReason ?? 'neznámý důvod'}) – kontext zůstal beze změny`,
        );
      }

      const newContext = response.text;

      if (newContext && newContext !== doc.context) {
        await createVersion(doc.id, 'context', doc.context, 'ai_regenerate', response.model);
        await prisma.document.update({
          where: { id: doc.id },
          data: { context: newContext },
        });
      }

      completed++;
      succeeded++;
    } catch (err) {
      // Kredit blokuje jiná běžící akce uživatele – job končí credit_busy
      // (job-failure.ts); hotové opravy zůstávají uložené.
      if (isCreditBusy(err)) throw err;
      if (err instanceof InsufficientCreditError) {
        // Došel volný kredit – zbylé dokumenty se nezpracují (další volání by
        // stejně neprošla); hotové opravy zůstávají uložené.
        outOfCredit = true;
        errors.push(
          `Nedostatečný kredit – oprava kontextu zastavena, ${documents.length - completed} dokumentů nezpracováno (potřeba ${err.required.toLocaleString('cs')} tokenů, volných ${Math.max(0, err.available).toLocaleString('cs')})`,
        );
        break;
      }
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
      status: outOfCredit || (errors.length > 0 && succeeded === 0) ? 'error' : 'completed',
      currentStep: outOfCredit ? 'Nedostatečný kredit' : 'Hotovo',
      completedPages: completed,
      errors: await errorsKeepingReclaimMarkers(jobId, errors),
      // Kód pro lokalizovanou hlášku s výzvou k dobití v UI
      ...(outOfCredit ? { errorCode: 'insufficient_credit' } : {}),
    },
  });
}
