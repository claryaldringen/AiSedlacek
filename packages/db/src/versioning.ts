import { prisma } from './client';

const MAX_RETRIES = 5;

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code: unknown }).code === 'P2002'
  );
}

/**
 * Append a new version row, allocating the next version number per document.
 *
 * The version number is read-modify-write, so concurrent writers (e.g. a web
 * PATCH and the worker's auto-retranslate writing to the same document) can
 * compute the same next value and collide on @@unique([documentId, version]).
 * Rather than letting that surface as a 500 that silently drops the edit, we
 * retry: the loser re-reads the now-higher max and takes the next free slot.
 */
export async function createVersion(
  documentId: string,
  field: string,
  content: string,
  source: string,
  model?: string,
): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const lastVersion = await prisma.documentVersion.findFirst({
      where: { documentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const nextVersion = (lastVersion?.version ?? 0) + 1;

    try {
      await prisma.documentVersion.create({
        data: {
          documentId,
          version: nextVersion,
          field,
          content,
          source,
          model,
        },
      });
      return;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < MAX_RETRIES - 1) {
        continue; // another writer took this version number — retry
      }
      throw e;
    }
  }
}
