import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/infrastructure/db';
import { requireUserId } from '@/lib/auth';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Fetch a URL and extract relevant manuscript context using Claude.
 * Saves the extracted context to the collection.
 */
export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatný JSON' }, { status: 400 });
  }

  const { url, text } = (body as { url?: string; text?: string }) ?? {};
  const hasUrl = typeof url === 'string' && url.trim() !== '';
  const hasText = typeof text === 'string' && text.trim() !== '';
  if (!hasUrl && !hasText) {
    return NextResponse.json({ error: 'Chybí url nebo text' }, { status: 400 });
  }

  const collection = await prisma.collection.findUnique({ where: { id } });
  if (!collection || collection.userId !== userId) {
    return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
  }

  // Get new content — either from URL or from provided text
  let newContent: string;
  let sourceLabel: string;

  if (hasUrl) {
    try {
      const res = await fetch(url!.trim(), {
        headers: { 'User-Agent': 'AiSedlacek/1.0 (manuscript OCR tool)' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        return NextResponse.json({ error: `Server vrátil ${res.status}` }, { status: 422 });
      }
      const html = await res.text();
      newContent = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (newContent.length > 30000) {
        newContent = newContent.slice(0, 30000) + '…';
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Nepodařilo se stáhnout';
      return NextResponse.json({ error: `Stahování selhalo: ${message}` }, { status: 422 });
    }
    if (newContent.length < 50) {
      return NextResponse.json({ error: 'Stránka neobsahuje dostatek textu' }, { status: 422 });
    }
    sourceLabel = `z URL ${url}`;
  } else {
    newContent = text!.trim();
    sourceLabel = 'zadané uživatelem';
  }

  const existingContext = collection.context || '';

  // Use Claude to extract and merge context
  let response;
  try {
    const client = new Anthropic();

    const hasExisting = existingContext.trim().length > 0;
    let prompt: string;

    if (hasExisting) {
      prompt = `Máš existující kontext historického rukopisu/díla a nové informace ${sourceLabel}. Slouč je do jednoho koherentního textu v markdown formátu. Neduplicuj informace — pokud se nové informace překrývají s existujícími, ponech přesnější nebo úplnější verzi. Nové informace doplň na vhodná místa.

Existující kontext:
${existingContext}

---

Nové informace ${sourceLabel}:
${newContent}`;
    } else if (hasUrl) {
      prompt = `Z následujícího textu webové stránky extrahuj informace relevantní pro popis historického rukopisu nebo díla. Zaměř se na:

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
${newContent}`;
    } else {
      prompt = `Z následujícího textu extrahuj a uspořádej informace relevantní pro popis historického rukopisu nebo díla. Zaměř se na:

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

Výstup formátuj jako přehledný markdown. Pokud některé informace nejsou dostupné, nevymýšlej je.

Text:
${newContent}`;
    }

    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chyba AI';
    return NextResponse.json({ error: `Extrakce kontextu selhala: ${message}` }, { status: 422 });
  }

  const context = response.content[0]?.type === 'text' ? response.content[0].text : '';

  // Update URLs list only when a URL was provided
  const updatedUrls = hasUrl
    ? collection.contextUrls.includes(url!.trim())
      ? collection.contextUrls
      : [...collection.contextUrls, url!.trim()]
    : collection.contextUrls;

  // Save to collection
  await prisma.collection.update({
    where: { id },
    data: { context, contextUrls: updatedUrls },
  });

  return NextResponse.json({
    context,
    contextUrls: updatedUrls,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
}
