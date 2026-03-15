import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { createPipeline } from '@/lib/infrastructure/container.js';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON v těle požadavku' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || !('imageUrl' in body)) {
    return NextResponse.json({ error: 'Chybí povinné pole "imageUrl"' }, { status: 400 });
  }

  const { imageUrl } = body as { imageUrl: string };

  if (typeof imageUrl !== 'string' || imageUrl.trim() === '') {
    return NextResponse.json(
      { error: 'Pole "imageUrl" musí být neprázdný řetězec' },
      { status: 400 },
    );
  }

  // Resolve file path from URL: strip leading slash to get relative path
  const imagePath = imageUrl.replace(/^\//, '');

  let imageBuffer: Buffer;
  try {
    imageBuffer = await fs.readFile(imagePath);
  } catch {
    return NextResponse.json({ error: `Soubor nebyl nalezen: ${imagePath}` }, { status: 400 });
  }

  try {
    const pipeline = createPipeline();
    const result = await pipeline.execute(imageBuffer, imageUrl, 'češtiny');
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Neznámá chyba pipeline';
    console.error('[/api/process] Pipeline error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
