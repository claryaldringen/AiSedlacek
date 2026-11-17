import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/infrastructure/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getApiTranslations, getLocaleFromRequest } from '@/lib/infrastructure/api-locale';
import { canReadCollection } from '@/lib/infrastructure/authz';
import { rateLimit } from '@/lib/infrastructure/rate-limit';
import {
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_RESULT_LIMIT,
} from '@/lib/search-navigation';
import { languagesOutranking, visibleTranslation } from '@/lib/visible-translation';
import { TRANSLATION_LANGUAGES } from '@ai-sedlacek/shared';

const SNIPPET_CONTEXT = 50;
/**
 * Hledání v cizích svazcích na uživatele: UI hledá s debounce 300 ms, psaní
 * slova je pár dotazů – 60 za minutu běžné hledání nepozná, opakované dotazy
 * nad velkým veřejným svazkem ano.
 */
const FOREIGN_SEARCH_LIMIT = 60;
const FOREIGN_SEARCH_WINDOW_MS = 60_000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Počet shod a úryvek kolem první z nich – jen z textů, které uživatel v jazyce
 * UI uvidí (přepis + překlad v jazyce UI). Každý text zvlášť, ať shoda nevznikne
 * přes hranici dvou textů.
 */
function summarizeMatches(texts: string[], q: string): { matches: number; snippet: string } {
  const pattern = escapeRegExp(q);
  const all = new RegExp(pattern, 'gi');
  const first = new RegExp(pattern, 'i');
  let matches = 0;
  let snippet = '';
  for (const text of texts) {
    const found = text.match(all)?.length ?? 0;
    if (found === 0) continue;
    matches += found;
    const hit = snippet ? null : first.exec(text);
    if (hit) {
      const start = Math.max(0, hit.index - SNIPPET_CONTEXT);
      const end = Math.min(text.length, hit.index + hit[0].length + SNIPPET_CONTEXT);
      snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    }
  }
  return { matches, snippet };
}

type Contains = { contains: string; mode: 'insensitive' };

/**
 * Shoda v překladu, který čtenáři cizího dokumentu panel zobrazí: v jazyce UI,
 * nebo v jiném jazyce, jen když dokument nemá překlad do jazyka UI ani do
 * jazyka s vyšší prioritou (`languagesOutranking`, stejné pořadí jako
 * `visibleTranslation`). Neznámé jazyky jen u dokumentu bez známého jazyka –
 * mezi nimi rozhodne až `visibleTranslation` (vzácné, jen nadmnožina).
 */
function readerVisibleTranslationMatch(
  locale: string,
  contains: Contains,
): Prisma.TranslationWhereInput {
  const known = TRANSLATION_LANGUAGES.filter((language) => language !== locale);
  return {
    OR: [
      { language: locale, text: contains },
      ...known.map((language) => ({
        language,
        text: contains,
        document: {
          translations: { none: { language: { in: languagesOutranking(language, locale) } } },
        },
      })),
      {
        language: { notIn: [locale, ...known] },
        text: contains,
        document: { translations: { none: { language: { in: [locale, ...known] } } } },
      },
    ],
  };
}

/**
 * Hledání v textech stránek. Bez `collectionId` jen ve vlastních stránkách;
 * se `collectionId` ve stránkách svazku, který uživatel smí číst (vlastní,
 * sdílený přes workspace, veřejný) – nečitelný i neexistující svazek dá stejně
 * prázdný výsledek, ať se neprozradí jeho existence.
 *
 * Hledá se jen v tom, co panel stránky v jazyce UI (hlavička `x-locale`) ukáže:
 * zpracovaná stránka (archivované, nezpracované, zpracovávané ani chybové panel
 * s textem neukáže), přepis a zobrazený překlad (`visibleTranslation`) – ne
 * překlady do jiných jazyků. Vlastník bez překladu do jazyka UI vidí stránku
 * jako nezpracovanou (nabídka přeložit), čtenář cizího svazku náhradní překlad.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const locale = getLocaleFromRequest(request);
  const auth = await getAuthenticatedUserId(locale);
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const collectionId = searchParams.get('collectionId');

  if (q.length > SEARCH_MAX_QUERY_LENGTH) {
    const t = await getApiTranslations(request, 'api');
    return NextResponse.json(
      { error: t('searchQueryTooLong', { max: SEARCH_MAX_QUERY_LENGTH }) },
      { status: 400 },
    );
  }
  if (q.length < SEARCH_MIN_QUERY_LENGTH) {
    return NextResponse.json({ results: [], truncated: false });
  }

  // Vlastník: jen jeho stránky (filtr userId). Čtenář cizího svazku: stránky
  // svazku bez filtru userId – jen po ověření práva svazek číst.
  let isOwner = true;
  if (collectionId) {
    const collection = await prisma.collection.findUnique({
      where: { id: collectionId },
      select: { id: true, userId: true, isPublic: true },
    });
    // Hledání v cizím (i neexistujícím) svazku se omezuje – čtenář velkého
    // veřejného svazku by jinak mohl databázi zatěžovat bez omezení.
    if (!collection || collection.userId !== userId) {
      const rl = rateLimit(`search:${userId}`, FOREIGN_SEARCH_LIMIT, FOREIGN_SEARCH_WINDOW_MS);
      if (!rl.ok) {
        const t = await getApiTranslations(request, 'api');
        return NextResponse.json(
          { error: t('rateLimited'), retryAfterSeconds: rl.retryAfterSeconds },
          { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
        );
      }
    }
    if (!collection || !(await canReadCollection(userId, collection))) {
      return NextResponse.json({ results: [], truncated: false });
    }
    isOwner = collection.userId === userId;
  }

  const contains = { contains: q, mode: 'insensitive' as const };
  // Vlastník hledá jen v překladu do jazyka UI (bez něj stránka „čeká na
  // překlad“); čtenáři se zobrazí i náhradní překlad – který, rozhodne až
  // visibleTranslation podle jazyků překladů.
  const translationFilter = isOwner ? { language: locale } : {};
  // Shoda v překladu už v DB jen v překladu, který se může zobrazit – jinak by
  // limit kandidátů vyčerpaly stránky se shodou jen ve skrytém jazyce a
  // viditelné shody by se do výsledků nedostaly.
  const visibleTranslationMatch = isOwner
    ? { language: locale, text: contains }
    : readerVisibleTranslationMatch(locale, contains);
  // Nejvýš SEARCH_RESULT_LIMIT kandidátů (+1 pro zjištění, že jich je víc) a bez
  // textů překladů – ty se dotáhnou jen pro zobrazený překlad každé stránky.
  // Pořadí jako v mřížce, ať při oříznutí nechybí stránky nahoře: ve svazku jako
  // detail svazku, v kořeni jako /api/pages (nejdřív stránky mimo svazek, které
  // kořen zobrazuje).
  const candidates = await prisma.page.findMany({
    where: {
      ...(isOwner ? { userId } : {}),
      // status `done` zároveň vylučuje archivované stránky
      status: 'done',
      ...(collectionId ? { collectionId } : {}),
      document: {
        translations: { some: translationFilter },
        OR: [{ transcription: contains }, { translations: { some: visibleTranslationMatch } }],
      },
    },
    orderBy: collectionId
      ? [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
      : [
          { collectionId: { sort: 'asc', nulls: 'first' } },
          { order: 'asc' },
          { createdAt: 'desc' },
          { id: 'asc' },
        ],
    take: SEARCH_RESULT_LIMIT + 1,
    select: {
      id: true,
      filename: true,
      displayName: true,
      collectionId: true,
      collection: { select: { name: true } },
      document: {
        select: {
          id: true,
          transcription: true,
          translations: { where: translationFilter, select: { language: true } },
        },
      },
    },
  });
  const truncated = candidates.length > SEARCH_RESULT_LIMIT;
  const pages = candidates.slice(0, SEARCH_RESULT_LIMIT);

  // Jazyk zobrazeného překladu každého dokumentu → texty jen těchto překladů
  // (po jazycích, nejvýš tolik dotazových větví, kolik je jazyků)
  const visibleLanguage = new Map<string, string>();
  for (const page of pages) {
    if (!page.document) continue;
    const translation = visibleTranslation(page.document.translations, locale, isOwner);
    if (translation) visibleLanguage.set(page.document.id, translation.language);
  }
  const documentsByLanguage = new Map<string, string[]>();
  for (const [documentId, language] of visibleLanguage) {
    const ids = documentsByLanguage.get(language);
    if (ids) ids.push(documentId);
    else documentsByLanguage.set(language, [documentId]);
  }
  const translationTexts =
    documentsByLanguage.size === 0
      ? []
      : await prisma.translation.findMany({
          where: {
            OR: [...documentsByLanguage].map(([language, documentIds]) => ({
              language,
              documentId: { in: documentIds },
            })),
          },
          select: { documentId: true, text: true },
        });
  const visibleText = new Map(translationTexts.map((tr) => [tr.documentId, tr.text]));

  const results = pages.flatMap((page) => {
    const text = page.document ? visibleText.get(page.document.id) : undefined;
    if (!page.document || text === undefined) return [];
    const texts = [page.document.transcription, text];
    const { matches, snippet } = summarizeMatches(texts, q);
    // Databáze porovnává bez ohledu na velikost písmen jinak než JS – shoda, kterou
    // zvýraznění v textu nenajde, se nehlásí
    if (matches === 0) return [];
    return [
      {
        pageId: page.id,
        filename: page.filename,
        displayName: page.displayName,
        collectionId: page.collectionId,
        collectionName: page.collection?.name ?? null,
        matches,
        snippet,
      },
    ];
  });

  return NextResponse.json({ results, truncated });
}
