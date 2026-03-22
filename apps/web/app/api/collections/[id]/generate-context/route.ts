import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/infrastructure/db';
import { requireUserId } from '@/lib/auth';
import { deductTokens } from '@/lib/infrastructure/billing';

export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Generate collection context from transcriptions of selected pages.
 * POST body: { pageIds: string[] }
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

  const { pageIds } = (body as { pageIds?: string[] }) ?? {};
  if (!Array.isArray(pageIds) || pageIds.length === 0) {
    return NextResponse.json({ error: 'Chybí pageIds' }, { status: 400 });
  }

  // Verify collection belongs to user
  const collection = await prisma.collection.findUnique({ where: { id } });
  if (!collection || collection.userId !== userId) {
    return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
  }

  // Load pages with documents — only done pages with transcription
  const pagesWithDocs = await prisma.page.findMany({
    where: {
      id: { in: pageIds },
      collectionId: id,
      status: 'done',
      document: { isNot: null },
    },
    include: {
      document: {
        select: { transcription: true },
      },
    },
    orderBy: { order: 'asc' },
  });

  if (pagesWithDocs.length === 0) {
    return NextResponse.json({ error: 'Žádné zpracované stránky s transkripcí' }, { status: 422 });
  }

  // Concatenate transcriptions with page labels
  let concatenated = pagesWithDocs
    .map((page, idx) => {
      const label = page.displayName || page.filename;
      return `--- Stránka ${idx + 1}: ${label} ---\n${page.document?.transcription ?? ''}`;
    })
    .join('\n\n');

  // Truncate to ~100k characters if too long
  if (concatenated.length > 100_000) {
    concatenated = concatenated.slice(0, 100_000) + '\n\n[... text zkrácen ...]';
  }

  const prompt = `Jsi expert na historické rukopisy. Z následujících přepisů stránek starého textu vytvoř podrobný kontext díla v českém jazyce.

Extrahuj a strukturuj tyto informace (pokud jsou dostupné):
- Název díla
- Autor / původ
- Datace (přibližný rok nebo období vzniku)
- Jazyk textu
- Knihovna / úložiště a signatura
- Fyzický popis (počet listů, rozměry, materiál)
- Obsah a struktura díla
- Historický kontext
- Provenience (dějiny vlastnictví)

Výstup formátuj jako přehledný markdown s nadpisy a tabulkami.

Přepisy stránek:
${concatenated}`;

  // Call Claude Sonnet
  let response: Anthropic.Message;
  try {
    const client = new Anthropic();
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Chyba AI';
    return NextResponse.json({ error: `Generování kontextu selhalo: ${message}` }, { status: 422 });
  }

  const context = response.content[0]?.type === 'text' ? response.content[0].text : '';

  // Try to extract structured metadata with a second call
  let metadata: {
    title?: string;
    author?: string;
    yearFrom?: number;
    yearTo?: number;
    librarySignature?: string;
    abstract?: string;
  } | null = null;

  try {
    const client = new Anthropic();
    const metadataResponse = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Z následujícího kontextu historického díla extrahuj strukturovaná metadata. Vrať POUZE platný JSON objekt bez markdown backticks, bez dalšího textu.

Formát:
{
  "title": "název díla nebo null",
  "author": "autor nebo null",
  "yearFrom": číslo nebo null,
  "yearTo": číslo nebo null,
  "librarySignature": "signatura nebo null",
  "abstract": "stručný popis do 200 znaků nebo null"
}

Kontext:
${context}`,
        },
      ],
    });

    const metadataText =
      metadataResponse.content[0]?.type === 'text' ? metadataResponse.content[0].text : '';

    if (metadataText) {
      // Try parsing directly
      const parsed = JSON.parse(metadataText) as Record<string, unknown>;
      metadata = {
        title: typeof parsed.title === 'string' ? parsed.title : undefined,
        author: typeof parsed.author === 'string' ? parsed.author : undefined,
        yearFrom: typeof parsed.yearFrom === 'number' ? parsed.yearFrom : undefined,
        yearTo: typeof parsed.yearTo === 'number' ? parsed.yearTo : undefined,
        librarySignature:
          typeof parsed.librarySignature === 'string' ? parsed.librarySignature : undefined,
        abstract: typeof parsed.abstract === 'string' ? parsed.abstract : undefined,
      };
    }

    // Deduct tokens for metadata call too
    const metaInputTokens = metadataResponse.usage.input_tokens;
    const metaOutputTokens = metadataResponse.usage.output_tokens;
    await deductTokens(
      userId,
      metaInputTokens,
      metaOutputTokens,
      `Metadata kontextu svazku ${collection.name}`,
      `generate-context-meta:${id}:${Date.now()}`,
    ).catch(() => {
      // Non-critical — don't fail the request
    });
  } catch {
    // Metadata extraction is best-effort — ignore errors
  }

  // Save to collection
  await prisma.collection.update({
    where: { id },
    data: { context },
  });

  // Deduct tokens for main context call
  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  await deductTokens(
    userId,
    inputTokens,
    outputTokens,
    `Generování kontextu svazku ${collection.name} z ${pagesWithDocs.length} stránek`,
    `generate-context:${id}:${Date.now()}`,
  ).catch(() => {
    // Non-critical — don't fail the request
  });

  return NextResponse.json({
    context,
    metadata: metadata ?? undefined,
    inputTokens,
    outputTokens,
    pagesUsed: pagesWithDocs.length,
  });
}
