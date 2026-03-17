import { prisma } from './db';

export async function createVersion(
  documentId: string,
  field: string,
  content: string,
  source: string,
  model?: string,
): Promise<void> {
  // Get next version number
  const lastVersion = await prisma.documentVersion.findFirst({
    where: { documentId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });

  const nextVersion = (lastVersion?.version ?? 0) + 1;

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
}
