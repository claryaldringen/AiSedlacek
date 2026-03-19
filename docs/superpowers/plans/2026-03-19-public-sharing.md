# Public Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to make collections and pages publicly viewable at `/view/{slug}` without authentication.

**Architecture:** Add `isPublic` and `slug` fields to Collection and Page models, with a `PublicSlug` table for global slug uniqueness. New public API endpoint at `/api/public/[slug]` and Next.js pages at `/view/[slug]`. Sharing is toggled via context menu and detail panel.

**Tech Stack:** Next.js 15 App Router, Prisma ORM, PostgreSQL, React 19, Tailwind CSS v4, Vitest

**Spec:** `docs/superpowers/specs/2026-03-19-public-sharing-design.md`

---

## File Structure

### New files
| Path | Responsibility |
|------|---------------|
| `apps/web/lib/infrastructure/slugify.ts` | Slug generation + collision resolution |
| `apps/web/app/api/public/[slug]/route.ts` | Public API endpoint |
| `apps/web/app/view/[slug]/page.tsx` | Public view page (collection grid or page detail) |
| `apps/web/app/view/[slug]/[pageId]/page.tsx` | Public page detail within collection |
| `apps/web/app/view/[slug]/not-found.tsx` | Next.js not-found boundary: "Tento obsah již není dostupný" |
| `apps/web/components/PublicResultViewer.tsx` | Readonly version of ResultViewer |
| `apps/web/components/ShareDialog.tsx` | Share toggle + slug editor + copy link |
| `apps/web/app/api/public/__tests__/public-slug.test.ts` | Tests for public endpoint |
| `apps/web/lib/infrastructure/__tests__/slugify.test.ts` | Tests for slug generation |
| `apps/web/app/api/collections/__tests__/sharing.test.ts` | Tests for collection sharing PATCH/DELETE |
| `apps/web/app/api/pages/__tests__/sharing.test.ts` | Tests for page sharing PATCH/DELETE |

### Modified files
| Path | Change |
|------|--------|
| `apps/web/prisma/schema.prisma` | Add `PublicSlug` model, `isPublic`+`slug` to Collection and Page |
| `apps/web/middleware.ts` | Allow `/view` and `/api/public` routes |
| `apps/web/app/api/collections/[id]/route.ts` | PATCH: handle `isPublic`/`slug`. DELETE: cleanup PublicSlug |
| `apps/web/app/api/pages/[id]/route.ts` | PATCH: handle `isPublic`/`slug`. DELETE: cleanup PublicSlug |
| `apps/web/components/FileGrid.tsx` | Share icon on public items |
| `apps/web/components/Sidebar.tsx` | Share icon on public collections, `isPublic` in Collection interface |
| `apps/web/app/workspace/page.tsx` | Wire up share actions, context menu items |

---

## Task 1: Prisma Schema + Migration

**Files:**
- Modify: `apps/web/prisma/schema.prisma`

- [ ] **Step 1: Add PublicSlug model and sharing fields to schema**

Add to `schema.prisma`:

```prisma
model PublicSlug {
  slug       String   @id
  targetType String   // "collection" | "page"
  targetId   String   @unique
  createdAt  DateTime @default(now())
}
```

Add to `Collection` model:
```prisma
  isPublic  Boolean  @default(false)
  slug      String?  @unique
```

Add to `Page` model:
```prisma
  isPublic  Boolean  @default(false)
  slug      String?  @unique
```

- [ ] **Step 2: Run migration**

```bash
npx prisma migrate dev --schema=apps/web/prisma/schema.prisma --name add-public-sharing
```

- [ ] **Step 3: Verify**

```bash
npx prisma generate --schema=apps/web/prisma/schema.prisma
npx turbo typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/prisma/
git commit -m "feat: přidán datový model pro veřejné sdílení (PublicSlug, isPublic, slug)"
```

---

## Task 2: Slug Generation Utility

**Files:**
- Create: `apps/web/lib/infrastructure/slugify.ts`
- Create: `apps/web/lib/infrastructure/__tests__/slugify.test.ts`

- [ ] **Step 1: Write tests for slugify**

```typescript
// apps/web/lib/infrastructure/__tests__/slugify.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindUnique = vi.fn();
vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    publicSlug: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

import { slugify, generateUniqueSlug } from '../slugify';

describe('slugify', () => {
  it('converts text to lowercase slug', () => {
    expect(slugify('Jenský kodex')).toBe('jensky-kodex');
  });

  it('handles diacritics', () => {
    expect(slugify('Příběhy z Čech')).toBe('pribehy-z-cech');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('foo   ---  bar')).toBe('foo-bar');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('--foo--')).toBe('foo');
  });

  it('truncates to 80 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });

  it('returns fallback for empty input', () => {
    expect(slugify('')).toBe('shared');
  });
});

describe('generateUniqueSlug', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns base slug when available', async () => {
    mockFindUnique.mockResolvedValue(null);
    const slug = await generateUniqueSlug('Jenský kodex');
    expect(slug).toBe('jensky-kodex');
  });

  it('appends suffix on collision', async () => {
    mockFindUnique
      .mockResolvedValueOnce({ slug: 'jensky-kodex' }) // taken
      .mockResolvedValueOnce(null); // free
    const slug = await generateUniqueSlug('Jenský kodex');
    expect(slug).toBe('jensky-kodex-2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run apps/web/lib/infrastructure/__tests__/slugify.test.ts
```

- [ ] **Step 3: Implement slugify**

```typescript
// apps/web/lib/infrastructure/slugify.ts
import { prisma } from '@/lib/infrastructure/db';

/**
 * Convert text to a URL-safe slug: lowercase, no diacritics, hyphens only.
 */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')    // non-alphanum → hyphen
    .replace(/-+/g, '-')            // collapse hyphens
    .replace(/^-|-$/g, '')          // trim hyphens
    .slice(0, 80);
  return slug || 'shared';
}

/**
 * Generate a unique slug by checking PublicSlug table. Appends -2, -3, etc. on collision.
 */
export async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;

  while (true) {
    const existing = await prisma.publicSlug.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
    candidate = `${base}-${suffix}`;
    suffix++;
    if (suffix > 100) throw new Error('Cannot generate unique slug');
  }
}

/**
 * Validate a user-provided slug.
 */
export function validateSlug(slug: string): string | null {
  if (slug.length < 3) return 'Slug musí mít alespoň 3 znaky';
  if (slug.length > 80) return 'Slug může mít maximálně 80 znaků';
  if (!/^[a-z0-9-]+$/.test(slug)) return 'Slug může obsahovat pouze malá písmena, čísla a pomlčky';
  if (slug.startsWith('-') || slug.endsWith('-')) return 'Slug nesmí začínat ani končit pomlčkou';
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run apps/web/lib/infrastructure/__tests__/slugify.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/infrastructure/slugify.ts apps/web/lib/infrastructure/__tests__/slugify.test.ts
git commit -m "feat: slugify utilita pro generování unikátních slugů"
```

---

## Task 3: Update PATCH/DELETE Endpoints for Sharing

**Files:**
- Modify: `apps/web/app/api/collections/[id]/route.ts`
- Modify: `apps/web/app/api/pages/[id]/route.ts`
- Create: `apps/web/app/api/collections/__tests__/sharing.test.ts`
- Create: `apps/web/app/api/pages/__tests__/sharing.test.ts`

- [ ] **Step 1: Write sharing tests for collections PATCH**

```typescript
// apps/web/app/api/collections/__tests__/sharing.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockTransaction = vi.fn();
const mockSlugFindUnique = vi.fn();
const mockSlugCreate = vi.fn();
const mockSlugDeleteMany = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    collection: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      delete: (...a: unknown[]) => mockDelete(...a),
    },
    publicSlug: {
      findUnique: (...a: unknown[]) => mockSlugFindUnique(...a),
      create: (...a: unknown[]) => mockSlugCreate(...a),
      deleteMany: (...a: unknown[]) => mockSlugDeleteMany(...a),
    },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => mockTransaction(fn),
  },
}));

vi.mock('@/lib/auth', () => ({
  requireUserId: vi.fn().mockResolvedValue('user-1'),
}));

vi.mock('@/lib/infrastructure/slugify', () => ({
  generateUniqueSlug: vi.fn().mockResolvedValue('jensky-kodex'),
  validateSlug: vi.fn().mockReturnValue(null),
}));

import { PATCH } from '@/app/api/collections/[id]/route';

const ctx = { params: Promise.resolve({ id: 'col-1' }) };
const COLLECTION = { id: 'col-1', userId: 'user-1', name: 'Jenský kodex', isPublic: false, slug: null };

function makeReq(body: unknown): NextRequest {
  return new NextRequest(new Request('http://localhost/api/collections/col-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('PATCH /api/collections/[id] — sharing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets isPublic and generates slug when body is { isPublic: true }', async () => {
    mockFindUnique.mockResolvedValue(COLLECTION);
    mockTransaction.mockImplementation(async (fn) => {
      const tx = { publicSlug: { deleteMany: mockSlugDeleteMany, create: mockSlugCreate }, collection: { update: mockUpdate } };
      return fn(tx);
    });
    mockUpdate.mockResolvedValue({ ...COLLECTION, isPublic: true, slug: 'jensky-kodex' });

    const res = await PATCH(makeReq({ isPublic: true }), ctx);
    expect(res.status).toBe(200);
    // Should NOT return 400 "Nic k aktualizaci"
    const json = await res.json();
    expect(json.isPublic).toBe(true);
  });

  it('returns 400 for invalid slug', async () => {
    mockFindUnique.mockResolvedValue(COLLECTION);
    const { validateSlug } = await import('@/lib/infrastructure/slugify');
    (validateSlug as ReturnType<typeof vi.fn>).mockReturnValueOnce('Slug příliš krátký');

    const res = await PATCH(makeReq({ slug: 'ab' }), ctx);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run apps/web/app/api/collections/__tests__/sharing.test.ts
```

- [ ] **Step 3: Update collections PATCH handler**

In `apps/web/app/api/collections/[id]/route.ts`:

1. Add import: `import { generateUniqueSlug, validateSlug } from '@/lib/infrastructure/slugify';`
2. **Extend the `data` type** to include `isPublic` and `slug`:
```typescript
const data: {
  name?: string;
  description?: string;
  context?: string;
  contextUrls?: string[];
  isPublic?: boolean;
  slug?: string;
} = {};
```
3. Extract `isPublic` and `slug` from body **alongside** existing fields (before the empty-check):
```typescript
const { name, description, context, contextUrls, isPublic: isPublicInput, slug: slugInput } = body as {
  name?: unknown; description?: unknown; context?: unknown; contextUrls?: unknown;
  isPublic?: unknown; slug?: unknown;
};

// ... existing field handling ...

if (typeof isPublicInput === 'boolean') {
  data.isPublic = isPublicInput;
  if (isPublicInput && !collection.slug) {
    data.slug = await generateUniqueSlug(collection.name);
  }
}

if (typeof slugInput === 'string') {
  const trimmed = slugInput.trim();
  const slugError = validateSlug(trimmed);
  if (slugError) {
    return NextResponse.json({ error: slugError }, { status: 400 });
  }
  data.slug = trimmed;
}
```
4. The empty-check `Object.keys(data).length === 0` now fires AFTER sharing fields are added — no short-circuit.
5. Replace the existing `prisma.collection.update` with transaction logic when sharing fields are present:
```typescript
if (data.isPublic !== undefined || data.slug !== undefined) {
  const finalSlug = data.slug ?? collection.slug;
  const finalPublic = data.isPublic ?? collection.isPublic;
  try {
    const updated = await prisma.$transaction(async (tx) => {
      await tx.publicSlug.deleteMany({ where: { targetId: id } });
      if (finalPublic && finalSlug) {
        await tx.publicSlug.create({
          data: { slug: finalSlug, targetType: 'collection', targetId: id },
        });
      }
      return tx.collection.update({ where: { id }, data });
    });
    return NextResponse.json(updated);
  } catch (err) {
    // Handle unique constraint violation (P2002) — slug already taken
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      return NextResponse.json({ error: 'Tento slug je již obsazený' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Svazek nenalezen' }, { status: 404 });
  }
}
```

- [ ] **Step 4: Update collections DELETE to cleanup PublicSlug**

Replace the delete call with a transaction:
```typescript
await prisma.$transaction(async (tx) => {
  await tx.publicSlug.deleteMany({ where: { targetId: id } });
  await tx.collection.delete({ where: { id } });
});
```

- [ ] **Step 5: Apply same pattern to pages PATCH and DELETE**

Same changes in `apps/web/app/api/pages/[id]/route.ts`:
- Extend `data` type with `isPublic?: boolean; slug?: string`
- Extract `isPublic`/`slug` from body before empty-check
- Slug source: `page.displayName ?? 'page-' + id.slice(0, 8)`
- Transaction for update and delete
- Handle P2002 for slug collision
- Write `apps/web/app/api/pages/__tests__/sharing.test.ts` following same pattern

- [ ] **Step 6: Add Prisma middleware for cascade cleanup**

In `apps/web/lib/infrastructure/db.ts`, add middleware to clean up orphaned PublicSlug records when Collection or Page is deleted by cascade (e.g. User deletion):

```typescript
prisma.$use(async (params, next) => {
  const result = await next(params);
  if (params.action === 'delete' && (params.model === 'Collection' || params.model === 'Page')) {
    const deletedId = params.args?.where?.id;
    if (deletedId) {
      await prisma.publicSlug.deleteMany({ where: { targetId: deletedId } }).catch(() => {});
    }
  }
  return result;
});
```

Note: This is a best-effort cleanup. For bulk cascade deletes (e.g. `deleteMany`), a periodic cleanup job would be needed but is out of scope for v1.

- [ ] **Step 7: Run all tests**

```bash
npx turbo typecheck
npx vitest run
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/api/collections/ apps/web/app/api/pages/ apps/web/lib/infrastructure/db.ts
git commit -m "feat: PATCH/DELETE endpointy podporují isPublic a slug s transakcemi"
```

---

## Task 4: Public API Endpoint

**Files:**
- Create: `apps/web/app/api/public/[slug]/route.ts`
- Create: `apps/web/app/api/public/__tests__/public-slug.test.ts`

- [ ] **Step 1: Write tests**

```typescript
// apps/web/app/api/public/__tests__/public-slug.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSlugFindUnique = vi.fn();
const mockCollectionFindUnique = vi.fn();
const mockPageFindUnique = vi.fn();

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    publicSlug: { findUnique: (...a: unknown[]) => mockSlugFindUnique(...a) },
    collection: { findUnique: (...a: unknown[]) => mockCollectionFindUnique(...a) },
    page: { findUnique: (...a: unknown[]) => mockPageFindUnique(...a) },
  },
}));

vi.mock('@/lib/auth', () => ({
  requireUserId: vi.fn(),
  getCurrentUserId: vi.fn(),
}));

import { GET } from '@/app/api/public/[slug]/route';

const ctx = { params: Promise.resolve({ slug: 'jensky-kodex' }) };

describe('GET /api/public/[slug]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when slug does not exist', async () => {
    mockSlugFindUnique.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/public/jensky-kodex');
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });

  it('returns collection with pages when slug targets a public collection', async () => {
    mockSlugFindUnique.mockResolvedValue({ slug: 'jensky-kodex', targetType: 'collection', targetId: 'col-1' });
    mockCollectionFindUnique.mockResolvedValue({
      id: 'col-1', name: 'Jenský kodex', description: 'Popis', context: '', isPublic: true,
      pages: [{ id: 'p1', displayName: 'Folio 1', thumbnailUrl: '/thumb.jpg', imageUrl: '/img.jpg', status: 'done', order: 0,
        document: { transcription: 'text', detectedLanguage: 'cs', context: 'ctx',
          translations: [{ language: 'cs', text: 'překlad' }],
          glossary: [{ term: 'slovo', definition: 'def' }] } }],
    });
    const req = new NextRequest('http://localhost/api/public/jensky-kodex');
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe('collection');
    expect(json.name).toBe('Jenský kodex');
    expect(json.pages).toHaveLength(1);
  });

  it('returns 404 when collection is not public', async () => {
    mockSlugFindUnique.mockResolvedValue({ slug: 'jensky-kodex', targetType: 'collection', targetId: 'col-1' });
    mockCollectionFindUnique.mockResolvedValue({ id: 'col-1', isPublic: false });
    const req = new NextRequest('http://localhost/api/public/jensky-kodex');
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run apps/web/app/api/public/__tests__/public-slug.test.ts
```

- [ ] **Step 3: Implement public endpoint**

```typescript
// apps/web/app/api/public/[slug]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/infrastructure/db';

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  const { slug } = await params;

  const publicSlug = await prisma.publicSlug.findUnique({ where: { slug } });
  if (!publicSlug) {
    return NextResponse.json({ error: 'Nenalezeno' }, { status: 404 });
  }

  if (publicSlug.targetType === 'collection') {
    const collection = await prisma.collection.findUnique({
      where: { id: publicSlug.targetId },
      include: {
        pages: {
          orderBy: { order: 'asc' },
          include: {
            document: {
              include: {
                translations: { select: { language: true, text: true } },
                glossary: { select: { term: true, definition: true } },
              },
            },
          },
        },
      },
    });

    if (!collection || !collection.isPublic) {
      return NextResponse.json({ error: 'Nenalezeno' }, { status: 404 });
    }

    return NextResponse.json({
      type: 'collection',
      name: collection.name,
      description: collection.description,
      context: collection.context,
      pages: collection.pages.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        thumbnailUrl: p.thumbnailUrl,
        imageUrl: p.imageUrl,
        status: p.status,
        order: p.order,
        document: p.document ? {
          transcription: p.document.transcription,
          detectedLanguage: p.document.detectedLanguage,
          context: p.document.context,
          translations: p.document.translations,
          glossary: p.document.glossary,
        } : null,
      })),
    });
  }

  if (publicSlug.targetType === 'page') {
    const page = await prisma.page.findUnique({
      where: { id: publicSlug.targetId },
      include: {
        document: {
          include: {
            translations: { select: { language: true, text: true } },
            glossary: { select: { term: true, definition: true } },
          },
        },
      },
    });

    if (!page || !page.isPublic) {
      return NextResponse.json({ error: 'Nenalezeno' }, { status: 404 });
    }

    return NextResponse.json({
      type: 'page',
      displayName: page.displayName,
      imageUrl: page.imageUrl,
      status: page.status,
      document: page.document ? {
        transcription: page.document.transcription,
        detectedLanguage: page.document.detectedLanguage,
        context: page.document.context,
        translations: page.document.translations,
        glossary: page.document.glossary,
      } : null,
    });
  }

  return NextResponse.json({ error: 'Nenalezeno' }, { status: 404 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run apps/web/app/api/public/__tests__/public-slug.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/public/
git commit -m "feat: veřejný API endpoint GET /api/public/[slug]"
```

---

## Task 5: Middleware Update

**Files:**
- Modify: `apps/web/middleware.ts`

- [ ] **Step 1: Add /view and /api/public to public routes**

In `apps/web/middleware.ts`, update the `isPublic` check:

```typescript
const isPublic =
  req.nextUrl.pathname === '/' ||
  req.nextUrl.pathname.startsWith('/login') ||
  req.nextUrl.pathname.startsWith('/view') ||
  req.nextUrl.pathname.startsWith('/api/auth') ||
  req.nextUrl.pathname.startsWith('/api/public');
```

- [ ] **Step 2: Verify**

```bash
npx turbo typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/middleware.ts
git commit -m "feat: middleware povoluje veřejné cesty /view a /api/public"
```

---

## Task 6: Public View Pages

**Files:**
- Create: `apps/web/components/PublicResultViewer.tsx`
- Create: `apps/web/app/view/[slug]/page.tsx`
- Create: `apps/web/app/view/[slug]/[pageId]/page.tsx`

- [ ] **Step 1: Create PublicResultViewer (readonly)**

Simplified readonly version of `ResultViewer` — no edit buttons, no version history, no metadata.

```typescript
// apps/web/components/PublicResultViewer.tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface PublicDocument {
  transcription: string;
  detectedLanguage: string;
  context: string;
  translations: { language: string; text: string }[];
  glossary: { term: string; definition: string }[];
}

function Section({ title, content }: { title: string; content: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
        <h2 className="text-sm font-semibold text-stone-700">{title}</h2>
      </div>
      <div className="prose prose-stone prose-sm max-w-none p-4">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}

export function PublicResultViewer({ document }: { document: PublicDocument }): React.JSX.Element {
  const translation = document.translations[0];

  return (
    <div className="flex flex-col gap-px bg-stone-200">
      {/* Row 1: Transcription | Translation */}
      <div className="flex flex-1 gap-px">
        <Section
          title={`Transkripce (${document.detectedLanguage})`}
          content={document.transcription}
        />
        {translation && (
          <Section
            title={`Překlad (${translation.language})`}
            content={translation.text}
          />
        )}
      </div>

      {/* Row 2: Glossary | Context */}
      <div className="flex gap-px">
        {document.glossary.length > 0 && (
          <div className="flex flex-1 flex-col">
            <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
              <h2 className="text-sm font-semibold text-stone-700">Glosář</h2>
            </div>
            <div className="p-4">
              <dl className="space-y-2">
                {document.glossary.map((g) => (
                  <div key={g.term}>
                    <dt className="text-sm font-medium text-stone-800">{g.term}</dt>
                    <dd className="text-sm text-stone-600">{g.definition}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}
        {document.context && (
          <Section title="Kontext" content={document.context} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create /view/[slug]/not-found.tsx**

```typescript
// apps/web/app/view/[slug]/not-found.tsx
export default function NotFound(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-stone-700">Tento obsah již není dostupný</h1>
        <p className="mt-2 text-stone-500">Odkaz mohl být zrušen nebo obsah smazán.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create /view/[slug]/page.tsx**

Server component that queries Prisma directly (no API round-trip). Uses `notFound()` from `next/navigation` for missing/private content, which renders the `not-found.tsx` above.

```typescript
// apps/web/app/view/[slug]/page.tsx
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/infrastructure/db';
import type { Metadata } from 'next';

type Props = { params: Promise<{ slug: string }> };

// SEO metadata
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const ps = await prisma.publicSlug.findUnique({ where: { slug } });
  if (!ps) return { title: 'Nenalezeno' };

  if (ps.targetType === 'collection') {
    const col = await prisma.collection.findUnique({ where: { id: ps.targetId }, select: { name: true, description: true, isPublic: true } });
    if (!col?.isPublic) return { title: 'Nenalezeno' };
    return {
      title: col.name,
      description: col.description || `Veřejná kolekce: ${col.name}`,
      openGraph: { title: col.name, description: col.description || undefined },
    };
  }
  // page
  const page = await prisma.page.findUnique({ where: { id: ps.targetId }, select: { displayName: true, isPublic: true } });
  if (!page?.isPublic) return { title: 'Nenalezeno' };
  return { title: page.displayName || 'Dokument', openGraph: { title: page.displayName || 'Dokument' } };
}

export default async function PublicViewPage({ params }: Props) {
  // ... fetch data, call notFound() if missing/private, render collection grid or page detail
}
```

Key structure:
- Fetch data server-side via direct Prisma query (no API round-trip)
- If `type === 'collection'`: grid of page thumbnails with links to `/view/[slug]/[pageId]`
- If `type === 'page'`: image left + PublicResultViewer right
- If not found or not public: call `notFound()` → renders `not-found.tsx`

- [ ] **Step 3: Create /view/[slug]/[pageId]/page.tsx**

Page detail within a collection:
- Fetch collection data, find specific page by ID
- Image left + PublicResultViewer right
- Prev/Next navigation buttons
- Back link to collection

- [ ] **Step 4: Verify**

```bash
npx turbo typecheck
```

- [ ] **Step 5: Manual test**

1. Create a collection, mark as public via API (PATCH with `{ isPublic: true }`)
2. Visit `/view/{slug}` — should show collection grid
3. Click a page — should show detail at `/view/{slug}/{pageId}`
4. Visit `/view/nonexistent` — should show "Tento obsah již není dostupný"

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/PublicResultViewer.tsx apps/web/app/view/
git commit -m "feat: veřejné zobrazení kolekcí a stránek na /view/[slug]"
```

---

## Task 7: Share UI (Context Menu + Dialog)

**Files:**
- Create: `apps/web/components/ShareDialog.tsx`
- Modify: `apps/web/app/workspace/page.tsx`
- Modify: `apps/web/components/FileGrid.tsx`
- Modify: `apps/web/components/Sidebar.tsx`

- [ ] **Step 1: Create ShareDialog component**

Modal dialog with:
- Toggle switch for public/private
- Slug input field (editable, with validation feedback)
- Full URL display with copy button
- "Uložit" button

```typescript
// apps/web/components/ShareDialog.tsx
'use client';
import { useState, useCallback } from 'react';

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  itemId: string;
  itemType: 'collection' | 'page';
  itemName: string;
  currentIsPublic: boolean;
  currentSlug: string | null;
  onUpdate: (isPublic: boolean, slug: string | null) => void;
}
```

Dialog calls PATCH on the appropriate endpoint (`/api/collections/{id}` or `/api/pages/{id}`) with `{ isPublic, slug }`.

- [ ] **Step 2: Add share context menu items in workspace page**

In `apps/web/app/workspace/page.tsx`, add context menu entries:
- For collections: "Sdílet veřejně" / "Zrušit sdílení" (based on `isPublic`)
- For pages: same

Both open ShareDialog with the appropriate props.

- [ ] **Step 3: Add share icon to FileGrid**

In `PageCard` component in `apps/web/components/FileGrid.tsx`, add a small link icon overlay when `page.isPublic === true`. Use the same style pattern as the blank icon.

- [ ] **Step 4: Add share icon to Sidebar**

In `apps/web/components/Sidebar.tsx`, update Collection interface to include `isPublic` and `slug`. Show small link icon next to collection name when public.

- [ ] **Step 5: Verify**

```bash
npx turbo typecheck
```

- [ ] **Step 6: Manual test**

1. Right-click a collection → "Sdílet veřejně" → ShareDialog opens
2. Toggle on → slug generated, URL shown
3. Copy URL → opens in incognito → shows public collection
4. Toggle off → public URL returns "Tento obsah již není dostupný"
5. Share icon visible on public items in grid and sidebar

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ShareDialog.tsx apps/web/app/workspace/page.tsx apps/web/components/FileGrid.tsx apps/web/components/Sidebar.tsx
git commit -m "feat: UI pro veřejné sdílení (dialog, kontextové menu, ikony)"
```

---

## Task 8: Final Verification

- [ ] **Step 1: Run full validation suite**

```bash
npx turbo typecheck && npx turbo lint && npx turbo format:check && npx turbo test
```

- [ ] **Step 2: Fix any issues found**

- [ ] **Step 3: End-to-end manual test**

1. Create collection with pages
2. Process some pages (OCR)
3. Share collection publicly
4. Open public URL in incognito browser
5. Verify: grid view, page detail, prev/next navigation, SEO metadata
6. Edit slug → verify URL changes
7. Unshare → verify 404
8. Share individual page (not in collection)
9. Delete shared collection → verify 404
10. Verify no auth-related data leaks in public API responses

- [ ] **Step 4: Final commit if any fixes needed**
