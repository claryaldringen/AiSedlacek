/**
 * Worker handler for retranslation jobs.
 */

import { createMessage } from '../lib/llm';
import { LANGUAGE_NAMES, LANGUAGE_NAMES_CS_GENITIVE } from '../lib/languages';
import { prisma } from '@ai-sedlacek/db';
import { deductTokensIfSufficient } from '@ai-sedlacek/db/billing';
import { TEXT_MODEL } from '@ai-sedlacek/shared';

const STEPS_CS = {
  loading: 'Načítám dokument…',
  calling: 'Volám model pro retranslaci…',
  saving: 'Ukládám překlad…',
  done: 'Hotovo',
};
const STEPS_EN = {
  loading: 'Loading document…',
  calling: 'Calling translation model…',
  saving: 'Saving translation…',
  done: 'Done',
};
function getSteps(lang: string): typeof STEPS_CS {
  return lang === 'cs' ? STEPS_CS : STEPS_EN;
}

/** Uživatel překlad během běhu jobu ručně upravil – výsledek LLM se neuloží. */
export const TRANSLATION_CHANGED_MESSAGE =
  'Překlad byl mezitím ručně upraven – výsledek retranslace se neuložil.';

const SAVE_MAX_ATTEMPTS = 3;

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code: unknown }).code === 'P2002'
  );
}

/** Podmíněný zápis v transakci nenašel výchozí text – překlad se mezitím změnil. */
class TranslationChangedError extends Error {
  constructor() {
    super(TRANSLATION_CHANGED_MESSAGE);
    this.name = 'TranslationChangedError';
  }
}

export interface RetranslateJobData {
  documentId: string;
  language: string;
  userId: string;
  previousTranslation?: string;
}

export async function handleRetranslate(jobId: string, data: RetranslateJobData): Promise<void> {
  const { documentId, language, userId, previousTranslation } = data;
  const targetLang = language || 'cs';
  const s = getSteps(targetLang);

  await prisma.processingJob.update({
    where: { id: jobId },
    data: { currentStep: s.loading },
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

  // Stav překladu v DB na začátku jobu – při ukládání se z něj ověřuje, že ho
  // uživatel mezitím ručně neupravil. `previousTranslation` (text z klienta) jde
  // jen do promptu, pro detekci konfliktu je směrodatná DB.
  const baseTranslation = doc.translations[0]?.text ?? null;
  const existingTranslation = previousTranslation ?? baseTranslation ?? undefined;

  await prisma.processingJob.update({
    where: { id: jobId },
    data: { currentStep: s.calling },
  });

  let prompt: string;
  if (existingTranslation) {
    prompt =
      targetLang === 'cs'
        ? `Transkripce historického textu byla upravena. Aktualizuj existující překlad tak, aby odpovídal změnám v transkripci. Měň JEN ta místa, která se změnila – zbytek překladu ponech beze změny.

UPRAVENÁ TRANSKRIPCE:
${doc.transcription}

STÁVAJÍCÍ PŘEKLAD (uprav jen změněná místa):
${existingTranslation}

Vrať POUZE aktualizovaný překlad v markdown, nic dalšího.`
        : `The transcription of a historical text has been edited. Update the existing translation to match the changes in the transcription. Change ONLY the parts that were modified — keep the rest of the translation unchanged.

UPDATED TRANSCRIPTION:
${doc.transcription}

EXISTING TRANSLATION (update only changed parts):
${existingTranslation}

Return ONLY the updated translation in markdown, nothing else.`;
  } else {
    const langName = LANGUAGE_NAMES[targetLang] ?? targetLang;
    const langNameCs = LANGUAGE_NAMES_CS_GENITIVE[targetLang] ?? targetLang;
    prompt =
      targetLang === 'cs'
        ? `Přelož tento historický přepis do moderní ${langNameCs}. Zachovej strukturu, všechny reference a citace. Hranaté závorky použij pro vysvětlení archaických pojmů. Formátuj jako markdown.\n\n${doc.transcription}`
        : `Translate this historical transcription into modern ${langName}. Preserve structure, all references and citations. Use square brackets to explain archaic terms. Format as markdown.\n\n${doc.transcription}`;
  }

  const response = await createMessage({
    model: TEXT_MODEL,
    maxTokens: 8192,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }],
  });

  const translatedText = response.text;

  await prisma.processingJob.update({
    where: { id: jobId },
    data: { currentStep: s.saving },
  });

  // Atomically check balance and deduct tokens – hned po volání, spotřeba vznikla
  // i v případě, že se výsledek nakonec neuloží.
  const deductResult = await deductTokensIfSufficient(
    userId,
    response.inputTokens,
    response.outputTokens,
    `Retranslace dokumentu ${documentId}${doc.page.collection?.name ? ` [${doc.page.collection.name}]` : ''}`,
    // Deterministický klíč (job + dokument + jazyk): opakované zpracování téhož jobu
    // po restartu workeru neúčtuje dvakrát (BIL-3, dřív Date.now()).
    `retranslate:${jobId}:${documentId}:${targetLang}`,
    response.model,
  );

  if (!deductResult.success) {
    console.warn(
      `[Worker:retranslate] Insufficient balance for user ${userId}, saving result anyway`,
    );
  }

  // Useknutý (max_tokens) nebo odmítnutý výstup by přepsal překlad neúplným
  // textem – neukládat (spotřeba je už naúčtovaná výše).
  if (response.stopReason !== 'end_turn' || translatedText.trim() === '') {
    const reason =
      response.stopReason === 'end_turn'
        ? 'prázdný výstup'
        : (response.stopReason ?? 'neznámý důvod');
    throw new Error(`Model nevrátil kompletní překlad (${reason}) – překlad zůstal beze změny`);
  }

  await saveRetranslation({
    documentId,
    language: targetLang,
    baseTranslation,
    text: translatedText,
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
  });

  // Mark job as completed
  await prisma.processingJob.update({
    where: { id: jobId },
    data: {
      status: 'completed',
      currentStep: s.done,
      completedPages: 1,
    },
  });
}

/**
 * Uloží výsledek retranslace – jen pokud překlad v DB pořád odpovídá stavu, ze
 * kterého job vycházel. Uživatel mohl překlad během běhu jobu ručně upravit
 * (PATCH uloží verzi manual_edit a nový text); prostý upsert by jeho úpravu
 * přepsal a verzoval by zastaralý snapshot.
 *
 * V jedné transakci: verze z AKTUÁLNÍHO textu (ai_retranslate) a podmíněný zápis
 * `updateMany where text = výchozí text` – podmínku vyhodnotí Postgres až po
 * zamčení řádku, takže souběžný zápis se nemůže vklínit mezi kontrolu a přepis.
 * Neexistoval-li překlad, zakládá se nový; souběžně založený překlad skončí
 * kolizí unikátního klíče a opakovaný pokus ho už uvidí jako změnu.
 *
 * @throws Error s `TRANSLATION_CHANGED_MESSAGE`, pokud se překlad mezitím změnil
 */
async function saveRetranslation(params: {
  documentId: string;
  language: string;
  baseTranslation: string | null;
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}): Promise<void> {
  const { documentId, language, baseTranslation, text, model, inputTokens, outputTokens } = params;
  const where = { documentId_language: { documentId, language } };

  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        const current = await tx.translation.findUnique({ where, select: { text: true } });
        const currentText = current?.text ?? null;
        if (currentText !== baseTranslation) throw new TranslationChangedError();

        if (currentText === null) {
          await tx.translation.create({
            data: { documentId, language, text, model, inputTokens, outputTokens },
          });
        } else {
          const last = await tx.documentVersion.findFirst({
            where: { documentId },
            orderBy: { version: 'desc' },
            select: { version: true },
          });
          await tx.documentVersion.create({
            data: {
              documentId,
              version: (last?.version ?? 0) + 1,
              field: `translation:${language}`,
              content: currentText,
              source: 'ai_retranslate',
              model,
            },
          });
          const { count } = await tx.translation.updateMany({
            where: { documentId, language, text: currentText },
            data: { text, model, inputTokens, outputTokens },
          });
          // Řádek se změnil mezi čtením a zápisem – rollback i založené verze
          if (count === 0) throw new TranslationChangedError();
        }

        // Posunout Document.updatedAt – podle něj `ais push` detekuje, že se překlad
        // na serveru změnil (Translation vlastní updatedAt nemá).
        await tx.document.update({
          where: { id: documentId },
          data: { updatedAt: new Date() },
          select: { id: true },
        });
      });
      return;
    } catch (e) {
      // Kolize čísla verze nebo souběžně založený překlad – zopakovat celou
      // transakci (po chybě uvnitř ji Postgres stejně zahodí).
      if (isUniqueViolation(e) && attempt < SAVE_MAX_ATTEMPTS) continue;
      if (e instanceof TranslationChangedError) {
        console.warn(
          `[Worker:retranslate] Translation ${documentId}/${language} changed during the job – result discarded`,
        );
      }
      throw e;
    }
  }
}
