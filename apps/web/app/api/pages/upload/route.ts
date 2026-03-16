import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import sharp from 'sharp';
import { prisma } from '@/lib/infrastructure/db';
import { LocalStorageProvider } from '@/lib/adapters/storage/local-storage';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp'];
const MAX_SIZE_MB = parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '20', 10);

export async function POST(request: NextRequest): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Neplatný formData' }, { status: 400 });
  }

  const collectionId = formData.get('collectionId');
  const resolvedCollectionId =
    typeof collectionId === 'string' && collectionId.trim() !== '' ? collectionId.trim() : null;

  const files = formData.getAll('files');
  if (files.length === 0) {
    return NextResponse.json({ error: 'Nebyl nahrán žádný soubor' }, { status: 400 });
  }

  const storage = new LocalStorageProvider();
  const created = [];
  const errors: { filename: string; error: string }[] = [];

  for (const entry of files) {
    if (!(entry instanceof Blob)) {
      errors.push({ filename: 'unknown', error: 'Neplatný soubor' });
      continue;
    }

    const file = entry as File;
    const filename = file.name ?? 'upload';

    if (!ALLOWED_TYPES.includes(file.type)) {
      errors.push({
        filename,
        error: 'Nepodporovaný formát. Povolené: JPEG, PNG, TIFF, WebP',
      });
      continue;
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      errors.push({ filename, error: `Soubor je příliš velký (max ${MAX_SIZE_MB} MB)` });
      continue;
    }

    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');

      // Check for duplicate by hash
      const existing = await prisma.page.findFirst({ where: { hash } });
      if (existing) {
        // If assigning to a collection and existing page isn't in one, update it
        if (resolvedCollectionId && !existing.collectionId) {
          await prisma.page.update({
            where: { id: existing.id },
            data: { collectionId: resolvedCollectionId },
          });
        }
        errors.push({ filename, error: 'Duplicitní obrázek – již existuje v knihovně' });
        continue;
      }

      const storageResult = await storage.upload(buffer, filename);

      // Verify collection exists if provided
      if (resolvedCollectionId !== null) {
        const collection = await prisma.collection.findUnique({
          where: { id: resolvedCollectionId },
        });
        if (!collection) {
          errors.push({ filename, error: `Svazek ${resolvedCollectionId} nenalezen` });
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
          filename,
          hash,
          imageUrl: storageResult.url,
          collectionId: resolvedCollectionId,
          status: 'pending',
          mimeType: file.type,
          fileSize: buffer.length,
          width,
          height,
        },
      });

      created.push(page);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Neznámá chyba';
      errors.push({ filename, error: message });
    }
  }

  return NextResponse.json({ pages: created, errors }, { status: 201 });
}
