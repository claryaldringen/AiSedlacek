import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/infrastructure/db';
import { createVersion } from '@/lib/infrastructure/versioning';
import { requireUserId } from '@/lib/auth';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * SSE endpoint: for each document in the collection, refine its context
 * by comparing it with the collection-level context and producing a
 * document-specific context that doesn't repeat general work info.
 */
export async function POST(_request: NextRequest, { params }: RouteContext): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return Response.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const { id } = await params;

  const collection = await prisma.collection.findUnique({
    where: { id },
    include: {
      pages: {
        where: { status: 'done' },
        include: {
          document: { select: { id: true, context: true, transcription: true } },
        },
        orderBy: { order: 'asc' },
      },
    },
  });

  if (!collection || collection.userId !== userId) {
    return Response.json({ error: 'Svazek nenalezen' }, { status: 404 });
  }

  if (!collection.context) {
    return Response.json({ error: 'Svazek nemá kontext' }, { status: 422 });
  }

  const documents = collection.pages.filter((p) => p.document !== null).map((p) => p.document!);

  if (documents.length === 0) {
    return Response.json({ error: 'Žádné zpracované dokumenty' }, { status: 422 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>): void => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const client = new Anthropic();
      let completed = 0;

      for (const doc of documents) {
        send('progress', {
          documentId: doc.id,
          message: `Opravuji kontext (${completed + 1}/${documents.length})…`,
          progress: Math.round((completed / documents.length) * 100),
        });

        try {
          const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
            messages: [
              {
                role: 'user',
                content: `Máš k dispozici kontext celého díla (svazku) a kontext jednoho konkrétního dokumentu (stránky) z tohoto díla. Kontext dokumentu byl vytvořen bez znalosti kontextu díla a může obsahovat obecné informace o díle, které patří spíše do kontextu svazku.

Tvým úkolem je přepsat kontext dokumentu tak, aby:
1. Neobsahoval informace, které už jsou v kontextu díla (neopakuj je)
2. Obsahoval pouze informace specifické pro tuto konkrétní stránku/folium
3. Pokud je to relevantní, zmínil co je na této stránce (typ obsahu, zajímavosti)
4. Byl stručný a konkrétní

Pokud dokument nemá žádné specifické informace navíc oproti kontextu díla, vrať krátkou větu popisující obsah stránky na základě transkripce.

=== KONTEXT DÍLA (svazku) ===
${collection.context}

=== AKTUÁLNÍ KONTEXT DOKUMENTU ===
${doc.context}

=== TRANSKRIPCE DOKUMENTU (pro orientaci) ===
${doc.transcription.slice(0, 2000)}

Vrať POUZE nový kontext dokumentu v markdown, bez komentáře.`,
              },
            ],
          });

          const newContext = response.content[0]?.type === 'text' ? response.content[0].text : '';

          if (newContext && newContext !== doc.context) {
            await createVersion(doc.id, 'context', doc.context, 'ai_regenerate', response.model);
            await prisma.document.update({
              where: { id: doc.id },
              data: { context: newContext },
            });
          }

          completed++;
          send('done_one', {
            documentId: doc.id,
            progress: Math.round((completed / documents.length) * 100),
          });
        } catch (err) {
          completed++;
          const message = err instanceof Error ? err.message : 'Chyba';
          send('error_one', { documentId: doc.id, error: message });
        }
      }

      send('done', { total: documents.length, completed });
      controller.close();
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
