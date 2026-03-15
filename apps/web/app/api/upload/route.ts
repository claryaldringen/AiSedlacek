import { NextRequest, NextResponse } from 'next/server';
import { LocalStorageProvider } from '@/lib/adapters/storage/local-storage.js';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'Soubor nebyl nahrán' }, { status: 400 });
  }

  const maxSizeMb = parseInt(process.env['MAX_FILE_SIZE_MB'] ?? '20', 10);
  if (file.size > maxSizeMb * 1024 * 1024) {
    return NextResponse.json(
      { error: `Soubor je příliš velký (max ${maxSizeMb} MB)` },
      { status: 400 },
    );
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: 'Nepodporovaný formát. Povolené: JPEG, PNG, TIFF, WebP' },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const storage = new LocalStorageProvider();
  const result = await storage.upload(buffer, (file as File).name);

  return NextResponse.json({ url: result.url, path: result.path });
}
