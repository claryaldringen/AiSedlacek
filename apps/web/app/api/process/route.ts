import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { createPipeline } from '@/lib/infrastructure/container';
import { SharpPreprocessor } from '@/lib/adapters/preprocessing/sharp';
import { LocalStorageProvider } from '@/lib/adapters/storage/local-storage';

function sendEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  event: string,
  data: unknown,
): void {
  controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Neplatný JSON v těle požadavku' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || !('imageUrl' in body)) {
    return Response.json({ error: 'Chybí povinné pole "imageUrl"' }, { status: 400 });
  }

  const { imageUrl } = body as { imageUrl: string };

  if (typeof imageUrl !== 'string' || imageUrl.trim() === '') {
    return Response.json({ error: 'Pole "imageUrl" musí být neprázdný řetězec' }, { status: 400 });
  }

  const filename = imageUrl.replace(/^\/api\/images\//, '');
  const imagePath = `tmp/uploads/${filename}`;

  let imageBuffer: Buffer;
  try {
    imageBuffer = await fs.readFile(imagePath);
  } catch {
    return Response.json({ error: `Soubor nebyl nalezen: ${imagePath}` }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        sendEvent(controller, encoder, 'progress', {
          step: 'preprocessing',
          message: 'Předzpracování obrázku…',
          progress: 10,
        });

        const preprocessor = new SharpPreprocessor();
        const preprocessedBuffer = await preprocessor.process(imageBuffer);
        const storage = new LocalStorageProvider();
        const { url: preprocessedUrl } = await storage.upload(preprocessedBuffer, 'preprocessed.png');

        sendEvent(controller, encoder, 'progress', {
          step: 'ocr',
          message: 'Zpracovávám text (Claude Opus 4.6)…',
          progress: 30,
        });

        const pipeline = createPipeline();
        const result = await pipeline.execute(imageBuffer, imageUrl);
        result.preprocessedImage = preprocessedUrl;

        sendEvent(controller, encoder, 'progress', {
          step: 'done',
          message: 'Hotovo',
          progress: 100,
        });

        sendEvent(controller, encoder, 'result', result);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Neznámá chyba';
        console.error('[/api/process] Error:', message);
        sendEvent(controller, encoder, 'error', { error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
