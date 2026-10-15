/**
 * Návrat stavu stránek po nedokončeném zpracování.
 */

import { prisma } from '@ai-sedlacek/db';

/**
 * Vrátí stránky, které job nedokončil (`processing`), do výchozího stavu a smaže
 * u nich `errorMessage`. Stránka s dokumentem (např. přerušená regenerace, DAT-1)
 * se vrací do `done` – dokument je nedotčený a v `pending` by ji běžné zpracování
 * už nikdy nevzalo (přeskočí ji jako hotovou). Stránka bez dokumentu jde do `pending`.
 *
 * @returns počet stránek, kterým se změnil stav
 */
export async function resetUnfinishedPages(pageIds: string[]): Promise<number> {
  if (pageIds.length === 0) return 0;
  const withDocument = await prisma.page.updateMany({
    where: { id: { in: pageIds }, status: 'processing', document: { isNot: null } },
    data: { status: 'done', errorMessage: null },
  });
  const withoutDocument = await prisma.page.updateMany({
    where: { id: { in: pageIds }, status: 'processing' },
    data: { status: 'pending', errorMessage: null },
  });
  return withDocument.count + withoutDocument.count;
}

/**
 * Zapíše stav zpracování stránky – jen pokud ji uživatel mezitím nearchivoval
 * („smazal"). Worker zpracovává dávku minuty; archivace během té doby má
 * přednost, jinak by se smazaná stránka vrátila a ve veřejném svazku se znovu
 * zveřejnila.
 *
 * @returns true, pokud se stav zapsal
 */
export async function setPageStatus(
  pageId: string,
  status: 'pending' | 'processing' | 'done' | 'error',
  errorMessage: string | null = null,
): Promise<boolean> {
  const { count } = await prisma.page.updateMany({
    where: { id: pageId, status: { not: 'archived' } },
    data: { status, errorMessage },
  });
  return count > 0;
}
