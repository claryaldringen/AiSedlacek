import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/infrastructure/db';
import { getStorage } from '@/lib/adapters/storage';
import { saveThumbnail } from '@/lib/infrastructure/thumbnails';
import {
  InvalidImageError,
  invalidImageMessage,
  validateImage,
  type ValidatedImage,
} from '@/lib/infrastructure/image-validation';
import { resolveUserId } from '@/lib/infrastructure/auth-utils';
import { getOwnedCollection } from '@/lib/infrastructure/authz';
import { safeFetch, readBodyWithLimit } from '@/lib/infrastructure/safe-fetch';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';
import { withSharpLimit } from '@/lib/infrastructure/sharp-limit';

const MAX_SIZE = parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '20', 10) * 1024 * 1024;
// URL se stahují sekvenčně v jednom requestu (každá až 30 s a 20 MB) – strop
// drží délku requestu i počet dekódování obrázků v rozumných mezích. CLI ≥ 0.2.0
// posílá po 50; staré CLI posílá všechny URL najednou – 200 ho u běžných svazků
// nerozbije.
const MAX_URLS_PER_REQUEST = 200;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await resolveUserId(request);
  if (auth.error) return auth.error;
  const { userId } = auth;

  let body: { urls?: unknown; collectionId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { urls, collectionId } = body ?? {};

  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: 'Pole urls je povinné' }, { status: 400 });
  }
  if (urls.length > MAX_URLS_PER_REQUEST) {
    return NextResponse.json(
      { error: t('tooManyUrls', { max: MAX_URLS_PER_REQUEST }) },
      { status: 400 },
    );
  }
  if (!urls.every((url): url is string => typeof url === 'string')) {
    return NextResponse.json({ error: t('invalidUrl') }, { status: 400 });
  }

  const resolvedCollectionId =
    typeof collectionId === 'string' && collectionId.trim() !== '' ? collectionId.trim() : null;
  if (resolvedCollectionId !== null && !(await getOwnedCollection(userId, resolvedCollectionId))) {
    return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
  }

  const storage = getStorage();
  const pages: Array<{ id: string; filename: string; status: string }> = [];
  const errors: Array<{ url: string; error: string }> = [];

  for (const url of urls) {
    try {
      // Validate URL + download with SSRF protection and a streamed size cap.
      const parsed = new URL(url);

      const res = await safeFetch(url, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        errors.push({ url, error: `Server vrátil ${res.status}` });
        continue;
      }

      let buffer: Buffer;
      try {
        buffer = await readBodyWithLimit(res, MAX_SIZE);
      } catch {
        errors.push({
          url,
          error: `Soubor je příliš velký (max ${Math.round(MAX_SIZE / 1024 / 1024)} MB)`,
        });
        continue;
      }

      // Format is detected from the content, never from Content-Type (SEC-1).
      let image: ValidatedImage;
      try {
        image = await withSharpLimit(() => validateImage(buffer));
      } catch (err) {
        if (!(err instanceof InvalidImageError)) throw err;
        errors.push({ url, error: invalidImageMessage(err, t) });
        continue;
      }

      // Hash for dedup
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const existing = await prisma.page.findFirst({
        where: { hash, userId },
      });
      if (existing) {
        errors.push({ url, error: `Duplikát (existuje jako stránka ${existing.id})` });
        continue;
      }

      // Display filename from URL – the file on disk is `<uuid>.<detected extension>`
      const filename = decodeURIComponent(parsed.pathname.split('/').pop() || 'image.jpg');

      const stored = await storage.upload(buffer, image.extension);
      const thumbnailUrl = await saveThumbnail(image.thumbnail);

      // Create page
      const page = await prisma.page.create({
        data: {
          userId,
          collectionId: resolvedCollectionId,
          filename,
          hash,
          imageUrl: stored.url,
          thumbnailUrl,
          status: 'pending',
          mimeType: image.mimeType,
          fileSize: buffer.length,
          width: image.width,
          height: image.height,
        },
      });

      pages.push({ id: page.id, filename: page.filename, status: page.status });
    } catch (e: unknown) {
      errors.push({ url, error: e instanceof Error ? e.message : 'Neznámá chyba' });
    }
  }

  return NextResponse.json({ pages, errors });
}
