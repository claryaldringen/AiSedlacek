/**
 * Ochrana před duplicitním textovým jobem (dvojklik, dvě záložky): stejná akce
 * nad stejným svazkem či dokumentem, která už čeká ve frontě nebo běží, by se
 * zpracovala (a zaplatila) dvakrát a druhý běh by přepsal výsledek prvního.
 */
import { NextResponse } from 'next/server';
import { prisma } from './db';

type Translator = (key: string, values?: Record<string, string | number>) => string;

type TextJobTarget =
  | { type: 'fix-contexts'; collectionId: string }
  /** Generování kontextu z vybraných stránek – běžící job sledovat jen se stejnými stránkami. */
  | { type: 'generate-context'; collectionId: string; pageIds: string[] }
  /** Překlad kontextu – běžící job sledovat jen se stejným cílovým jazykem. */
  | { type: 'translate-context'; collectionId: string; targetLanguage: string }
  | { type: 'retranslate'; documentId: string; language: string };

/** Stejná množina ID (pořadí ani duplicity nehrají roli – worker stránky řadí sám). */
function sameIdSet(a: unknown[], b: string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...right].every((id) => left.has(id));
}

/**
 * Má běžící job stejné parametry jako požadovaná akce? Generování kontextu
 * z jiných stránek nebo překlad do jiného jazyka by po sledování ukázal výsledek,
 * který uživatel nechtěl. Nečitelný `jobData` se bere jako jiné parametry.
 */
function sameParameters(target: TextJobTarget, jobData: string | null): boolean {
  if (target.type !== 'generate-context' && target.type !== 'translate-context') return true;
  let data: { pageIds?: unknown; targetLanguage?: unknown } | null;
  try {
    data = JSON.parse(jobData ?? '') as typeof data;
  } catch {
    return false;
  }
  if (typeof data !== 'object' || data === null) return false;
  if (target.type === 'translate-context') return data.targetLanguage === target.targetLanguage;
  return Array.isArray(data.pageIds) && sameIdSet(data.pageIds, target.pageIds);
}

/**
 * Najde čekající/běžící job uživatele stejného typu nad stejným cílem
 * (svazek podle `collectionId`, retranslace podle `documentId` a jazyka
 * v `jobData` – retranslace do jiného jazyka nekoliduje).
 *
 * Kontext svazku je jeden: generování nebo překlad kontextu, který už běží
 * s jinými parametry (stránky, cílový jazyk), by souběžný job přepsal. Takový
 * konflikt vrací 409 `job_running_other` bez `jobId` – UI pak cizí job
 * nesleduje (neukázal by výsledek, který uživatel chtěl) a zobrazí hlášku.
 *
 * @returns 409 s `jobId` běžícího jobu se stejnými parametry, 409 bez `jobId`
 *   při jiných parametrech, nebo null, když žádný neběží
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
    select: { id: true, jobData: true },
  });
  if (!job) return null;
  if (!sameParameters(target, job.jobData)) {
    return NextResponse.json(
      { error: t('actionRunningWithOtherParams'), code: 'job_running_other' },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { error: t('actionAlreadyRunning'), code: 'job_running', jobId: job.id },
    { status: 409 },
  );
}
