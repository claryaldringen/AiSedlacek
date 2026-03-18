import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/infrastructure/db';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Fetch a URL and extract relevant manuscript context using Claude.
 * Saves the extracted context to the collection.
 */
export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { url } = (body as { url?: string }) ?? {};
  if (typeof url !== 'string' || url.trim() === '') {
    return NextResponse.json({ error: 'Chybí url' }, { status: 400 });
  }

  const collection = await prisma.collection.findUnique({ where: { id } });
  if (!collection) {
    return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
  }

  // Fetch the page
  let pageContent: string;
  try {
    const res = await fetch(url.trim(), {
      headers: { 'User-Agent': 'AiSedlacek/1.0 (manuscript OCR tool)' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Server vrátil ${res.status}` }, { status: 422 });
    }
    const html = await res.text();
    // Strip HTML tags for a rough text extraction
    pageContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // Limit to ~30k chars to avoid token overflow
    if (pageContent.length > 30000) {
      pageContent = pageContent.slice(0, 30000) + '…';
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Nepodařilo se stáhnout';
    return NextResponse.json({ error: `Stahování selhalo: ${message}` }, { status: 422 });
  }

  if (pageContent.length < 50) {
    return NextResponse.json({ error: 'Stránka neobsahuje dostatek textu' }, { status: 422 });
  }

  // Use Claude to extract relevant manuscript context
  const client = new Anthropic();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `Z následujícího textu webové stránky extrahuj informace relevantní pro popis historického rukopisu nebo díla. Zaměř se na:

- Název díla
- Autor / původ
- Datace
- Jazyk
- Knihovna / úložiště
- Signatura
- Fyzický popis (materiál, rozměry, počet folií)
- Obsah / popis díla
- Historický kontext
- Provenance (dějiny vlastnictví)

Výstup formátuj jako přehledný markdown. Ignoruj navigaci, reklamy a nepodstatné části stránky. Pokud některé informace nejsou dostupné, nevymýšlej je.

URL: ${url}

Text stránky:
${pageContent}`,
      },
    ],
  });

  const context = response.content[0]?.type === 'text' ? response.content[0].text : '';

  // Save to collection
  await prisma.collection.update({
    where: { id },
    data: { context, contextUrl: url.trim() },
  });

  return NextResponse.json({
    context,
    contextUrl: url.trim(),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
}
