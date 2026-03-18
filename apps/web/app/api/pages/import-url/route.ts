import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import sharp from 'sharp';
import { prisma } from '@/lib/infrastructure/db';
import { LocalStorageProvider } from '@/lib/adapters/storage/local-storage';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp', 'image/gif'];
const MAX_SIZE_MB = parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '20', 10);

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { url, collectionId, displayName } = (body as { url?: string; collectionId?: string; displayName?: string }) ?? {};

  if (typeof url !== 'string' || url.trim() === '') {
    return NextResponse.json({ error: 'Chybí url' }, { status: 400 });
  }

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url.trim());
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: 'URL musí začínat http:// nebo https://' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Neplatná URL' }, { status: 400 });
  }

  // Fetch the image
  let response: Response;
  try {
    response = await fetch(parsedUrl.toString(), {
      headers: { 'User-Agent': 'AiSedlacek/1.0 (manuscript OCR tool)' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Nepodařilo se stáhnout';
    return NextResponse.json({ error: `Stahování selhalo: ${message}` }, { status: 422 });
  }

  if (!response.ok) {
    return NextResponse.json(
      { error: `Server vrátil ${response.status} ${response.statusText}` },
      { status: 422 },
    );
  }

  // Check content type
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!ALLOWED_TYPES.includes(contentType)) {
    return NextResponse.json(
      { error: `Nepodporovaný formát: ${contentType || 'neznámý'}. Povolené: JPEG, PNG, TIFF, WebP` },
      { status: 422 },
    );
  }

  // Read body
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > MAX_SIZE_MB * 1024 * 1024) {
    return NextResponse.json(
      { error: `Obrázek je příliš velký (${(buffer.length / 1024 / 1024).toFixed(1)} MB, max ${MAX_SIZE_MB} MB)` },
      { status: 422 },
    );
  }

  // Deduplicate by hash
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const existing = await prisma.page.findFirst({ where: { hash } });
  if (existing) {
    return NextResponse.json(
      { error: 'Duplicitní obrázek – již existuje v knihovně', existingPageId: existing.id },
      { status: 409 },
    );
  }

  // Extract filename from URL — for IIIF URLs find the page identifier segment
  // e.g. .../ID0009V/full/full/0/default.jpg → ID0009V.jpg
  const pathParts = parsedUrl.pathname.split('/');
  const SKIP_SEGMENTS = new Set(['', 'full', 'default', 'max', 'native', 'color', 'gray', 'bitonal']);
  const ext = (pathParts[pathParts.length - 1] ?? '').match(/\.[a-zA-Z]+$/)?.[0] ?? '.jpg';
  const pageIdSegment = [...pathParts].reverse().find(
    (seg) => !SKIP_SEGMENTS.has(seg.toLowerCase()) && !/^\d$/.test(seg) && !/\.[a-z]{2,4}$/i.test(seg) && /\d/.test(seg),
  );
  const urlFilename = pageIdSegment
    ? decodeURIComponent(pageIdSegment) + ext
    : decodeURIComponent(pathParts[pathParts.length - 1] ?? 'import.jpg');

  // Save to local storage
  const storage = new LocalStorageProvider();
  const storageResult = await storage.upload(buffer, urlFilename);

  // Extract image metadata
  let width: number | undefined;
  let height: number | undefined;
  try {
    const metadata = await sharp(buffer).metadata();
    width = metadata.width;
    height = metadata.height;
  } catch {
    // skip metadata
  }

  // Validate collection
  const resolvedCollectionId =
    typeof collectionId === 'string' && collectionId.trim() !== '' ? collectionId.trim() : null;
  if (resolvedCollectionId) {
    const collection = await prisma.collection.findUnique({ where: { id: resolvedCollectionId } });
    if (!collection) {
      return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
    }
  }

  const page = await prisma.page.create({
    data: {
      filename: urlFilename,
      displayName: typeof displayName === 'string' && displayName.trim() !== '' ? displayName.trim() : urlFilename.replace(/\.[^.]+$/, ''),
      hash,
      imageUrl: storageResult.url,
      collectionId: resolvedCollectionId,
      status: 'pending',
      mimeType: contentType,
      fileSize: buffer.length,
      width,
      height,
    },
  });

  return NextResponse.json({ page }, { status: 201 });
}
