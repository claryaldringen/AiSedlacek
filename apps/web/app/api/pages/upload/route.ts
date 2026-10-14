import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/infrastructure/db';
import { getStorage } from '@/lib/adapters/storage';
import { saveThumbnail } from '@/lib/infrastructure/thumbnails';
import {
  InvalidImageError,
  invalidImageMessage,
  isReusableStoredImageUrl,
  validateImage,
  type ValidatedImage,
} from '@/lib/infrastructure/image-validation';
import { resolveUserId } from '@/lib/infrastructure/auth-utils';
import { getOwnedCollection } from '@/lib/infrastructure/authz';
import { naturalCompare } from '@/lib/infrastructure/natural-sort';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

const MAX_SIZE_MB = parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '20', 10);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await resolveUserId(request);
  if (auth.error) return auth.error;
  const { userId } = auth;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: t('invalidFormData') }, { status: 400 });
  }

  const collectionId = formData.get('collectionId');
  const resolvedCollectionId =
    typeof collectionId === 'string' && collectionId.trim() !== '' ? collectionId.trim() : null;

  // Verify collection ownership up front (covers both the create and the dedup
  // "move existing page" branch below) to prevent cross-tenant injection.
  if (resolvedCollectionId !== null && !(await getOwnedCollection(userId, resolvedCollectionId))) {
    return NextResponse.json({ error: t('collectionNotFound') }, { status: 404 });
  }

  const files = formData.getAll('files');
  if (files.length === 0) {
    return NextResponse.json({ error: t('noFile') }, { status: 400 });
  }

  const storage = getStorage();
  const created = [];
  const errors: { filename: string; error: string }[] = [];

  for (const entry of files) {
    if (!(entry instanceof Blob)) {
      errors.push({ filename: 'unknown', error: t('invalidFile') });
      continue;
    }

    const file = entry as File;
    // Client filename is kept for display only – it never reaches the disk.
    const filename = file.name ?? 'upload';

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      errors.push({ filename, error: t('fileTooLarge', { max: MAX_SIZE_MB }) });
      continue;
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());

      // Format is detected from the content, never from file.type (SEC-1).
      let image: ValidatedImage;
      try {
        image = await validateImage(buffer);
      } catch (err) {
        if (!(err instanceof InvalidImageError)) throw err;
        errors.push({ filename, error: invalidImageMessage(err, t) });
        continue;
      }

      const hash = crypto.createHash('sha256').update(buffer).digest('hex');

      // Check for duplicate by hash (scoped to user)
      const existing = await prisma.page.findFirst({ where: { hash, userId } });
      if (existing) {
        // If assigning to a collection and existing page isn't in one, update it
        if (resolvedCollectionId && !existing.collectionId) {
          await prisma.page.update({
            where: { id: existing.id },
            data: { collectionId: resolvedCollectionId },
          });
        }
        errors.push({ filename, error: t('duplicateImage') });
        continue;
      }

      // Cross-user dedup: reuse storage file if any user already uploaded this hash,
      // but only if it is stored under an image extension (files stored before
      // content validation may carry the client's extension, e.g. .html).
      const existingGlobal = await prisma.page.findFirst({
        where: { hash },
        select: { imageUrl: true },
      });

      const imageUrl =
        existingGlobal && isReusableStoredImageUrl(existingGlobal.imageUrl)
          ? existingGlobal.imageUrl
          : (await storage.upload(buffer, image.extension)).url;
      const thumbnailUrl = await saveThumbnail(image.thumbnail);

      // Detect blank pages (parchment without writing)
      const { isBlankPage } = await import('@/lib/infrastructure/blank-detection');
      const detectedBlank = await isBlankPage(buffer);

      const page = await prisma.page.create({
        data: {
          userId,
          filename,
          hash,
          imageUrl,
          thumbnailUrl,
          collectionId: resolvedCollectionId,
          status: detectedBlank ? 'blank' : 'pending',
          mimeType: image.mimeType,
          fileSize: buffer.length,
          width: image.width,
          height: image.height,
        },
      });

      created.push(page);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('serverError');
      errors.push({ filename, error: message });
    }
  }

  // Auto-set order for created pages using natural sort by filename
  if (created.length > 0 && resolvedCollectionId) {
    const maxOrderResult = await prisma.page.aggregate({
      where: { collectionId: resolvedCollectionId, id: { notIn: created.map((p) => p.id) } },
      _max: { order: true },
    });
    const startOrder = (maxOrderResult._max.order ?? -1) + 1;

    const sorted = [...created].sort((a, b) => naturalCompare(a.filename, b.filename));
    for (let i = 0; i < sorted.length; i++) {
      await prisma.page.update({
        where: { id: sorted[i]!.id },
        data: { order: startOrder + i },
      });
    }
  }

  return NextResponse.json({ pages: created, errors }, { status: 201 });
}
