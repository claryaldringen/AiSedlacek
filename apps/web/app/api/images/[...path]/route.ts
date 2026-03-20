import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getStorage, isRemoteStorage } from '@/lib/adapters/storage';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  // In Vercel Blob mode, images are served directly from CDN – this route is not used.
  if (isRemoteStorage()) {
    return NextResponse.json(
      { error: 'Obrázky jsou servírovány přímo z R2 CDN' },
      { status: 404 },
    );
  }

  const segments = (await params).path;
  const filePath = segments.join('/');

  try {
    const storage = getStorage();
    const buffer = await storage.read(filePath);

    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : 'application/octet-stream';

    return new NextResponse(new Uint8Array(buffer), {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' },
    });
  } catch {
    return NextResponse.json({ error: 'Soubor nenalezen' }, { status: 404 });
  }
}
