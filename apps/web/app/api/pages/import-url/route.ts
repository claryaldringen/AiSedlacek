import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import sharp from 'sharp';
import { prisma } from '@/lib/infrastructure/db';
import { getStorage } from '@/lib/adapters/storage';
import { generateThumbnail } from '@/lib/infrastructure/thumbnails';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getOrWait } from '@/lib/infrastructure/prefetch-cache';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp', 'image/gif'];
const MAX_SIZE_MB = parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '20', 10);

// Semaphore to limit concurrent sharp operations (sharp uses a fixed-size libuv thread pool)
let sharpInFlight = 0;
const SHARP_MAX_CONCURRENT = 3;
const sharpQueue: Array<() => void> = [];

async function withSharpLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (sharpInFlight >= SHARP_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => sharpQueue.push(resolve));
  }
  sharpInFlight++;
  try {
    return await fn();
  } finally {
    sharpInFlight--;
    sharpQueue.shift()?.();
  }
}

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
  let contentType: string;
  let contentDisposition: string;

  if (cached) {
    buffer = cached.buffer;
    contentType = cached.contentType;
    contentDisposition = cached.contentDisposition;
  } else {
    let response: Response;
    try {
      response = await fetch(parsedUrl.toString(), {
        headers: { 'User-Agent': 'AiSedlacek/1.0 (manuscript OCR tool)' },
        signal: AbortSignal.timeout(60000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `Stahování selhalo: ${message}` }, { status: 422 });
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Server vrátil ${response.status} ${response.statusText}` },
        { status: 422 },
      );
    }

    contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    contentDisposition = response.headers.get('content-disposition') ?? '';
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  }

  // Check content type
  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json(
      {
        error: t('unsupportedFormatWithType', { type: contentType || 'unknown' }),
      },
      { status: 422 },
    );
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

  // Deduplicate by hash
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const existing = await prisma.page.findFirst({ where: { hash, userId } });
  if (existing) {
    return NextResponse.json(
      { error: t('duplicateImage'), existingPageId: existing.id },
      { status: 409 },
    );
  }

  // Extract filename — priority:
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

  // Save to local storage + run sharp operations with concurrency limit
  const storage = getStorage();
  const storageResult = await storage.upload(buffer, urlFilename);

  const [thumbnailUrl, detectedBlank, dimensions] = await withSharpLimit(async () => {
    const thumb = await generateThumbnail(buffer, urlFilename);
    const { isBlankPage } = await import('@/lib/infrastructure/blank-detection');
    const blank = await isBlankPage(buffer);
    let w: number | undefined;
    let h: number | undefined;
    try {
      const metadata = await sharp(buffer).metadata();
      w = metadata.width;
      h = metadata.height;
    } catch {
      // skip metadata
    }
    return [thumb, blank, { width: w, height: h }] as const;
  });

  // Validate collection
  const resolvedCollectionId =
    typeof collectionId === 'string' && collectionId.trim() !== '' ? collectionId.trim() : null;
  if (resolvedCollectionId) {
    const collection = await prisma.collection.findUnique({ where: { id: resolvedCollectionId } });
    if (!collection) {
      return NextResponse.json({ error: t('collectionNotFound') }, { status: 404 });
    }
  }

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
      mimeType: contentType,
      fileSize: buffer.length,
      width: dimensions.width,
      height: dimensions.height,
      order: nextOrder,
    },
  });

  return NextResponse.json({ page }, { status: 201 });
}
