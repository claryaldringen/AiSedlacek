import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import sharp from 'sharp';
import { prisma } from '@/lib/infrastructure/db';
import { getStorage } from '@/lib/adapters/storage';
import { generateThumbnail } from '@/lib/infrastructure/thumbnails';
import { resolveUserFromToken } from '@/lib/infrastructure/api-auth';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp'];
const MAX_SIZE = parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '20', 10) * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Try API token first, then session
  let userId: string | null = await resolveUserFromToken(
    request.headers.get('authorization'),
  );
  if (!userId) {
    const auth = await getAuthenticatedUserId();
    if (auth.error) return auth.error;
    userId = auth.userId;
  }

  let body: { urls: string[]; collectionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { urls, collectionId } = body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json(
      { error: 'Pole urls je povinné' },
      { status: 400 },
    );
  }

  const storage = getStorage();
  const pages: Array<{ id: string; filename: string; status: string }> = [];
  const errors: Array<{ url: string; error: string }> = [];

  for (const url of urls) {
    try {
      // Validate URL
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push({ url, error: 'Pouze HTTP/HTTPS URL jsou podporovány' });
        continue;
      }

      // Download with timeout
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        errors.push({ url, error: `Server vrátil ${res.status}` });
        continue;
      }

      // Validate content type
      const contentType = res.headers.get('content-type')?.split(';')[0]?.trim();
      if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
        errors.push({ url, error: `Nepodporovaný typ: ${contentType}` });
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());

      // Validate size
      if (buffer.length > MAX_SIZE) {
        errors.push({
          url,
          error: `Soubor je příliš velký (${Math.round(buffer.length / 1024 / 1024)} MB)`,
        });
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

      // Extract filename from URL
      const filename = decodeURIComponent(
        parsed.pathname.split('/').pop() || 'image.jpg',
      );

      // Store
      const stored = await storage.upload(buffer, filename);

      // Get dimensions
      const meta = await sharp(buffer).metadata();

      // Generate thumbnail
      let thumbnailUrl: string | null = null;
      try {
        thumbnailUrl = await generateThumbnail(buffer, filename);
      } catch {
        // Non-critical
      }

      // Create page
      const page = await prisma.page.create({
        data: {
          userId,
          collectionId: collectionId ?? null,
          filename,
          hash,
          imageUrl: stored.url,
          thumbnailUrl,
          status: 'pending',
          mimeType: contentType,
          fileSize: buffer.length,
          width: meta.width ?? null,
          height: meta.height ?? null,
        },
      });

      pages.push({ id: page.id, filename: page.filename, status: page.status });
    } catch (e: unknown) {
      errors.push({ url, error: e instanceof Error ? e.message : 'Neznámá chyba' });
    }
  }

  return NextResponse.json({ pages, errors });
}
