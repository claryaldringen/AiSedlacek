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
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getOwnedCollection } from '@/lib/infrastructure/authz';
import { safeFetch, readBodyWithLimit } from '@/lib/infrastructure/safe-fetch';
import { getOrWait } from '@/lib/infrastructure/prefetch-cache';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';
import { withSharpLimit } from '@/lib/infrastructure/sharp-limit';

const MAX_SIZE_MB = parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '20', 10);

export async function POST(request: NextRequest): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  const { url, collectionId, displayName } =
    (body as { url?: string; collectionId?: string; displayName?: string }) ?? {};

  if (typeof url !== 'string' || url.trim() === '') {
    return NextResponse.json({ error: t('missingUrl') }, { status: 400 });
  }

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.trim());
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: t('urlMustBeHttp') }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: t('invalidUrl') }, { status: 400 });
  }

  try {
    return await handleImport(parsedUrl, userId, collectionId, displayName, t);
  } catch (err) {
    console.error('[import-url] Unhandled error for URL:', parsedUrl.toString());
    console.error('[import-url] Error:', err instanceof Error ? err.stack : err);
    const message = err instanceof Error ? err.message : t('serverError');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleImport(
  parsedUrl: URL,
  userId: string,
  collectionId: unknown,
  displayName: unknown,
  t: Awaited<ReturnType<typeof getApiTranslations>>,
): Promise<NextResponse> {
  // Try prefetch cache first, fall back to fresh download
  const cached = await getOrWait(parsedUrl.toString());
  let buffer: Buffer;
  let contentDisposition: string;

  if (cached) {
    buffer = cached.buffer;
    contentDisposition = cached.contentDisposition;
  } else {
    let response: Response;
    try {
      response = await safeFetch(parsedUrl.toString(), {
        headers: { 'User-Agent': 'AiSedlacek/1.0 (manuscript OCR tool)' },
        signal: AbortSignal.timeout(60000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `Stahování selhalo: ${message}` }, { status: 422 });
    }

    if (!response.ok) {
      // Don't echo upstream statusText — it can leak details of internal services.
      return NextResponse.json({ error: `Server vrátil ${response.status}` }, { status: 422 });
    }

    contentDisposition = response.headers.get('content-disposition') ?? '';
    try {
      buffer = await readBodyWithLimit(response, MAX_SIZE_MB * 1024 * 1024);
    } catch {
      return NextResponse.json(
        { error: t('imageTooLarge', { size: `>${MAX_SIZE_MB}`, max: MAX_SIZE_MB }) },
        { status: 422 },
      );
    }
  }

  if (buffer.length > MAX_SIZE_MB * 1024 * 1024) {
    return NextResponse.json(
      {
        error: t('imageTooLarge', {
          size: (buffer.length / 1024 / 1024).toFixed(1),
          max: MAX_SIZE_MB,
        }),
      },
      { status: 422 },
    );
  }

  // Format is detected from the content – the remote Content-Type and
  // Content-Disposition are not trusted (SEC-1). Decoding runs under the sharp
  // concurrency limit.
  let image: ValidatedImage;
  try {
    image = await withSharpLimit(() => validateImage(buffer, { allowGif: true }));
  } catch (err) {
    if (!(err instanceof InvalidImageError)) throw err;
    return NextResponse.json({ error: invalidImageMessage(err, t) }, { status: 422 });
  }

  // Deduplicate by hash
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const existing = await prisma.page.findFirst({ where: { hash, userId } });
  if (existing) {
    return NextResponse.json(
      { error: t('duplicateImage'), existingPageId: existing.id },
      { status: 409 },
    );
  }

  // Display filename only (stored as Page.filename) – the file on disk is
  // always named `<uuid>.<detected extension>`. Priority:
  // 1. Content-Disposition header (e.g. "4360-110814-0004r.jpg" from esbirky.cz)
  // 2. IIIF path segment (e.g. .../ID0009V/full/full/0/default.jpg → ID0009V.jpg)
  // 3. Query parameter fallback (e.g. ?id=180462 → 180462.jpg)
  // 4. Last path segment
  const cdMatch = contentDisposition.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i);
  const cdFilename = cdMatch ? decodeURIComponent(cdMatch[1]!.trim()) : null;

  const pathParts = parsedUrl.pathname.split('/');
  const SKIP_SEGMENTS = new Set([
    '',
    'full',
    'default',
    'max',
    'native',
    'color',
    'gray',
    'bitonal',
  ]);
  const lastSegment = pathParts[pathParts.length - 1] ?? '';
  const ext = lastSegment.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? '.jpg';

  // IIIF Image API: {prefix}/{identifier}/{region}/{size}/{rotation}/{quality}.{format}
  // Detect by finding the region segment (full, square, or pixel coordinates)
  const iiifRegionIdx = pathParts.findIndex(
    (seg) => seg === 'full' || seg === 'square' || /^\d+,\d+,\d+,\d+$/.test(seg),
  );
  const iiifIdentifier =
    iiifRegionIdx > 0 ? decodeURIComponent(pathParts[iiifRegionIdx - 1]!) : null;

  // Prefer the actual filename (last segment) if it contains a number
  const filenameHasNumber = /\d/.test(lastSegment) && /\.[a-z0-9]{2,4}$/i.test(lastSegment);
  const pageIdSegment = filenameHasNumber
    ? null // skip path scan, use filename directly
    : [...pathParts]
        .reverse()
        .find(
          (seg) =>
            !SKIP_SEGMENTS.has(seg.toLowerCase()) &&
            !/^\d$/.test(seg) &&
            !/\.[a-z]{2,4}$/i.test(seg) &&
            /\d/.test(seg),
        );
  let urlFilename: string;
  if (cdFilename) {
    urlFilename = cdFilename;
  } else if (iiifIdentifier) {
    // Use IIIF identifier, stripping any original extension (e.g. .JP2)
    urlFilename = iiifIdentifier.replace(/\.[^.]+$/, '') + ext;
  } else if (filenameHasNumber) {
    urlFilename = decodeURIComponent(lastSegment);
  } else if (pageIdSegment) {
    urlFilename = decodeURIComponent(pageIdSegment) + ext;
  } else {
    // Try query parameters — use first numeric param value as filename
    let queryId: string | null = null;
    for (const [, value] of parsedUrl.searchParams) {
      if (/^\d+$/.test(value) && value.length >= 2) {
        queryId = value;
        break;
      }
    }
    urlFilename = queryId
      ? queryId + ext
      : decodeURIComponent(pathParts[pathParts.length - 1] ?? 'import.jpg');
  }

  // Validate collection before anything is written to storage
  const resolvedCollectionId =
    typeof collectionId === 'string' && collectionId.trim() !== '' ? collectionId.trim() : null;
  if (resolvedCollectionId && !(await getOwnedCollection(userId, resolvedCollectionId))) {
    return NextResponse.json({ error: t('collectionNotFound') }, { status: 404 });
  }

  const storage = getStorage();
  const storageResult = await storage.upload(buffer, image.extension);
  const thumbnailUrl = await saveThumbnail(image.thumbnail);
  const detectedBlank = await withSharpLimit(async () => {
    const { isBlankPage } = await import('@/lib/infrastructure/blank-detection');
    return isBlankPage(buffer);
  });

  // Determine next order value for the collection
  let nextOrder: number | undefined;
  if (resolvedCollectionId) {
    const maxOrderResult = await prisma.page.aggregate({
      where: { collectionId: resolvedCollectionId },
      _max: { order: true },
    });
    nextOrder = (maxOrderResult._max.order ?? -1) + 1;
  }

  const page = await prisma.page.create({
    data: {
      userId,
      filename: urlFilename,
      displayName:
        typeof displayName === 'string' && displayName.trim() !== ''
          ? displayName.trim()
          : cdFilename
            ? cdFilename.replace(/\.[^.]+$/, '')
            : urlFilename.replace(/\.[^.]+$/, ''),
      hash,
      imageUrl: storageResult.url,
      thumbnailUrl,
      collectionId: resolvedCollectionId,
      status: detectedBlank ? 'blank' : 'pending',
      mimeType: image.mimeType,
      fileSize: buffer.length,
      width: image.width,
      height: image.height,
      order: nextOrder,
    },
  });

  return NextResponse.json({ page }, { status: 201 });
}
