import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { InsufficientCreditError, checkBalance, runBilledCall } from '@/lib/infrastructure/billing';
import { insufficientCreditResponse } from '@/lib/infrastructure/credit';
import { safeFetch, readBodyWithLimit } from '@/lib/infrastructure/safe-fetch';
import { getApiTranslations } from '@/lib/infrastructure/api-locale';
import {
  LLM_MAX_TOKENS,
  TEXT_MODEL,
  estimateInputTokens,
  reservationCredits,
} from '@ai-sedlacek/shared';

const MAX_FETCH_BYTES = 5 * 1024 * 1024; // 5 MB of HTML is plenty for context

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Fetch a URL and extract relevant manuscript context using Claude.
 * Saves the extracted context to the collection.
 */
export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const t = await getApiTranslations(request, 'api');

  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: t('invalidJson') }, { status: 400 });
  }

  const { url, text } = (body as { url?: string; text?: string }) ?? {};
  const hasUrl = typeof url === 'string' && url.trim() !== '';
  const hasText = typeof text === 'string' && text.trim() !== '';
  if (!hasUrl && !hasText) {
    return NextResponse.json({ error: t('missingUrl') }, { status: 400 });
  }

  const collection = await prisma.collection.findUnique({ where: { id } });
  if (!collection || collection.userId !== userId) {
    return NextResponse.json({ error: t('collectionNotFound') }, { status: 404 });
  }

  // Předběžná kontrola ještě před stahováním URL (BIL-1); závazná rezervace
  // s odhadem vstupu proběhne těsně před voláním modelu.
  const minimum = reservationCredits([TEXT_MODEL], 0, LLM_MAX_TOKENS.fetchContext);
  const precheck = await checkBalance(userId, minimum);
  if (!precheck.sufficient) return insufficientCreditResponse(request, t, precheck);

  // Get new content — either from URL or from provided text
  let newContent: string;
  let sourceLabel: string;

  if (hasUrl) {
    try {
      const res = await safeFetch(url!.trim(), {
        headers: { 'User-Agent': 'AiSedlacek/1.0 (manuscript OCR tool)' },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        return NextResponse.json({ error: `Server vrátil ${res.status}` }, { status: 422 });
      }
      const html = (await readBodyWithLimit(res, MAX_FETCH_BYTES)).toString('utf8');
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
  const client = new Anthropic();
  let response: Anthropic.Message;
  {
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

    // Rezervace maximální ceny před voláním, vyúčtování skutečné spotřeby hned
    // po něm (BIL-1) – i když se výsledek neuloží (useknutý výstup).
    const referenceId = `fetch-context:${id}:${randomUUID()}`;
    const description = `Kontext svazku ${collection.name} ${sourceLabel}`;
    try {
      ({ result: response } = await runBilledCall(
        {
          userId,
          referenceId,
          description,
          amount: reservationCredits(
            [TEXT_MODEL],
            estimateInputTokens(prompt),
            LLM_MAX_TOKENS.fetchContext,
          ),
        },
        () =>
          client.messages.create({
            model: TEXT_MODEL,
            // Sloučení dlouhého kontextu s textem z URL se do 4096 tokenů nevešlo
            // a useknutý výsledek přepsal původní kontext.
            max_tokens: LLM_MAX_TOKENS.fetchContext,
            messages: [{ role: 'user', content: prompt }],
          }),
        (r) => [
          {
            referenceId,
            description,
            model: r.model,
            inputTokens: r.usage.input_tokens,
            outputTokens: r.usage.output_tokens,
            collectionId: id,
          },
        ],
      ));
    } catch (err) {
      if (err instanceof InsufficientCreditError)
        return insufficientCreditResponse(request, t, err);
      const message = err instanceof Error ? err.message : 'Chyba AI';
      return NextResponse.json({ error: `Extrakce kontextu selhala: ${message}` }, { status: 422 });
    }
  }

  const context = response.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('')
    .trim();

  // Kontext svazku nemá historii – přepsat ho smí jen kompletní, neprázdný výstup.
  // Useknutý (max_tokens) nebo prázdný výsledek by stávající kontext nenávratně zničil.
  if (response.stop_reason !== 'end_turn' || context === '') {
    console.warn(
      `[fetch-context] Neúplný výstup modelu (stop_reason=${response.stop_reason}, ${context.length} znaků) – kontext svazku ${id} se nemění`,
    );
    return NextResponse.json({ error: t('contextIncomplete') }, { status: 422 });
  }

  // Update URLs list only when a URL was provided
  const updatedUrls = hasUrl
    ? collection.contextUrls.includes(url!.trim())
      ? collection.contextUrls
      : [...collection.contextUrls, url!.trim()]
    : collection.contextUrls;

  // Detect context language from request locale header
  const locale =
    request.headers.get('X-Locale') ||
    request.headers.get('Accept-Language')?.split(',')[0]?.split('-')[0] ||
    'cs';

  // Save to collection
  await prisma.collection.update({
    where: { id },
    data: { context, contextLanguage: locale, contextUrls: updatedUrls },
  });

  // Extract structured metadata from context (fire-and-forget)
  void extractMetadata(client, context, id, userId);

  return NextResponse.json({
    context,
    contextUrls: updatedUrls,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });
}

async function extractMetadata(
  client: Anthropic,
  context: string,
  collectionId: string,
  userId: string,
): Promise<void> {
  try {
    const prompt = `Z následujícího kontextu historického díla extrahuj strukturovaná metadata. Vrať POUZE platný JSON objekt bez markdown backticks, bez dalšího textu.

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
${context}`;

    // I toto volání se platí (dřív bylo zadarmo) – s rezervací předem (BIL-1).
    // Bez volného kreditu se metadata přeskočí (best-effort), kontext už je uložený.
    const referenceId = `fetch-context-metadata:${collectionId}:${randomUUID()}`;
    const description = 'Metadata kontextu svazku';
    const { result: metaResponse } = await runBilledCall(
      {
        userId,
        referenceId,
        description,
        amount: reservationCredits(
          [TEXT_MODEL],
          estimateInputTokens(prompt),
          LLM_MAX_TOKENS.contextMetadata,
        ),
      },
      () =>
        client.messages.create({
          model: TEXT_MODEL,
          max_tokens: LLM_MAX_TOKENS.contextMetadata,
          messages: [{ role: 'user', content: prompt }],
        }),
      (r) => [
        {
          referenceId,
          description,
          model: r.model,
          inputTokens: r.usage.input_tokens,
          outputTokens: r.usage.output_tokens,
          collectionId,
        },
      ],
    );

    const text = metaResponse.content[0]?.type === 'text' ? metaResponse.content[0].text : '';
    if (!text) return;

    // Strip optional ```json code fences before parsing (LLM sometimes adds them).
    const jsonText = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    await prisma.collection.update({
      where: { id: collectionId },
      data: {
        title: typeof parsed.title === 'string' ? parsed.title : undefined,
        author: typeof parsed.author === 'string' ? parsed.author : undefined,
        yearFrom: typeof parsed.yearFrom === 'number' ? parsed.yearFrom : undefined,
        yearTo: typeof parsed.yearTo === 'number' ? parsed.yearTo : undefined,
        librarySignature:
          typeof parsed.librarySignature === 'string' ? parsed.librarySignature : undefined,
        abstract: typeof parsed.abstract === 'string' ? parsed.abstract : undefined,
      },
    });
    console.log(`[fetch-context] Metadata extracted for collection ${collectionId}`);
  } catch (err) {
    console.error('[fetch-context] Metadata extraction failed:', err);
  }
}
