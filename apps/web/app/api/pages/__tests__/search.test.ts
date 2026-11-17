import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// GET /api/pages/search hledá jen v tom, co UI v jazyce uživatele (x-locale)
// zobrazí: zpracovaná stránka s překladem do jazyka UI, přepis + tento překlad.
// Prisma je nahrazená malým vyhodnocovačem `where`/`select` nad fixturami, ať
// testy ověřují skutečný dotaz route, ne jen tvar mocku.

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

function matchesValue(value: unknown, cond: unknown): boolean {
  if (cond === null || typeof cond !== 'object') return value === cond;
  const c = cond as Record<string, unknown>;
  if ('contains' in c) {
    if (typeof value !== 'string') return false;
    const needle = String(c.contains);
    return c.mode === 'insensitive'
      ? value.toLowerCase().includes(needle.toLowerCase())
      : value.includes(needle);
  }
  if ('not' in c) return value !== c.not;
  if ('in' in c) return (c.in as unknown[]).includes(value);
  if ('notIn' in c) return !(c.notIn as unknown[]).includes(value);
  if ('some' in c) {
    return Array.isArray(value) && value.some((item) => matchesWhere(item as Row, c.some as Where));
  }
  if ('none' in c) {
    return (
      Array.isArray(value) && !value.some((item) => matchesWhere(item as Row, c.none as Where))
    );
  }
  // Vztah 1:1 (document) – podmínka na vnořený objekt
  if (value === null || value === undefined) return false;
  return matchesWhere(value as Row, c as Where);
}

function matchesWhere(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Where[]).some((w) => matchesWhere(row, w));
    if (key === 'AND') return (cond as Where[]).every((w) => matchesWhere(row, w));
    return matchesValue(row[key], cond);
  });
}

function applySelect(row: Row, select: Record<string, unknown>): Row {
  const out: Row = {};
  for (const [key, spec] of Object.entries(select)) {
    const value = row[key];
    if (spec === true) {
      out[key] = value;
      continue;
    }
    const { select: nested, where } = spec as { select: Record<string, unknown>; where?: Where };
    if (Array.isArray(value)) {
      out[key] = value
        .filter((item) => !where || matchesWhere(item as Row, where))
        .map((item) => applySelect(item as Row, nested));
    } else {
      out[key] = value == null ? null : applySelect(value as Row, nested);
    }
  }
  return out;
}

let PAGES: Row[] = [];

// Svazky: vlastní (user-1), cizí sdílený přes workspace, cizí veřejný, cizí soukromý
const COLLECTIONS: Row[] = [
  { id: 'col-1', userId: 'user-1', isPublic: false },
  { id: 'col-2', userId: 'user-1', isPublic: false },
  { id: 'col-shared', userId: 'user-2', isPublic: false },
  { id: 'col-public', userId: 'user-2', isPublic: true },
  { id: 'col-private', userId: 'user-2', isPublic: false },
];
// Členství user-1 ve sdíleném workspace, do kterého je zařazen col-shared
const WORKSPACE_ITEMS = [{ collectionId: 'col-shared', memberIds: ['user-1', 'user-2'] }];

type OrderBy = Record<string, 'asc' | 'desc' | { sort: 'asc' | 'desc'; nulls?: 'first' | 'last' }>;

// Řazení jako v Prisma/PostgreSQL (asc/desc, nulls first/last; bez nulls se null
// řadí jako největší hodnota – výchozí chování PostgreSQL)
function compareBy(orderBy: OrderBy[]): (a: Row, b: Row) => number {
  return (a, b) => {
    for (const entry of orderBy) {
      const [field, spec] = Object.entries(entry)[0]!;
      const sort = typeof spec === 'string' ? spec : spec.sort;
      const nulls = typeof spec === 'string' ? undefined : spec.nulls;
      const va = a[field] as string | number | Date | null | undefined;
      const vb = b[field] as string | number | Date | null | undefined;
      if (va == null || vb == null) {
        if (va == null && vb == null) continue;
        const nullFirst = nulls ? nulls === 'first' : sort === 'desc';
        return (va == null) === nullFirst ? -1 : 1;
      }
      if (va < vb) return sort === 'asc' ? -1 : 1;
      if (va > vb) return sort === 'asc' ? 1 : -1;
    }
    return 0;
  };
}

const mockPageFindMany = vi.fn(
  async (args: {
    where: Where;
    select: Record<string, unknown>;
    take?: number;
    orderBy?: OrderBy[];
  }): Promise<Row[]> =>
    PAGES.filter((p) => matchesWhere(p, args.where))
      .sort(compareBy(args.orderBy ?? []))
      .slice(0, args.take ?? Infinity)
      .map((p) => applySelect(p, args.select)),
);
// Překlady všech dokumentů z fixtur (s documentId) – route si dotahuje texty zvlášť
const mockTranslationFindMany = vi.fn(
  async (args: { where: Where; select: Record<string, unknown> }): Promise<Row[]> =>
    PAGES.flatMap((p) => ((p.document as Row | null)?.translations as Row[] | undefined) ?? [])
      .filter((tr) => matchesWhere(tr, args.where))
      .map((tr) => applySelect(tr, args.select)),
);
const mockCollectionFindUnique = vi.fn(
  async (args: { where: { id: string }; select: Record<string, unknown> }): Promise<Row | null> => {
    const found = COLLECTIONS.find((c) => c.id === args.where.id);
    return found ? applySelect(found, args.select) : null;
  },
);
const mockWorkspaceItemFindFirst = vi.fn(
  async (args: {
    where: { collectionId: string; workspace: { members: { some: { userId: string } } } };
  }): Promise<Row | null> => {
    const userId = args.where.workspace.members.some.userId;
    const item = WORKSPACE_ITEMS.find(
      (w) => w.collectionId === args.where.collectionId && w.memberIds.includes(userId),
    );
    return item ? { id: 'ws-item-1' } : null;
  },
);

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    page: {
      findMany: (...args: unknown[]) =>
        mockPageFindMany(...(args as Parameters<typeof mockPageFindMany>)),
    },
    translation: {
      findMany: (...args: unknown[]) =>
        mockTranslationFindMany(...(args as Parameters<typeof mockTranslationFindMany>)),
    },
    collection: {
      findUnique: (...args: unknown[]) =>
        mockCollectionFindUnique(...(args as Parameters<typeof mockCollectionFindUnique>)),
    },
    workspaceItem: {
      findFirst: (...args: unknown[]) =>
        mockWorkspaceItemFindFirst(...(args as Parameters<typeof mockWorkspaceItemFindFirst>)),
    },
  },
}));

vi.mock('@/lib/infrastructure/auth-utils', () => ({
  getAuthenticatedUserId: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

const { GET } = await import('@/app/api/pages/search/route');
const { resetRateLimit } = await import('@/lib/infrastructure/rate-limit');

function page(
  id: string,
  transcription: string,
  translations: { language: string; text: string }[],
  overrides: Row = {},
): Row {
  const documentId = `doc-${id}`;
  const document: Row = { id: documentId, transcription };
  // Překlad zná svůj dokument (filtr `translation.document.translations.none`);
  // odkaz zpět je neenumerovatelný, ať porovnání v testech necyklí
  document.translations = translations.map((tr) => {
    const row: Row = { ...tr, documentId };
    Object.defineProperty(row, 'document', { value: document, enumerable: false });
    return row;
  });
  return {
    id,
    userId: 'user-1',
    status: 'done',
    filename: `${id}.jpg`,
    displayName: null,
    collectionId: 'col-1',
    collection: { name: 'Svazek' },
    document,
    ...overrides,
  };
}

type SearchBody = {
  results: { pageId: string; matches: number; snippet: string }[];
  truncated?: boolean;
  error?: string;
};

async function searchRaw(
  q: string,
  headers: Record<string, string> = { 'x-locale': 'cs' },
  params: Record<string, string> = {},
): Promise<{ status: number; body: SearchBody }> {
  const url = new URL('http://localhost/api/pages/search');
  url.searchParams.set('q', q);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await GET(new NextRequest(url, { headers }));
  return { status: res.status, body: (await res.json()) as SearchBody };
}

async function search(
  q: string,
  headers: Record<string, string> = { 'x-locale': 'cs' },
  params: Record<string, string> = {},
): Promise<SearchBody['results']> {
  const { status, body } = await searchRaw(q, headers, params);
  expect(status).toBe(200);
  return body.results;
}

describe('GET /api/pages/search – jen texty viditelné v jazyce UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimit('search:user-1');
    PAGES = [];
  });

  it('shoda jen v překladu do jiného jazyka než UI → nic', async () => {
    PAGES = [
      page('p1', 'Anno domini', [
        { language: 'cs', text: 'Léta Páně' },
        { language: 'en', text: 'In the year of the Lord' },
      ]),
    ];

    expect(await search('Lord')).toEqual([]);
  });

  it('stránka bez překladu v jazyce UI → nic, ani při shodě v přepisu', async () => {
    // Workspace ji v češtině ukazuje jako nezpracovanou (nabídka přeložit)
    PAGES = [page('p1', 'Anno domini', [{ language: 'en', text: 'In the year of the Lord' }])];

    expect(await search('domini')).toEqual([]);
  });

  it('shoda v přepisu u stránky s překladem v jazyce UI → nalezeno, počet jen z přepisu a překladu UI', async () => {
    PAGES = [
      page('p1', 'Anno domini, domini nostri', [
        { language: 'cs', text: 'Léta Páně' },
        // Překlad do jiného jazyka se do počtu ani úryvku nepočítá
        { language: 'en', text: 'domini domini domini' },
      ]),
    ];

    const results = await search('domini');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ pageId: 'p1', matches: 2 });
    expect(results[0]!.snippet).toBe('Anno domini, domini nostri');
  });

  it('shoda v překladu v jazyce UI → nalezeno, úryvek z překladu', async () => {
    PAGES = [
      page('p1', 'Anno domini', [
        { language: 'cs', text: 'Léta Páně tisícího' },
        { language: 'en', text: 'Year of the Lord' },
      ]),
    ];

    const results = await search('páně');
    expect(results).toEqual([
      expect.objectContaining({ pageId: 'p1', matches: 1, snippet: 'Léta Páně tisícího' }),
    ]);
  });

  it('shody v přepisu i překladu UI se sčítají, ale ne přes hranici obou textů', async () => {
    PAGES = [page('p1', 'konec ab', [{ language: 'cs', text: 'ab cd ab ab' }])];

    expect(await search('ab')).toEqual([expect.objectContaining({ matches: 4 })]);
    // Spojením přepisu a překladu („konec ab ab cd…“) by vznikla další shoda „ab ab“
    expect(await search('ab ab')).toEqual([
      expect.objectContaining({ matches: 1, snippet: 'ab cd ab ab' }),
    ]);
  });

  it('bez x-locale nebo s neplatným jazykem hledá v překladu do výchozího jazyka aplikace (en)', async () => {
    PAGES = [
      page('p-cs', 'Anno domini', [{ language: 'cs', text: 'Léta Páně' }]),
      page('p-en', 'Anno domini', [{ language: 'en', text: 'Year of the Lord' }]),
    ];

    const variants: Record<string, string>[] = [{}, { 'x-locale': 'xx' }];
    for (const headers of variants) {
      const results = await search('domini', headers);
      expect(results.map((r) => r.pageId)).toEqual(['p-en']);
    }
  });

  it('hledá jen ve vlastních zpracovaných stránkách – cizí, archivované ani nezpracované ne', async () => {
    const translations = [{ language: 'cs', text: 'Léta Páně' }];
    PAGES = [
      page('own', 'Anno domini', translations),
      page('foreign', 'Anno domini', translations, { userId: 'user-2' }),
      page('archived', 'Anno domini', translations, { status: 'archived' }),
      page('pending', 'Anno domini', translations, { status: 'pending' }),
      page('blank', 'Anno domini', translations, { status: 'blank' }),
      page('error', 'Anno domini', translations, { status: 'error' }),
      page('no-doc', '', [], { document: null }),
    ];

    const results = await search('domini');
    expect(results.map((r) => r.pageId)).toEqual(['own']);
  });

  it('volitelné collectionId omezí hledání na svazek', async () => {
    const translations = [{ language: 'cs', text: 'Léta Páně' }];
    PAGES = [
      page('in-col', 'Anno domini', translations, { collectionId: 'col-1' }),
      page('other-col', 'Anno domini', translations, { collectionId: 'col-2' }),
      page('orphan', 'Anno domini', translations, { collectionId: null, collection: null }),
    ];

    expect(
      (await search('domini', undefined, { collectionId: 'col-1' })).map((r) => r.pageId),
    ).toEqual(['in-col']);
    // Kořen: nejdřív stránky mimo svazek (ty kořenová mřížka zobrazuje), pak ve svazcích
    expect((await search('domini')).map((r) => r.pageId)).toEqual([
      'orphan',
      'in-col',
      'other-col',
    ]);
  });

  it('řazení v kořeni jako /api/pages: stránky mimo svazek nahoře, order asc, createdAt desc', async () => {
    const translations = [{ language: 'cs', text: 'Léta Páně' }];
    const at = (day: number): Date => new Date(Date.UTC(2026, 0, day));
    PAGES = [
      page('in-col', 'Anno domini', translations, { collectionId: 'col-1', createdAt: at(9) }),
      page('old', 'Anno domini', translations, { collectionId: null, order: 0, createdAt: at(1) }),
      page('new', 'Anno domini', translations, { collectionId: null, order: 0, createdAt: at(3) }),
      page('mid', 'Anno domini', translations, { collectionId: null, order: 0, createdAt: at(2) }),
      page('moved', 'Anno domini', translations, {
        collectionId: null,
        order: 1,
        createdAt: at(5),
      }),
    ];

    expect((await search('domini')).map((r) => r.pageId)).toEqual([
      'new',
      'mid',
      'old',
      'moved',
      'in-col',
    ]);
    expect(mockPageFindMany.mock.calls[0]![0].orderBy).toEqual([
      { collectionId: { sort: 'asc', nulls: 'first' } },
      { order: 'asc' },
      { createdAt: 'desc' },
      { id: 'asc' },
    ]);
  });

  it('ve svazku řadí jako detail svazku (order, createdAt, id)', async () => {
    PAGES = [page('p1', 'Anno domini', [{ language: 'cs', text: 'Léta Páně' }])];
    await search('domini', undefined, { collectionId: 'col-1' });
    expect(mockPageFindMany.mock.calls[0]![0].orderBy).toEqual([
      { order: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('kořen při oříznutí nevynechá stránky mimo svazek, které mřížka ukazuje nahoře', async () => {
    const translations = [{ language: 'cs', text: 'Léta Páně' }];
    PAGES = [
      ...Array.from({ length: 301 }, (_, i) =>
        page(`c${String(i).padStart(3, '0')}`, 'Anno domini', translations, {
          collectionId: 'col-1',
          createdAt: new Date(Date.UTC(2026, 5, 1)),
        }),
      ),
      // Nejnovější stránka mimo svazek – v kořenové mřížce je nahoře, při řazení
      // podle createdAt asc přes všechny stránky by ji limit uřízl
      page('orphan', 'Anno domini', translations, {
        collectionId: null,
        collection: null,
        createdAt: new Date(Date.UTC(2030, 0, 1)),
      }),
    ];

    const { body } = await searchRaw('domini');
    expect(body.truncated).toBe(true);
    expect(body.results[0]!.pageId).toBe('orphan');
  });

  it('dotaz kratší než 2 znaky databázi nevolá', async () => {
    expect(await search(' a ')).toEqual([]);
    expect(mockPageFindMany).not.toHaveBeenCalled();
  });

  it('dotaz delší než 200 znaků (po ořezu mezer) → 400 bez dotazu do DB; 200 znaků projde', async () => {
    const url = new URL('http://localhost/api/pages/search');
    url.searchParams.set('q', 'a'.repeat(201));
    const res = await GET(new NextRequest(url, { headers: { 'x-locale': 'cs' } }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('200');
    expect(mockPageFindMany).not.toHaveBeenCalled();

    PAGES = [page('p1', 'a'.repeat(200), [{ language: 'cs', text: 'Léta Páně' }])];
    expect(await search(` ${'a'.repeat(200)} `)).toEqual([
      expect.objectContaining({ pageId: 'p1', matches: 1 }),
    ]);
  });
});

describe('GET /api/pages/search – cizí svazky (sdílené workspacy, veřejné)', () => {
  const cs = [{ language: 'cs', text: 'Léta Páně' }];

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimit('search:user-1');
    PAGES = [
      page('own', 'Anno domini', cs, { collectionId: 'col-1' }),
      page('shared', 'Anno domini', cs, { userId: 'user-2', collectionId: 'col-shared' }),
      page('shared-archived', 'Anno domini', cs, {
        userId: 'user-2',
        collectionId: 'col-shared',
        status: 'archived',
      }),
      page('shared-pending', 'Anno domini', cs, {
        userId: 'user-2',
        collectionId: 'col-shared',
        status: 'pending',
      }),
      page('public', 'Anno domini', cs, { userId: 'user-2', collectionId: 'col-public' }),
      page('public-archived', 'Anno domini', cs, {
        userId: 'user-2',
        collectionId: 'col-public',
        status: 'archived',
      }),
      page('private', 'Anno domini', cs, { userId: 'user-2', collectionId: 'col-private' }),
    ];
  });

  const ids = async (params: Record<string, string> = {}): Promise<string[]> =>
    (await search('domini', undefined, params)).map((r) => r.pageId);

  it('nečlen cizího soukromého svazku dostane [] – stejně jako u neexistujícího svazku', async () => {
    expect(await ids({ collectionId: 'col-private' })).toEqual([]);
    expect(await ids({ collectionId: 'col-missing' })).toEqual([]);
    expect(mockPageFindMany).not.toHaveBeenCalled();
  });

  it('člen sdíleného workspace hledá ve stránkách svazku, archivované a nezpracované ne', async () => {
    expect(await ids({ collectionId: 'col-shared' })).toEqual(['shared']);
  });

  it('čtenář veřejného svazku hledá ve stránkách svazku, archivované ne', async () => {
    expect(await ids({ collectionId: 'col-public' })).toEqual(['public']);
  });

  it('kořen bez collectionId hledá jen ve vlastních stránkách', async () => {
    expect(await ids()).toEqual(['own']);
    // Filtr userId v dotazu zůstává
    expect(mockPageFindMany.mock.calls[0]![0].where).toMatchObject({ userId: 'user-1' });
  });

  it('čtenář: překlad do jazyka UI má přednost, jinak se hledá v zobrazeném náhradním překladu', async () => {
    PAGES = [
      page(
        'with-cs',
        'Anno',
        [
          { language: 'cs', text: 'Léta Páně' },
          { language: 'en', text: 'year of the Lord' },
        ],
        { userId: 'user-2', collectionId: 'col-shared' },
      ),
      // Bez češtiny panel čtenáři ukáže anglický překlad (pořadí jazyků cs, en, de…)
      page(
        'fallback',
        'Anno',
        [
          { language: 'de', text: 'Jahr des Herrn' },
          { language: 'en', text: 'year of the Lord' },
        ],
        { userId: 'user-2', collectionId: 'col-shared' },
      ),
    ];

    // Angličtina je u „with-cs“ skrytá (zobrazí se čeština), u „fallback“ viditelná
    expect(await search('Lord', undefined, { collectionId: 'col-shared' })).toEqual([
      expect.objectContaining({ pageId: 'fallback', matches: 1 }),
    ]);
    // Němčinu panel neukáže nikde
    expect(await search('Herrn', undefined, { collectionId: 'col-shared' })).toEqual([]);
  });

  it('čtenář nenačítá texty všech překladů – jen text zobrazeného překladu', async () => {
    PAGES = [
      page(
        'fallback',
        'Anno domini',
        [
          { language: 'de', text: 'Jahr des Herrn' },
          { language: 'en', text: 'year of the Lord' },
          { language: 'la', text: 'anno domini' },
        ],
        { userId: 'user-2', collectionId: 'col-shared' },
      ),
    ];

    expect(await ids({ collectionId: 'col-shared' })).toEqual(['fallback']);
    // Seznam stránek nese u překladů jen jazyk
    const pageSelect = mockPageFindMany.mock.calls[0]![0].select as {
      document: { select: { translations: { select: Record<string, boolean> } } };
    };
    expect(pageSelect.document.select.translations.select).toEqual({ language: true });
    // Texty se dotáhnou jen pro zobrazený překlad (en), ne pro de ani la
    const loaded = (await mockTranslationFindMany.mock.results[0]!.value) as Row[];
    expect(loaded).toEqual([{ documentId: 'doc-fallback', text: 'year of the Lord' }]);
  });
});

describe('GET /api/pages/search – zátěž (limit výsledků, rate limit cizích svazků)', () => {
  const cs = [{ language: 'cs', text: 'Léta Páně' }];

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimit('search:user-1');
  });

  it('nejvýš 300 stránek; víc kandidátů → truncated, malé hledání truncated nemá', async () => {
    PAGES = Array.from({ length: 302 }, (_, i) =>
      page(`p${i}`, 'Anno domini', cs, { userId: 'user-2', collectionId: 'col-public' }),
    );
    const many = await searchRaw('domini', undefined, { collectionId: 'col-public' });
    expect(many.status).toBe(200);
    expect(many.body.results).toHaveLength(300);
    expect(many.body.truncated).toBe(true);
    expect(mockPageFindMany.mock.calls[0]![0].take).toBe(301);

    PAGES = PAGES.slice(0, 300);
    const exact = await searchRaw('domini', undefined, { collectionId: 'col-public' });
    expect(exact.body.results).toHaveLength(300);
    expect(exact.body.truncated).toBe(false);
  });

  it('čtenář: 301 kandidátů se shodou jen ve skrytém jazyce nevytlačí viditelnou shodu', async () => {
    PAGES = [
      // Shoda jen v angličtině, ale panel ukáže češtinu → v DB se kandidáty nestanou
      ...Array.from({ length: 301 }, (_, i) =>
        page(
          `hidden${String(i).padStart(3, '0')}`,
          'Anno',
          [
            { language: 'cs', text: 'Léta Páně' },
            { language: 'en', text: 'year of the Lord' },
          ],
          { userId: 'user-2', collectionId: 'col-public', order: 0 },
        ),
      ),
      // Bez češtiny se zobrazí angličtina → viditelná shoda až za nimi
      page('visible', 'Anno', [{ language: 'en', text: 'year of the Lord' }], {
        userId: 'user-2',
        collectionId: 'col-public',
        order: 1,
      }),
    ];

    const { status, body } = await searchRaw('Lord', undefined, { collectionId: 'col-public' });
    expect(status).toBe(200);
    expect(body.results.map((r) => r.pageId)).toEqual(['visible']);
    expect(body.truncated).toBe(false);
  });

  it('vlastník: shoda v DB jen v překladu do jazyka UI, skryté jazyky limit nevyčerpají', async () => {
    PAGES = [
      ...Array.from({ length: 301 }, (_, i) =>
        page(
          `hidden${String(i).padStart(3, '0')}`,
          'Anno',
          [
            { language: 'cs', text: 'Léta Páně' },
            { language: 'en', text: 'year of the Lord' },
          ],
          { order: 0 },
        ),
      ),
      page('visible', 'Anno', [{ language: 'cs', text: 'Lord v češtině' }], { order: 1 }),
    ];

    const { body } = await searchRaw('Lord', undefined, { collectionId: 'col-1' });
    expect(body.results.map((r) => r.pageId)).toEqual(['visible']);
    expect(body.truncated).toBe(false);
  });

  it('hledání v cizím svazku má rate limit (429 s hláškou), ve vlastním ne', async () => {
    PAGES = [
      page('public', 'Anno domini', cs, { userId: 'user-2', collectionId: 'col-public' }),
      page('own', 'Anno domini', cs, { collectionId: 'col-1' }),
    ];
    for (let i = 0; i < 60; i++) {
      expect((await searchRaw('domini', undefined, { collectionId: 'col-public' })).status).toBe(
        200,
      );
    }
    const limited = await searchRaw('domini', undefined, { collectionId: 'col-public' });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('Příliš mnoho požadavků, zkuste to prosím později');

    // Vlastní svazek ani kořen se neomezují
    for (let i = 0; i < 5; i++) {
      expect((await searchRaw('domini', undefined, { collectionId: 'col-1' })).status).toBe(200);
      expect((await searchRaw('domini')).status).toBe(200);
    }
  });

  it('do rate limitu se počítá i zkoušení cizích a neexistujících svazků', async () => {
    PAGES = [];
    for (let i = 0; i < 60; i++) {
      await searchRaw('domini', undefined, { collectionId: i % 2 ? 'col-private' : 'col-missing' });
    }
    expect((await searchRaw('domini', undefined, { collectionId: 'col-private' })).status).toBe(
      429,
    );
  });
});
