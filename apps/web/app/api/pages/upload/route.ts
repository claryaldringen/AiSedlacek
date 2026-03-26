import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import sharp from 'sharp';
import { prisma } from '@/lib/infrastructure/db';
import { getStorage } from '@/lib/adapters/storage';
import { generateThumbnail } from '@/lib/infrastructure/thumbnails';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { naturalCompare } from '@/lib/infrastructure/natural-sort';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp'];
const MAX_SIZE_MB = parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '20', 10);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
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
    const filename = file.name ?? 'upload';

    if (!ALLOWED_TYPES.includes(file.type)) {
      errors.push({
        filename,
        error: t('unsupportedFormat'),
      });
      continue;
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      errors.push({ filename, error: t('fileTooLarge', { max: MAX_SIZE_MB }) });
      continue;
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
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

      // Cross-user dedup: reuse storage file if any user already uploaded this hash
      const existingGlobal = await prisma.page.findFirst({
        where: { hash },
        select: { imageUrl: true },
      });

      const storageResult = existingGlobal
        ? { url: existingGlobal.imageUrl }
        : await storage.upload(buffer, filename);
      const thumbnailUrl = await generateThumbnail(buffer, filename);

      // Detect blank pages (parchment without writing)
      const { isBlankPage } = await import('@/lib/infrastructure/blank-detection');
      const detectedBlank = await isBlankPage(buffer);

      // Verify collection exists if provided
      if (resolvedCollectionId !== null) {
        const collection = await prisma.collection.findUnique({
          where: { id: resolvedCollectionId },
        });
        if (!collection) {
          errors.push({ filename, error: t('collectionNotFound') });
          continue;
        }
      }

      // Extract image metadata
      let width: number | undefined;
      let height: number | undefined;
      try {
        const metadata = await sharp(buffer).metadata();
        width = metadata.width;
        height = metadata.height;
      } catch {
        // not a valid image for sharp – skip metadata
      }

      const page = await prisma.page.create({
        data: {
          userId,
          filename,
          hash,
          imageUrl: storageResult.url,
          thumbnailUrl,
          collectionId: resolvedCollectionId,
          status: detectedBlank ? 'blank' : 'pending',
          mimeType: file.type,
          fileSize: buffer.length,
          width,
          height,
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
