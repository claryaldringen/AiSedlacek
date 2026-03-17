# Cleanup & Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all dead code, delete legacy API routes, and bring test coverage from 8.8% to full coverage of all adapters, infrastructure, and API routes.

**Architecture:** Three phases: (1) delete dead code and verify no regressions, (2) write tests for existing untested modules using mocked Prisma and Anthropic SDK, (3) update CLAUDE.md structure section. All tests use Vitest with `vi.mock()` for external dependencies.

**Tech Stack:** Vitest 3, TypeScript, Prisma (mocked), Anthropic SDK (mocked), Next.js API routes

---

## Phase 1: Dead Code Removal

### Task 1: Delete unused components

**Files:**
- Delete: `apps/web/components/CollectionSelector.tsx`
- Delete: `apps/web/components/DocumentList.tsx`
- Delete: `apps/web/components/FileUpload.tsx`
- Delete: `apps/web/components/PageGrid.tsx`
- Delete: `apps/web/components/ProcessingStatus.tsx`

- [ ] **Step 1: Delete the 5 unused component files**

```bash
cd /Users/martinzadrazil/WebstormProjects/AiSedlacek
rm apps/web/components/CollectionSelector.tsx
rm apps/web/components/DocumentList.tsx
rm apps/web/components/FileUpload.tsx
rm apps/web/components/PageGrid.tsx
rm apps/web/components/ProcessingStatus.tsx
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `npx turbo typecheck`
Expected: 2 successful tasks, 0 errors. If anything fails, a file we deleted was imported somewhere — investigate and fix.

- [ ] **Step 3: Commit**

```bash
git add -u apps/web/components/
git commit -m "refactor: smazání 5 nepoužívaných komponent

CollectionSelector, DocumentList, FileUpload, PageGrid, ProcessingStatus
nejsou importovány žádným jiným souborem."
```

### Task 2: Delete legacy API routes

**Files:**
- Delete: `apps/web/app/api/process/route.ts`
- Delete: `apps/web/app/api/upload/route.ts`
- Delete: `apps/web/app/api/documents/route.ts`

These are superseded by `/api/pages/process`, `/api/pages/upload`, and direct document fetches via `/api/documents/[id]`.

- [ ] **Step 1: Delete the 3 legacy route files and their empty parent dirs**

```bash
cd /Users/martinzadrazil/WebstormProjects/AiSedlacek
rm apps/web/app/api/process/route.ts
rmdir apps/web/app/api/process
rm apps/web/app/api/upload/route.ts
rmdir apps/web/app/api/upload
rm apps/web/app/api/documents/route.ts
```

Note: `apps/web/app/api/documents/` directory stays — it still has `[id]/` subdirectory.

- [ ] **Step 2: Verify typecheck passes**

Run: `npx turbo typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add -u apps/web/app/api/
git commit -m "refactor: smazání legacy API routes

/api/process, /api/upload a GET /api/documents nahrazeny
/api/pages/process, /api/pages/upload a /api/documents/[id]."
```

### Task 3: Delete dead lib modules and their tests

The `SharpPreprocessor` class in `sharp.ts` is never instantiated in production code (Sharp is used directly in `claude-vision.ts`). The `container.ts` DI functions `getLlmProvider()` and `getStorageProvider()` are never called from any route.

**Files:**
- Delete: `apps/web/lib/adapters/preprocessing/sharp.ts`
- Delete: `apps/web/lib/adapters/preprocessing/__tests__/sharp.test.ts`
- Delete: `apps/web/lib/infrastructure/container.ts`
- Delete: `apps/web/lib/infrastructure/__tests__/container.test.ts`

- [ ] **Step 1: Delete the 4 files**

```bash
cd /Users/martinzadrazil/WebstormProjects/AiSedlacek
rm apps/web/lib/adapters/preprocessing/sharp.ts
rm -rf apps/web/lib/adapters/preprocessing/__tests__
rmdir apps/web/lib/adapters/preprocessing
rm apps/web/lib/infrastructure/container.ts
rm -rf apps/web/lib/infrastructure/__tests__
```

- [ ] **Step 2: Verify typecheck and tests pass**

Run: `npx turbo typecheck && npx turbo test`
Expected: PASS. Test count drops from 17 to 4 (only local-storage tests remain).

- [ ] **Step 3: Commit**

```bash
git add -u apps/web/lib/
git commit -m "refactor: smazání nepoužívaného SharpPreprocessor a DI containeru

SharpPreprocessor se v produkci nevolá (Sharp se používá přímo v claude-vision.ts).
getLlmProvider/getStorageProvider z container.ts se nikde nevolají."
```

### Task 4: Verify full validation pipeline after cleanup

- [ ] **Step 1: Run complete validation**

Run: `npx turbo typecheck && npx turbo lint && npx turbo test`
Expected: All pass.

- [ ] **Step 2: Commit if any fixes were needed**

---

## Phase 2: Test Coverage

All tests follow the existing project pattern: Vitest with `vi.mock()`, `describe`/`it` blocks, test files in `__tests__/` directories next to the module under test.

### Task 5: Test `versioning.ts`

**Files:**
- Test: `apps/web/lib/infrastructure/__tests__/versioning.test.ts`
- Module: `apps/web/lib/infrastructure/versioning.ts`

- [ ] **Step 1: Write the test file**

```typescript
// apps/web/lib/infrastructure/__tests__/versioning.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createVersion } from '../versioning';

// Mock Prisma
vi.mock('../db', () => ({
  prisma: {
    documentVersion: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from '../db';

const mockFindFirst = vi.mocked(prisma.documentVersion.findFirst);
const mockCreate = vi.mocked(prisma.documentVersion.create);

describe('createVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates first version with version=1 when no prior versions exist', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({} as never);

    await createVersion('doc-1', 'transcription', 'text content', 'ai_initial', 'claude-opus-4-6');

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { documentId: 'doc-1' },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        documentId: 'doc-1',
        version: 1,
        field: 'transcription',
        content: 'text content',
        source: 'ai_initial',
        model: 'claude-opus-4-6',
      },
    });
  });

  it('increments version number based on last existing version', async () => {
    mockFindFirst.mockResolvedValue({ version: 3 } as never);
    mockCreate.mockResolvedValue({} as never);

    await createVersion('doc-1', 'translation:cs', 'překlad', 'manual_edit');

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 4,
        field: 'translation:cs',
        source: 'manual_edit',
        model: undefined,
      }),
    });
  });

  it('passes undefined model when not provided', async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue({} as never);

    await createVersion('doc-1', 'context', 'kontext', 'manual_edit');

    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ model: undefined }),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/infrastructure/__tests__/versioning.test.ts`
Expected: 3 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/infrastructure/__tests__/versioning.test.ts
git commit -m "test: testy pro versioning.ts (auto-increment, model optional)"
```

### Task 6: Test `claude-vision.ts` (pure functions)

The `processWithClaude` function depends on Anthropic SDK streaming which is complex to mock. Focus on the testable pure logic: `detectMediaType` (private but testable through export) and JSON parsing.

**Files:**
- Modify: `apps/web/lib/adapters/ocr/claude-vision.ts` — export `detectMediaType` and `parseOcrJson` as named exports for testability
- Test: `apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts`

- [ ] **Step 1: Extract JSON parsing into a testable function**

In `claude-vision.ts`, the JSON parsing logic (lines 128-142) is inline. Extract it as an exported function:

Add at the top of `claude-vision.ts` (after the `StructuredOcrResult` interface, around line 37):

```typescript
export function parseOcrJson(raw: string): StructuredOcrResult {
  let jsonStr = raw.trim();
  // Strip ```json ... ``` fences
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1] ?? jsonStr;
  }
  // If still not starting with {, try to find the JSON object
  if (!jsonStr.startsWith('{')) {
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd !== -1) {
      jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
    }
  }
  return JSON.parse(jsonStr) as StructuredOcrResult;
}
```

Also export `detectMediaType`:

Change line 6 from `function detectMediaType(buffer: Buffer): ImageMediaType {`
to `export function detectMediaType(buffer: Buffer): ImageMediaType {`

Then update `processWithClaude` to use `parseOcrJson(text)` instead of the inline parsing (replace lines 128-142 with `const parsed = parseOcrJson(text);`).

- [ ] **Step 2: Write the test file**

```typescript
// apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts
import { describe, it, expect } from 'vitest';
import { detectMediaType, parseOcrJson } from '../claude-vision';

const VALID_JSON: Record<string, unknown> = {
  transcription: 'Starý text',
  detectedLanguage: 'cs-old',
  translation: 'Moderní text',
  translationLanguage: 'cs',
  context: 'Kontext',
  glossary: [{ term: 'slovo', definition: 'význam' }],
};

describe('detectMediaType', () => {
  it('detects JPEG from magic bytes', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0x00]);
    expect(detectMediaType(jpeg)).toBe('image/jpeg');
  });

  it('detects PNG from magic bytes', () => {
    const png = Buffer.from([0x89, 0x50, 0x00]);
    expect(detectMediaType(png)).toBe('image/png');
  });

  it('detects WebP from magic bytes', () => {
    const webp = Buffer.from([0x52, 0x49, 0x00]);
    expect(detectMediaType(webp)).toBe('image/webp');
  });

  it('detects GIF from magic bytes', () => {
    const gif = Buffer.from([0x47, 0x49, 0x00]);
    expect(detectMediaType(gif)).toBe('image/gif');
  });

  it('defaults to JPEG for unknown bytes', () => {
    const unknown = Buffer.from([0x00, 0x00, 0x00]);
    expect(detectMediaType(unknown)).toBe('image/jpeg');
  });
});

describe('parseOcrJson', () => {
  it('parses clean JSON', () => {
    const result = parseOcrJson(JSON.stringify(VALID_JSON));
    expect(result.transcription).toBe('Starý text');
    expect(result.glossary).toHaveLength(1);
  });

  it('strips markdown json fences', () => {
    const input = '```json\n' + JSON.stringify(VALID_JSON) + '\n```';
    const result = parseOcrJson(input);
    expect(result.transcription).toBe('Starý text');
  });

  it('strips plain markdown fences', () => {
    const input = '```\n' + JSON.stringify(VALID_JSON) + '\n```';
    const result = parseOcrJson(input);
    expect(result.translationLanguage).toBe('cs');
  });

  it('extracts JSON from surrounding text', () => {
    const input = 'Here is the result:\n' + JSON.stringify(VALID_JSON) + '\n\nHope this helps!';
    const result = parseOcrJson(input);
    expect(result.detectedLanguage).toBe('cs-old');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseOcrJson('not json at all')).toThrow();
  });

  it('handles whitespace around JSON', () => {
    const input = '   \n  ' + JSON.stringify(VALID_JSON) + '   \n  ';
    const result = parseOcrJson(input);
    expect(result.context).toBe('Kontext');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd apps/web && npx vitest run lib/adapters/ocr/__tests__/claude-vision.test.ts`
Expected: 11 tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/adapters/ocr/claude-vision.ts apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts
git commit -m "test: testy pro claude-vision.ts (detectMediaType, parseOcrJson)

Extrakce parseOcrJson jako exportované funkce pro testovatelnost."
```

### Task 7: Test `versioning.ts` + `retranslate` route

**Files:**
- Test: `apps/web/app/api/documents/__tests__/retranslate.test.ts`
- Module: `apps/web/app/api/documents/[id]/retranslate/route.ts`

- [ ] **Step 1: Write the test file**

```typescript
// apps/web/app/api/documents/__tests__/retranslate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../[id]/retranslate/route';
import { NextRequest } from 'next/server';

// Mock Prisma
vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    document: { findUnique: vi.fn() },
    translation: { upsert: vi.fn() },
  },
}));

// Mock versioning
vi.mock('@/lib/infrastructure/versioning', () => ({
  createVersion: vi.fn(),
}));

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Přeložený text' }],
          model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      };
    },
  };
});

import { prisma } from '@/lib/infrastructure/db';
import { createVersion } from '@/lib/infrastructure/versioning';

const mockFindUnique = vi.mocked(prisma.document.findUnique);
const mockUpsert = vi.mocked(prisma.translation.upsert);
const mockCreateVersion = vi.mocked(createVersion);

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/documents/doc-1/retranslate', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const routeContext = { params: Promise.resolve({ id: 'doc-1' }) };

describe('POST /api/documents/[id]/retranslate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when document not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    const res = await POST(makeRequest({ language: 'cs' }), routeContext);
    expect(res.status).toBe(404);
  });

  it('creates version from previous translation before overwriting', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'doc-1',
      transcription: 'Starý text',
      translations: [{ language: 'cs', text: 'Starý překlad' }],
    } as never);
    mockUpsert.mockResolvedValue({} as never);

    await POST(makeRequest({ language: 'cs', previousTranslation: 'Starý překlad' }), routeContext);

    expect(mockCreateVersion).toHaveBeenCalledWith(
      'doc-1',
      'translation:cs',
      'Starý překlad',
      'ai_retranslate',
      'claude-sonnet-4-6',
    );
  });

  it('upserts translation with result from Claude', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'doc-1',
      transcription: 'Text',
      translations: [],
    } as never);
    mockUpsert.mockResolvedValue({} as never);

    const res = await POST(makeRequest({ language: 'cs' }), routeContext);
    const json = await res.json();

    expect(json.translation).toBe('Přeložený text');
    expect(json.language).toBe('cs');
    expect(mockUpsert).toHaveBeenCalled();
  });

  it('defaults to cs language when not provided', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'doc-1',
      transcription: 'Text',
      translations: [],
    } as never);
    mockUpsert.mockResolvedValue({} as never);

    const res = await POST(makeRequest({}), routeContext);
    const json = await res.json();
    expect(json.language).toBe('cs');
  });

  it('returns 400 on invalid JSON body', async () => {
    const req = new NextRequest('http://localhost/api/documents/doc-1/retranslate', {
      method: 'POST',
      body: 'not json',
    });
    const res = await POST(req, routeContext);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test**

Run: `cd apps/web && npx vitest run app/api/documents/__tests__/retranslate.test.ts`
Expected: 5 tests PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/documents/__tests__/retranslate.test.ts
git commit -m "test: testy pro retranslate endpoint (verzování, upsert, defaults)"
```

### Task 8: Test document CRUD route

**Files:**
- Test: `apps/web/app/api/documents/__tests__/document-id.test.ts`
- Module: `apps/web/app/api/documents/[id]/route.ts`

- [ ] **Step 1: Read the route to understand exact behavior**

Read: `apps/web/app/api/documents/[id]/route.ts`

- [ ] **Step 2: Write the test file**

Tests should cover:
- `GET` — returns document with translations/glossary, or 404
- `PATCH` — updates transcription, saves version before overwriting
- `PATCH` — updates translation, saves version
- `DELETE` — deletes document, returns 404 for non-existent

```typescript
// apps/web/app/api/documents/__tests__/document-id.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/infrastructure/db', () => ({
  prisma: {
    document: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    translation: { upsert: vi.fn() },
  },
}));

vi.mock('@/lib/infrastructure/versioning', () => ({
  createVersion: vi.fn(),
}));

import { prisma } from '@/lib/infrastructure/db';
import { createVersion } from '@/lib/infrastructure/versioning';

const mockFindUnique = vi.mocked(prisma.document.findUnique);
const mockUpdate = vi.mocked(prisma.document.update);
const mockDelete = vi.mocked(prisma.document.delete);
const mockCreateVersion = vi.mocked(createVersion);

// Import route handlers after mocks
import { GET, PATCH, DELETE } from '../[id]/route';
import { NextRequest } from 'next/server';

const routeContext = { params: Promise.resolve({ id: 'doc-1' }) };

describe('GET /api/documents/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns document with translations and glossary', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'doc-1',
      transcription: 'text',
      translations: [{ language: 'cs', text: 'překlad' }],
      glossary: [{ term: 'a', definition: 'b' }],
    } as never);

    const req = new NextRequest('http://localhost/api/documents/doc-1');
    const res = await GET(req, routeContext);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.transcription).toBe('text');
  });

  it('returns 404 when not found', async () => {
    mockFindUnique.mockResolvedValue(null);
    const req = new NextRequest('http://localhost/api/documents/doc-1');
    const res = await GET(req, routeContext);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/documents/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates transcription and creates version', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'doc-1',
      transcription: 'old text',
      context: 'ctx',
      translations: [],
    } as never);
    mockUpdate.mockResolvedValue({ id: 'doc-1' } as never);

    const req = new NextRequest('http://localhost/api/documents/doc-1', {
      method: 'PATCH',
      body: JSON.stringify({ transcription: 'new text' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await PATCH(req, routeContext);
    expect(res.status).toBe(200);
    expect(mockCreateVersion).toHaveBeenCalledWith(
      'doc-1', 'transcription', 'old text', 'manual_edit',
    );
  });
});

describe('DELETE /api/documents/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes the document', async () => {
    mockDelete.mockResolvedValue({ id: 'doc-1' } as never);
    const req = new NextRequest('http://localhost/api/documents/doc-1', { method: 'DELETE' });
    const res = await DELETE(req, routeContext);
    expect(res.status).toBe(200);
  });
});
```

Note: The exact assertions depend on the route implementation. Read the route file first and adjust test expectations to match actual behavior.

- [ ] **Step 3: Run test**

Run: `cd apps/web && npx vitest run app/api/documents/__tests__/document-id.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/documents/__tests__/document-id.test.ts
git commit -m "test: testy pro documents/[id] CRUD (GET, PATCH s verzováním, DELETE)"
```

### Task 9: Test versions route

**Files:**
- Test: `apps/web/app/api/documents/__tests__/versions.test.ts`
- Module: `apps/web/app/api/documents/[id]/versions/route.ts`

- [ ] **Step 1: Read the route, write and run test**

Simple route — just fetches versions from Prisma. Test: mock Prisma, verify ordered response.

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/documents/__tests__/versions.test.ts
git commit -m "test: test pro versions endpoint"
```

### Task 10: Test collections routes

**Files:**
- Test: `apps/web/app/api/collections/__tests__/collections.test.ts`
- Module: `apps/web/app/api/collections/route.ts`
- Module: `apps/web/app/api/collections/[id]/route.ts`

- [ ] **Step 1: Read both route files**

- [ ] **Step 2: Write tests covering:**
- `GET /api/collections` — returns list with page counts
- `POST /api/collections` — creates collection, validates required name
- `GET /api/collections/[id]` — returns collection with pages, or 404
- `PATCH /api/collections/[id]` — updates name/description
- `DELETE /api/collections/[id]` — deletes collection

- [ ] **Step 3: Run test and commit**

```bash
git add apps/web/app/api/collections/__tests__/
git commit -m "test: testy pro collections CRUD (list, create, get, update, delete)"
```

### Task 11: Test pages routes

**Files:**
- Test: `apps/web/app/api/pages/__tests__/pages.test.ts`
- Module: `apps/web/app/api/pages/route.ts`
- Module: `apps/web/app/api/pages/[id]/route.ts`

- [ ] **Step 1: Read both route files**

- [ ] **Step 2: Write tests covering:**
- `GET /api/pages` — list pages (with/without collectionId filter)
- `GET /api/pages/[id]` — page detail with document
- `PATCH /api/pages/[id]` — update collectionId, order, status
- `DELETE /api/pages/[id]` — delete page + image file cleanup

- [ ] **Step 3: Run test and commit**

```bash
git add apps/web/app/api/pages/__tests__/
git commit -m "test: testy pro pages CRUD (list, detail, update, delete)"
```

### Task 12: Test pages upload route

**Files:**
- Test: `apps/web/app/api/pages/__tests__/upload.test.ts`
- Module: `apps/web/app/api/pages/upload/route.ts`

- [ ] **Step 1: Read the route file**

- [ ] **Step 2: Write tests covering:**
- Successful upload with metadata extraction
- Rejection of invalid file types
- Rejection of oversized files
- Duplicate hash detection
- Collection assignment

Mock: Prisma, `fs`, `sharp` (for metadata), `crypto` (for hash).

- [ ] **Step 3: Run test and commit**

```bash
git add apps/web/app/api/pages/__tests__/upload.test.ts
git commit -m "test: testy pro pages/upload (validace, duplikáty, metadata)"
```

### Task 13: Test pages process route (SSE streaming)

**Files:**
- Test: `apps/web/app/api/pages/__tests__/process.test.ts`
- Module: `apps/web/app/api/pages/process/route.ts`

This is the most complex route — batch processing with SSE stream. Test the key scenarios by mocking Prisma, `fs`, `crypto`, and `processWithClaude`.

- [ ] **Step 1: Read the route file**

- [ ] **Step 2: Write tests covering:**
- Returns 400 on missing/empty pageIds
- Skips pages that already have a translation in target language
- Calls `processWithClaude` for new pages
- Creates Document + Translation + GlossaryEntries in DB
- Creates initial versions via `createVersion`
- Sends SSE events: page_progress, page_done, done
- Handles errors per-page without aborting batch
- Hash deduplication (same image = skip OCR)

Helper function to consume SSE stream:
```typescript
async function consumeSSE(response: Response): Promise<{ event: string; data: unknown }[]> {
  const text = await response.text();
  return text
    .split('\n\n')
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))?.replace('event: ', '') ?? '';
      const data = lines.find((l) => l.startsWith('data: '))?.replace('data: ', '') ?? '{}';
      return { event, data: JSON.parse(data) };
    });
}
```

- [ ] **Step 3: Run test and commit**

```bash
git add apps/web/app/api/pages/__tests__/process.test.ts
git commit -m "test: testy pro pages/process SSE (batch, skip, chyby, hash dedup)"
```

---

## Phase 3: Final Validation & Cleanup

### Task 14: Update CLAUDE.md structure section

After dead code removal, the project structure in CLAUDE.md may reference deleted files.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Remove references to deleted files**

Remove from structure section:
- `preprocessing/sharp.ts` and its line
- `infrastructure/container.ts` and its line
- `ProcessingStatus.tsx` component line
- Any reference to legacy `/api/process`, `/api/upload`, `/api/documents` (GET list)

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: aktualizace CLAUDE.md po smazání mrtvého kódu"
```

### Task 15: Final validation

- [ ] **Step 1: Run full validation pipeline**

```bash
npx turbo typecheck && npx turbo lint && npx turbo format:check && npx turbo test
```

Expected: All pass. All new tests green.

- [ ] **Step 2: Check test count**

Run: `cd apps/web && npx vitest run --reporter=verbose`

Expected: ~40+ tests across ~10 test files, all PASS. Coverage of:
- All adapters (claude-vision)
- All infrastructure (versioning, local-storage)
- All API routes (pages/*, documents/*, collections/*)

- [ ] **Step 3: Fix any Prettier warnings if needed**

```bash
cd apps/web && npx prettier --write "app/**/*.{ts,tsx}" "lib/**/*.{ts,tsx}"
```

- [ ] **Step 4: Final commit if needed**
