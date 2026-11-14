/**
 * Ochrana před duplicitním textovým jobem (dvojklik, dvě záložky): stejná akce
 * nad stejným svazkem či dokumentem, která už čeká ve frontě nebo běží, by se
 * zpracovala (a zaplatila) dvakrát a druhý běh by přepsal výsledek prvního.
 */
import { NextResponse } from 'next/server';
import { prisma } from './db';

type Translator = (key: string, values?: Record<string, string | number>) => string;

type TextJobTarget =
  | { type: 'generate-context' | 'translate-context' | 'fix-contexts'; collectionId: string }
  | { type: 'retranslate'; documentId: string; language: string };

/**
 * Najde čekající/běžící job uživatele stejného typu nad stejným cílem
 * (svazek podle `collectionId`, retranslace podle `documentId` a jazyka
 * v `jobData` – retranslace do jiného jazyka nekoliduje).
 *
 * @returns 409 s `jobId` běžícího jobu, nebo null, když žádný neběží
 */
export async function runningJobConflict(
  t: Translator,
  userId: string,
  target: TextJobTarget,
): Promise<NextResponse | null> {
  const job = await prisma.processingJob.findFirst({
    where: {
      userId,
      type: target.type,
      status: { in: ['queued', 'running'] },
      ...('collectionId' in target
        ? { collectionId: target.collectionId }
        : // jobData retranslace je JSON.stringify({ documentId, language, … }) – ID
          // dokumentu je ověřené (existuje a patří uživateli) a jazyk z whitelistu
          {
            AND: [
              { jobData: { contains: `"documentId":${JSON.stringify(target.documentId)}` } },
              { jobData: { contains: `"language":${JSON.stringify(target.language)}` } },
            ],
          }),
    },
    select: { id: true },
  });
  if (!job) return null;
  return NextResponse.json(
    { error: t('actionAlreadyRunning'), code: 'job_running', jobId: job.id },
    { status: 409 },
  );
}
