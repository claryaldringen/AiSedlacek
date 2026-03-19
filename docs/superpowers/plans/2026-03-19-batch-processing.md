# Batch Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Process manuscript pages in batches so the model has cross-page visual and textual context, improving transcription quality and reducing API overhead.

**Architecture:** Hybrid approach — multi-image batches within a single API call + sliding text context between batches. Automatic batch sizing based on dual token budget (input 150K + output limit). 3-level fallback: partial success → split in half → individual pages. JSONL output format for truncation resilience.

**Tech Stack:** Anthropic SDK (streaming), Next.js API Routes (SSE), Prisma/PostgreSQL, React (client SSE handling)

**Spec:** `docs/superpowers/specs/2026-03-19-batch-processing-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/web/prisma/schema.prisma` | Modify | Add `batchId` to Document model |
| `packages/shared/src/prompts.ts` | Modify | Add `BATCH_OCR_INSTRUCTION` prompt template |
| `packages/shared/src/index.ts` | Modify | Add `BATCH_OCR_INSTRUCTION` to named exports |
| `apps/web/lib/adapters/ocr/claude-vision.ts` | Modify | Add `parseOcrJsonBatch()`, `processWithClaudeBatch()`, update `processWithClaude()` with `previousContext` |
| `apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts` | Modify | Tests for JSONL parsing, batch processing |
| `apps/web/lib/batch-utils.ts` | Create | Batch splitting logic: `createBatches()`, `estimateImageTokens()`, `truncateContext()` |
| `apps/web/lib/__tests__/batch-utils.test.ts` | Create | Tests for batch splitting and context truncation |
| `apps/web/app/api/pages/process/route.ts` | Modify | Integrate batch processing, fallback, new SSE events |
| `apps/web/app/api/pages/__tests__/process.test.ts` | Modify | Tests for batch flow |
| `apps/web/app/workspace/page.tsx` | Modify | Handle `batch_info` and `batch_progress` SSE events |

---

## Key Patterns From Existing Codebase

**`sendEvent` signature (process/route.ts:9-16):** Takes 4 params: `(controller, encoder, event, data)`. All calls MUST include `encoder`.

**Test mock pattern (process.test.ts):** Auth is NOT mocked — `requireUserId` is imported but route falls through. The test relies on `mockPageFindUnique` returning data with matching structure. Existing mocks: `prisma.document`, `prisma.page`, `prisma.translation`, `createVersion`, `processWithClaude`, `fs/promises`, `crypto`.

**Package name:** `@ai-sedlacek/shared` (with hyphens).

**Barrel exports:** `packages/shared/src/index.ts` uses **named exports**, not wildcards.

---

### Task 1: Prisma Schema — Add batchId to Document

**Files:**
- Modify: `apps/web/prisma/schema.prisma` (Document model, ~line 105)

- [ ] **Step 1: Add batchId field to Document model**

In `apps/web/prisma/schema.prisma`, add to the Document model after the `processingTimeMs` field:

```prisma
  batchId          String?
```

- [ ] **Step 2: Generate migration and Prisma client**

Run:
```bash
npx prisma migrate dev --schema=apps/web/prisma/schema.prisma --name add_document_batch_id
npx prisma generate --schema=apps/web/prisma/schema.prisma
```
Expected: Migration applied successfully, client regenerated.

- [ ] **Step 3: Commit**

```bash
git add apps/web/prisma/
git commit -m "feat: přidání batchId do Document modelu"
```

---

### Task 2: Batch Prompt Template

**Files:**
- Modify: `packages/shared/src/prompts.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add BATCH_OCR_INSTRUCTION to prompts.ts**

Append after the existing `buildPolishPrompt` function (~line 84):

```typescript
export const BATCH_OCR_INSTRUCTION = `You will receive multiple manuscript page images. Process each one independently but use context from all pages to improve accuracy.

Return results as JSONL (one JSON object per line), in the same order as the images. Each object MUST include an "imageIndex" field (0-based, matching the image order).

Each line must be a valid JSON object with this structure:
{"imageIndex": 0, "transcription": "...", "detectedLanguage": "...", "translation": "...", "translationLanguage": "...", "context": "page-specific context only (see below)", "glossary": [{"term": "...", "definition": "..."}]}

The "context" field must contain ONLY information specific to that page: biblical quotes and their source, literary references, named persons, places, or events. Do NOT repeat general information about the work (author, date, genre) — that is already known from the collection context.

Use \\n for newlines inside JSON strings. Return ONLY the JSONL lines, no markdown fences, no extra text.`;
```

- [ ] **Step 2: Add named export to barrel**

In `packages/shared/src/index.ts`, update the prompts export block (lines 22-27):

```typescript
export {
  CLASSIFY_LAYOUT_PROMPT,
  OCR_TRANSCRIPTION_PROMPT,
  buildConsolidationPrompt,
  buildPolishPrompt,
  BATCH_OCR_INSTRUCTION,
} from './prompts';
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/prompts.ts packages/shared/src/index.ts
git commit -m "feat: prompt šablona pro batch OCR zpracování"
```

---

### Task 3: JSONL Parser — `parseOcrJsonBatch`

**Files:**
- Modify: `apps/web/lib/adapters/ocr/claude-vision.ts`
- Modify: `apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts`

- [ ] **Step 1: Write failing tests for parseOcrJsonBatch**

Add to `apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts`:

```typescript
import { parseOcrJsonBatch } from '../claude-vision';

describe('parseOcrJsonBatch', () => {
  const makeResult = (index: number) => ({
    imageIndex: index,
    transcription: `text ${index}`,
    detectedLanguage: 'la',
    translation: `překlad ${index}`,
    translationLanguage: 'cs',
    context: `kontext ${index}`,
    glossary: [{ term: 'foo', definition: 'bar' }],
  });

  it('parses valid JSONL with multiple lines', () => {
    const input = `${JSON.stringify(makeResult(0))}\n${JSON.stringify(makeResult(1))}`;
    const results = parseOcrJsonBatch(input);
    expect(results).toHaveLength(2);
    expect(results[0]!.index).toBe(0);
    expect(results[1]!.index).toBe(1);
    expect(results[0]!.result.transcription).toBe('text 0');
  });

  it('skips invalid lines and parses the rest', () => {
    const input = `${JSON.stringify(makeResult(0))}\nNOT VALID JSON\n${JSON.stringify(makeResult(2))}`;
    const results = parseOcrJsonBatch(input);
    expect(results).toHaveLength(2);
    expect(results[0]!.index).toBe(0);
    expect(results[1]!.index).toBe(2);
  });

  it('falls back to positional index if imageIndex is missing', () => {
    const noIndex = { transcription: 'text', detectedLanguage: 'la', translation: 'překlad', translationLanguage: 'cs', context: '', glossary: [] };
    const input = `${JSON.stringify(noIndex)}\n${JSON.stringify(noIndex)}`;
    const results = parseOcrJsonBatch(input);
    expect(results[0]!.index).toBe(0);
    expect(results[1]!.index).toBe(1);
  });

  it('handles markdown fences around JSONL', () => {
    const input = '```json\n' + JSON.stringify(makeResult(0)) + '\n' + JSON.stringify(makeResult(1)) + '\n```';
    const results = parseOcrJsonBatch(input);
    expect(results).toHaveLength(2);
  });

  it('handles single result (1-page batch)', () => {
    const input = JSON.stringify(makeResult(0));
    const results = parseOcrJsonBatch(input);
    expect(results).toHaveLength(1);
  });

  it('returns empty array for completely invalid input', () => {
    const results = parseOcrJsonBatch('totally broken');
    expect(results).toHaveLength(0);
  });

  it('truncates results to maxResults if more than expected', () => {
    const input = `${JSON.stringify(makeResult(0))}\n${JSON.stringify(makeResult(1))}\n${JSON.stringify(makeResult(2))}`;
    const results = parseOcrJsonBatch(input, 2);
    expect(results).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts`
Expected: FAIL — `parseOcrJsonBatch` is not exported

- [ ] **Step 3: Implement parseOcrJsonBatch**

Add to `apps/web/lib/adapters/ocr/claude-vision.ts` after the existing `parseOcrJson` function (~line 67):

```typescript
export function parseOcrJsonBatch(
  raw: string,
  maxResults?: number,
): { index: number; result: StructuredOcrResult }[] {
  let text = raw.trim();

  // Strip markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1] ?? text;
  }

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const results: { index: number; result: StructuredOcrResult }[] = [];
  let positionalIndex = 0;

  for (const line of lines) {
    if (maxResults !== undefined && results.length >= maxResults) break;
    try {
      const parsed = parseOcrJson(line);
      // Try to extract imageIndex from raw JSON
      let imageIndex: number | undefined;
      try {
        const rawObj = JSON.parse(line.trim().startsWith('{') ? line.trim() : '{}');
        if (typeof rawObj.imageIndex === 'number') {
          imageIndex = rawObj.imageIndex;
        }
      } catch {
        // ignore — use positional fallback
      }
      results.push({ index: imageIndex ?? positionalIndex, result: parsed });
      positionalIndex++;
    } catch {
      // Skip unparseable lines (e.g. extra text from model)
      console.warn('[Claude Batch] Skipping unparseable JSONL line:', line.slice(0, 80));
    }
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/adapters/ocr/claude-vision.ts apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts
git commit -m "feat: parseOcrJsonBatch — JSONL parser pro dávkové výsledky"
```

---

### Task 4: Batch Splitting Utilities

**Files:**
- Create: `apps/web/lib/batch-utils.ts`
- Create: `apps/web/lib/__tests__/batch-utils.test.ts`

- [ ] **Step 1: Write failing tests for batch utilities**

Create `apps/web/lib/__tests__/batch-utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { estimateImageTokens, createBatches, truncateContext } from '../batch-utils';

describe('estimateImageTokens', () => {
  it('estimates tokens from file size', () => {
    // 400KB image: 400000/750 + 258 = 791
    expect(estimateImageTokens(400_000)).toBeCloseTo(791, 0);
  });

  it('handles small images', () => {
    expect(estimateImageTokens(1000)).toBeCloseTo(259, 0);
  });
});

describe('createBatches', () => {
  const makePage = (id: string, fileSize: number) => ({ id, fileSize });

  it('puts all pages in one batch when under budget', () => {
    const pages = [makePage('a', 400_000), makePage('b', 400_000)];
    const batches = createBatches(pages, { inputTokenBudget: 150_000, maxOutputTokens: 16384, avgOutputPerPage: 2500 });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it('splits into multiple batches when over input budget', () => {
    // Each page ~100K tokens → only 1 per batch with 150K budget
    const pages = [makePage('a', 75_000_000), makePage('b', 75_000_000)];
    const batches = createBatches(pages, { inputTokenBudget: 150_000, maxOutputTokens: 16384, avgOutputPerPage: 2500 });
    expect(batches).toHaveLength(2);
  });

  it('splits by output budget', () => {
    // Small images but maxOutputTokens only allows 2 pages (5000/2500=2)
    const pages = [makePage('a', 1000), makePage('b', 1000), makePage('c', 1000)];
    const batches = createBatches(pages, { inputTokenBudget: 150_000, maxOutputTokens: 5000, avgOutputPerPage: 2500 });
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(2);
    expect(batches[1]).toHaveLength(1);
  });

  it('handles single page', () => {
    const pages = [makePage('a', 400_000)];
    const batches = createBatches(pages, { inputTokenBudget: 150_000, maxOutputTokens: 16384, avgOutputPerPage: 2500 });
    expect(batches).toHaveLength(1);
  });

  it('handles empty input', () => {
    const batches = createBatches([], { inputTokenBudget: 150_000, maxOutputTokens: 16384, avgOutputPerPage: 2500 });
    expect(batches).toHaveLength(0);
  });

  it('ensures at least 1 page per batch even if over budget', () => {
    // Single huge image over budget — still gets its own batch
    const pages = [makePage('a', 200_000_000)];
    const batches = createBatches(pages, { inputTokenBudget: 150_000, maxOutputTokens: 16384, avgOutputPerPage: 2500 });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(1);
  });
});

describe('truncateContext', () => {
  it('returns text as-is if under limit', () => {
    const text = 'Short text';
    expect(truncateContext(text, 500)).toBe(text);
  });

  it('truncates long text to approximate token limit', () => {
    // ~4 chars per token, 500 tokens ≈ 2000 chars
    const longText = 'A'.repeat(5000);
    const result = truncateContext(longText, 500);
    expect(result.length).toBeLessThanOrEqual(2000 + 50); // small buffer for rounding
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns undefined for empty input', () => {
    expect(truncateContext('', 500)).toBeUndefined();
    expect(truncateContext(undefined, 500)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/lib/__tests__/batch-utils.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement batch utilities**

Create `apps/web/lib/batch-utils.ts`:

```typescript
const TOKEN_BYTES_RATIO = 750;
const IMAGE_OVERHEAD_TOKENS = 258;
const CHARS_PER_TOKEN = 4;

export function estimateImageTokens(fileSizeBytes: number): number {
  return fileSizeBytes / TOKEN_BYTES_RATIO + IMAGE_OVERHEAD_TOKENS;
}

interface BatchablePage {
  id: string;
  fileSize: number;
}

interface BatchOptions {
  inputTokenBudget: number;
  maxOutputTokens: number;
  avgOutputPerPage: number;
}

export function createBatches<T extends BatchablePage>(
  pages: T[],
  options: BatchOptions,
): T[][] {
  if (pages.length === 0) return [];

  const { inputTokenBudget, maxOutputTokens, avgOutputPerPage } = options;
  const maxPagesByOutput = Math.max(1, Math.floor(maxOutputTokens / avgOutputPerPage));

  const batches: T[][] = [];
  let currentBatch: T[] = [];
  let currentInputTokens = 0;

  for (const page of pages) {
    const pageTokens = estimateImageTokens(page.fileSize);
    const wouldExceedInput = currentBatch.length > 0 && currentInputTokens + pageTokens > inputTokenBudget;
    const wouldExceedOutput = currentBatch.length >= maxPagesByOutput;

    if (wouldExceedInput || wouldExceedOutput) {
      batches.push(currentBatch);
      currentBatch = [];
      currentInputTokens = 0;
    }

    currentBatch.push(page);
    currentInputTokens += pageTokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Truncate context text to an approximate token limit.
 * Uses ~4 chars/token heuristic. Returns undefined for empty input.
 */
export function truncateContext(
  text: string | undefined,
  maxTokens: number,
): string | undefined {
  if (!text || text.trim().length === 0) return undefined;
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '…';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/__tests__/batch-utils.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/batch-utils.ts apps/web/lib/__tests__/batch-utils.test.ts
git commit -m "feat: batch-utils — automatické dělení stránek do dávek"
```

---

### Task 5: processWithClaudeBatch Function

**Files:**
- Modify: `apps/web/lib/adapters/ocr/claude-vision.ts`
- Modify: `apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts`

- [ ] **Step 1: Write failing test for processWithClaudeBatch**

The existing test file only tests pure functions (no SDK mocking). Create a **separate test file** for integration-level tests that need SDK mocking:

Create `apps/web/lib/adapters/ocr/__tests__/claude-vision-batch.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────
vi.mock('sharp', () => ({
  default: vi.fn().mockImplementation(() => ({
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from([0xff, 0xd8, 0x00])),
  })),
}));

const mockStreamOn = vi.fn();
const mockStreamFinalMessage = vi.fn();
const mockMessagesStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      stream: (...args: unknown[]) => mockMessagesStream(...args),
    },
  })),
}));

// ── Import after mocks ──────────────────────────────
import { processWithClaudeBatch } from '../claude-vision';

// ── Helpers ─────────────────────────────────────────
function setupMockStream(jsonlOutput: string) {
  let textCb: ((text: string) => void) | undefined;
  mockStreamOn.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
    if (event === 'text') textCb = cb;
    return { on: mockStreamOn, finalMessage: mockStreamFinalMessage };
  });
  mockStreamFinalMessage.mockImplementation(async () => {
    textCb?.(jsonlOutput);
    return {
      id: 'msg_test',
      model: 'claude-opus-4-6',
      usage: { input_tokens: 1000, output_tokens: 500 },
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: jsonlOutput }],
    };
  });
  mockMessagesStream.mockReturnValue({
    on: mockStreamOn,
    finalMessage: mockStreamFinalMessage,
  });
}

describe('processWithClaudeBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends multiple images and returns parsed JSONL results', async () => {
    const result0 = { imageIndex: 0, transcription: 'text0', detectedLanguage: 'la', translation: 'tr0', translationLanguage: 'cs', context: '', glossary: [] };
    const result1 = { imageIndex: 1, transcription: 'text1', detectedLanguage: 'la', translation: 'tr1', translationLanguage: 'cs', context: '', glossary: [] };
    setupMockStream(JSON.stringify(result0) + '\n' + JSON.stringify(result1));

    const images = [
      { buffer: Buffer.from([0xff, 0xd8, 0x00]), pageId: 'p1', index: 0 },
      { buffer: Buffer.from([0xff, 0xd8, 0x00]), pageId: 'p2', index: 1 },
    ];

    const result = await processWithClaudeBatch(images, 'Přepiš text.');
    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.index).toBe(0);
    expect(result.results[0]!.result.transcription).toBe('text0');
    expect(result.results[1]!.index).toBe(1);
    expect(result.model).toBe('claude-opus-4-6');
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(500);
  });

  it('includes collectionContext and previousContext in the request', async () => {
    const result0 = { imageIndex: 0, transcription: 'text0', detectedLanguage: 'la', translation: 'tr0', translationLanguage: 'cs', context: '', glossary: [] };
    setupMockStream(JSON.stringify(result0));

    const images = [{ buffer: Buffer.from([0xff, 0xd8, 0x00]), pageId: 'p1', index: 0 }];

    await processWithClaudeBatch(images, 'Přepiš text.', {
      collectionContext: 'Jenský Kodex, 15. století',
      previousContext: '[Stránka 1]\nPředchozí text...',
    });

    // Verify the API was called with content blocks containing the contexts
    const apiCall = mockMessagesStream.mock.calls[0]![0] as { messages: { content: { type: string; text?: string }[] }[] };
    const textBlocks = apiCall.messages[0]!.content.filter((b: { type: string }) => b.type === 'text');
    const texts = textBlocks.map((b: { text?: string }) => b.text).join('\n');
    expect(texts).toContain('Kontext z předchozích stránek');
    expect(texts).toContain('Předchozí text...');
    expect(texts).toContain('Kontext díla');
    expect(texts).toContain('Jenský Kodex');
  });

  it('returns empty results for completely unparseable output', async () => {
    setupMockStream('This is not JSONL at all');

    const images = [{ buffer: Buffer.from([0xff, 0xd8, 0x00]), pageId: 'p1', index: 0 }];
    const result = await processWithClaudeBatch(images, 'Přepiš text.');
    expect(result.results).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/lib/adapters/ocr/__tests__/claude-vision-batch.test.ts`
Expected: FAIL — `processWithClaudeBatch` not exported

- [ ] **Step 3: Implement processWithClaudeBatch**

Add to `apps/web/lib/adapters/ocr/claude-vision.ts`:

At the top, add import:
```typescript
import { BATCH_OCR_INSTRUCTION } from '@ai-sedlacek/shared';
```

After `processWithClaude`, add:

```typescript
export async function processWithClaudeBatch(
  images: { buffer: Buffer; pageId: string; index: number }[],
  userPrompt: string,
  options?: {
    collectionContext?: string;
    previousContext?: string;
    onProgress?: (outputTokens: number, estimatedTotal: number) => void;
    estimatedOutputTokens?: number;
  },
): Promise<{
  results: { index: number; result: StructuredOcrResult }[];
  rawResponse: string;
  processingTimeMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const startTime = Date.now();
  const client = new Anthropic();

  // Prepare all images in parallel
  const preparedImages = await Promise.all(
    images.map(async (img) => {
      const { buffer, mediaType } = await prepareImage(img.buffer);
      return { ...img, buffer, mediaType };
    }),
  );

  // Build content blocks: images first, then text contexts, then prompt
  const content: Array<
    | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }
    | { type: 'text'; text: string }
  > = [];

  for (const img of preparedImages) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.buffer.toString('base64'),
      },
    });
  }

  if (options?.previousContext) {
    content.push({
      type: 'text',
      text: `Kontext z předchozích stránek rukopisu:\n${options.previousContext}`,
    });
  }

  if (options?.collectionContext) {
    content.push({
      type: 'text',
      text: `Kontext díla (použij pro lepší porozumění dokumentu):\n${options.collectionContext}`,
    });
  }

  content.push({ type: 'text', text: userPrompt });

  const estimated = options?.estimatedOutputTokens ?? 2500 * images.length;
  let currentTokens = 0;
  let fullText = '';
  const maxTokens = Math.min(Math.max(8192, 2500 * images.length), 128_000);

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: maxTokens,
    temperature: 0.3,
    system: SYSTEM_PROMPT + '\n\n' + BATCH_OCR_INSTRUCTION,
    messages: [{ role: 'user', content }],
  });

  stream.on('text', (text) => {
    fullText += text;
    currentTokens = Math.round(fullText.length / 4);
    options?.onProgress?.(currentTokens, estimated);
  });

  const finalMessage = await stream.finalMessage();

  console.log(
    '[Claude Batch] Done:',
    JSON.stringify({
      id: finalMessage.id,
      model: finalMessage.model,
      usage: finalMessage.usage,
      stop_reason: finalMessage.stop_reason,
      imageCount: images.length,
    }),
  );

  const text =
    fullText ||
    (finalMessage.content[0]?.type === 'text' ? finalMessage.content[0].text : '');

  const results = parseOcrJsonBatch(text, images.length);

  return {
    results,
    rawResponse: text,
    processingTimeMs: Date.now() - startTime,
    model: finalMessage.model,
    inputTokens: finalMessage.usage.input_tokens,
    outputTokens: finalMessage.usage.output_tokens,
  };
}
```

Key differences from the single-page function:
- `max_tokens` capped at 128K (API limit for Opus)
- `parseOcrJsonBatch` with `maxResults = images.length` to truncate excess
- Uses `BATCH_OCR_INSTRUCTION` appended to system prompt
- Content type uses explicit union type (not SDK's complex type traversal)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/lib/adapters/ocr/__tests__/claude-vision-batch.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/adapters/ocr/claude-vision.ts apps/web/lib/adapters/ocr/__tests__/claude-vision-batch.test.ts
git commit -m "feat: processWithClaudeBatch — dávkové zpracování více obrázků"
```

---

### Task 6: Update processWithClaude — Previous Page Context

**Files:**
- Modify: `apps/web/lib/adapters/ocr/claude-vision.ts`
- Modify: `apps/web/lib/adapters/ocr/__tests__/claude-vision-batch.test.ts`

- [ ] **Step 1: Write failing test for previousContext**

Add to `apps/web/lib/adapters/ocr/__tests__/claude-vision-batch.test.ts`:

```typescript
import { processWithClaude } from '../claude-vision';

describe('processWithClaude with previousContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes previousContext in the message content', async () => {
    const result0 = { imageIndex: 0, transcription: 'text', detectedLanguage: 'la', translation: 'tr', translationLanguage: 'cs', context: '', glossary: [] };
    setupMockStream(JSON.stringify(result0));

    await processWithClaude(
      Buffer.from([0xff, 0xd8, 0x00]),
      'Přepiš text.',
      undefined, // onProgress
      undefined, // estimatedOutputTokens
      '[Stránka 1]\nPředchozí transkripce...',
    );

    const apiCall = mockMessagesStream.mock.calls[0]![0] as { messages: { content: { type: string; text?: string }[] }[] };
    const textBlocks = apiCall.messages[0]!.content.filter((b: { type: string }) => b.type === 'text');
    const texts = textBlocks.map((b: { text?: string }) => b.text).join('\n');
    expect(texts).toContain('Kontext z předchozích stránek');
    expect(texts).toContain('Předchozí transkripce...');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/lib/adapters/ocr/__tests__/claude-vision-batch.test.ts -t "previousContext"`
Expected: FAIL — processWithClaude doesn't accept previousContext

- [ ] **Step 3: Add previousContext parameter to processWithClaude**

Update the `processWithClaude` function signature (~line 164):

```typescript
export async function processWithClaude(
  image: Buffer,
  userPrompt: string,
  onProgress?: (outputTokens: number, estimatedTotal: number) => void,
  estimatedOutputTokens?: number,
  previousContext?: string,
): Promise<{ ... }> {
```

Update the messages content array (~line 189) to include previous context:

```typescript
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageToSend.toString('base64'),
            },
          },
          ...(previousContext
            ? [{ type: 'text' as const, text: `Kontext z předchozích stránek rukopisu:\n${previousContext}` }]
            : []),
          {
            type: 'text',
            text: userPrompt,
          },
        ],
      },
    ],
```

- [ ] **Step 4: Run all OCR tests**

Run: `npx vitest run apps/web/lib/adapters/ocr/__tests__/`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/adapters/ocr/claude-vision.ts apps/web/lib/adapters/ocr/__tests__/claude-vision-batch.test.ts
git commit -m "feat: processWithClaude — volitelný kontext z předchozích stránek"
```

---

### Task 7: Update Process Route — Batch Integration

This is the largest task. It modifies the main SSE processing route to use batch processing with full fallback logic.

**Files:**
- Modify: `apps/web/app/api/pages/process/route.ts`
- Modify: `apps/web/app/api/pages/__tests__/process.test.ts`

- [ ] **Step 1: Add mocks for new functions to test file**

In `apps/web/app/api/pages/__tests__/process.test.ts`, update mocks:

```typescript
// Update the claude-vision mock to include processWithClaudeBatch
const mockProcessWithClaudeBatch = vi.fn();
vi.mock('@/lib/adapters/ocr/claude-vision', () => ({
  processWithClaude: (...args: unknown[]) => mockProcessWithClaude(...args),
  processWithClaudeBatch: (...args: unknown[]) => mockProcessWithClaudeBatch(...args),
}));

// Add mock for batch-utils
const mockCreateBatches = vi.fn();
vi.mock('@/lib/batch-utils', () => ({
  createBatches: (...args: unknown[]) => mockCreateBatches(...args),
  estimateImageTokens: vi.fn().mockReturnValue(500),
  truncateContext: vi.fn().mockImplementation((text: string) => text),
}));

// Add page.findMany mock to existing prisma mock
const mockPageFindMany = vi.fn();
// In the prisma mock object, add:
//   page: {
//     findUnique: ...,
//     update: ...,
//     findMany: (...args: unknown[]) => mockPageFindMany(...args),
//   },
```

- [ ] **Step 2: Write failing tests for batch flow**

Add to `apps/web/app/api/pages/__tests__/process.test.ts`:

```typescript
const BATCH_CLAUDE_RESULT = {
  results: [
    { index: 0, result: { transcription: 'Text 0', detectedLanguage: 'cs-old', translation: 'Překlad 0', translationLanguage: 'cs', context: 'Kontext 0', glossary: [{ term: 'slovo', definition: 'význam' }] } },
    { index: 1, result: { transcription: 'Text 1', detectedLanguage: 'cs-old', translation: 'Překlad 1', translationLanguage: 'cs', context: 'Kontext 1', glossary: [] } },
  ],
  rawResponse: '{"imageIndex":0,...}\n{"imageIndex":1,...}',
  processingTimeMs: 200,
  model: 'claude-opus-4-6',
  inputTokens: 1000,
  outputTokens: 400,
};

describe('batch processing', () => {
  beforeEach(() => {
    // createBatches returns pages grouped into batches
    mockCreateBatches.mockImplementation((pages: { id: string }[]) => [pages]);
    mockPageFindMany.mockResolvedValue([]);
  });

  it('sends batch_info event for multi-page batch', async () => {
    // 2 pages, no existing documents
    mockPageFindUnique
      .mockResolvedValueOnce({ id: 'p1', imageUrl: '/api/images/a.jpg', fileSize: 400000, document: null, collection: null })
      .mockResolvedValueOnce({ id: 'p2', imageUrl: '/api/images/b.jpg', fileSize: 400000, document: null, collection: null });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    mockDocFindUnique.mockResolvedValue(null);
    mockDocCreate
      .mockResolvedValueOnce({ id: 'doc-1' })
      .mockResolvedValueOnce({ id: 'doc-2' });
    mockProcessWithClaudeBatch.mockResolvedValue(BATCH_CLAUDE_RESULT);
    mockCreateBatches.mockReturnValue([[
      { id: 'p1', fileSize: 400000 },
      { id: 'p2', fileSize: 400000 },
    ]]);

    const res = await POST(makeRequest({ pageIds: ['p1', 'p2'] }));
    const events = await consumeSSE(res);

    const batchInfoEvent = events.find(e => e.event === 'batch_info');
    expect(batchInfoEvent).toBeDefined();
    expect(batchInfoEvent!.data.batchNumber).toBe(1);
    expect(batchInfoEvent!.data.totalBatches).toBe(1);
    expect(batchInfoEvent!.data.pageCount).toBe(2);

    const pageDoneEvents = events.filter(e => e.event === 'page_done');
    expect(pageDoneEvents).toHaveLength(2);
  });

  it('adds previous page context for single-page processing', async () => {
    mockPageFindUnique.mockResolvedValue({
      id: 'p3', imageUrl: '/api/images/c.jpg', fileSize: 400000,
      document: null, collection: { id: 'col-1', context: null },
    });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    mockDocFindUnique.mockResolvedValue(null);
    mockDocCreate.mockResolvedValue({ id: 'doc-3' });
    mockProcessWithClaude.mockResolvedValue(CLAUDE_RESULT);
    mockCreateBatches.mockReturnValue([[{ id: 'p3', fileSize: 400000 }]]);
    // Previous pages with transcriptions
    mockPageFindMany.mockResolvedValue([
      { id: 'prev-1', document: { transcription: 'Předchozí text stránky 1' } },
      { id: 'prev-2', document: { transcription: 'Předchozí text stránky 2' } },
    ]);

    const res = await POST(makeRequest({ pageIds: ['p3'] }));
    const events = await consumeSSE(res);

    // processWithClaude should have been called with previousContext (5th arg)
    expect(mockProcessWithClaude).toHaveBeenCalled();
    const callArgs = mockProcessWithClaude.mock.calls[0]!;
    expect(callArgs[4]).toContain('Předchozí text stránky 1');
    expect(callArgs[4]).toContain('Předchozí text stránky 2');
  });

  it('falls back to individual processing on batch failure', async () => {
    mockPageFindUnique
      .mockResolvedValueOnce({ id: 'p1', imageUrl: '/api/images/a.jpg', fileSize: 400000, document: null, collection: null })
      .mockResolvedValueOnce({ id: 'p2', imageUrl: '/api/images/b.jpg', fileSize: 400000, document: null, collection: null })
      // Re-read for individual fallback
      .mockResolvedValueOnce({ id: 'p1', imageUrl: '/api/images/a.jpg', fileSize: 400000, document: null, collection: null })
      .mockResolvedValueOnce({ id: 'p2', imageUrl: '/api/images/b.jpg', fileSize: 400000, document: null, collection: null });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    mockDocFindUnique.mockResolvedValue(null);
    mockDocCreate
      .mockResolvedValueOnce({ id: 'doc-1' })
      .mockResolvedValueOnce({ id: 'doc-2' });
    mockCreateBatches.mockReturnValue([[
      { id: 'p1', fileSize: 400000 },
      { id: 'p2', fileSize: 400000 },
    ]]);
    // Batch fails
    mockProcessWithClaudeBatch.mockRejectedValue(new Error('API Error'));
    // Individual succeeds
    mockProcessWithClaude.mockResolvedValue(CLAUDE_RESULT);

    const res = await POST(makeRequest({ pageIds: ['p1', 'p2'] }));
    const events = await consumeSSE(res);

    // Should have fallen back to individual processing
    expect(mockProcessWithClaude).toHaveBeenCalledTimes(2);
    const pageDoneEvents = events.filter(e => e.event === 'page_done');
    expect(pageDoneEvents).toHaveLength(2);
  });

  it('saves partial results and retries missing pages', async () => {
    mockPageFindUnique
      .mockResolvedValueOnce({ id: 'p1', imageUrl: '/api/images/a.jpg', fileSize: 400000, document: null, collection: null })
      .mockResolvedValueOnce({ id: 'p2', imageUrl: '/api/images/b.jpg', fileSize: 400000, document: null, collection: null })
      .mockResolvedValueOnce({ id: 'p3', imageUrl: '/api/images/c.jpg', fileSize: 400000, document: null, collection: null })
      // Re-read for retry
      .mockResolvedValueOnce({ id: 'p3', imageUrl: '/api/images/c.jpg', fileSize: 400000, document: null, collection: null });
    mockReadFile.mockResolvedValue(Buffer.from('fake image'));
    mockDocFindUnique.mockResolvedValue(null);
    mockDocCreate
      .mockResolvedValueOnce({ id: 'doc-1' })
      .mockResolvedValueOnce({ id: 'doc-2' })
      .mockResolvedValueOnce({ id: 'doc-3' });
    mockCreateBatches.mockReturnValue([[
      { id: 'p1', fileSize: 400000 },
      { id: 'p2', fileSize: 400000 },
      { id: 'p3', fileSize: 400000 },
    ]]);
    // Batch returns only 2 of 3 results
    mockProcessWithClaudeBatch.mockResolvedValue({
      ...BATCH_CLAUDE_RESULT,
      results: BATCH_CLAUDE_RESULT.results.slice(0, 2), // only p1 and p2
    });
    // Individual retry for p3
    mockProcessWithClaude.mockResolvedValue(CLAUDE_RESULT);

    const res = await POST(makeRequest({ pageIds: ['p1', 'p2', 'p3'] }));
    const events = await consumeSSE(res);

    // 2 from batch + 1 from individual retry
    const pageDoneEvents = events.filter(e => e.event === 'page_done');
    expect(pageDoneEvents).toHaveLength(3);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run apps/web/app/api/pages/__tests__/process.test.ts`
Expected: New batch tests FAIL

- [ ] **Step 4: Implement batch processing in the route**

Refactor `apps/web/app/api/pages/process/route.ts`. The full implementation should:

**a) Add imports:**
```typescript
import { processWithClaudeBatch } from '@/lib/adapters/ocr/claude-vision';
import { createBatches, truncateContext } from '@/lib/batch-utils';
```

**b) Add helper to fetch previous page context:**
```typescript
async function getPreviousPageContext(
  collectionId: string | null,
  currentPageId: string,
  limit: number = 3,
): Promise<string | undefined> {
  if (!collectionId) return undefined;
  const previousPages = await prisma.page.findMany({
    where: {
      collectionId,
      document: { isNot: null },
      id: { not: currentPageId },
    },
    orderBy: { order: 'desc' },
    take: limit,
    include: { document: { select: { transcription: true } } },
  });
  if (previousPages.length === 0) return undefined;
  const text = previousPages
    .reverse()
    .map((p, i) => `[Stránka ${i + 1}]\n${p.document?.transcription ?? ''}`)
    .join('\n\n---\n\n');
  return truncateContext(text, 500);
}
```

**c) Add helper for saving a single document result to DB** (extract from existing loop):
```typescript
async function saveDocumentResult(
  page: { id: string; imageUrl: string; collection?: { id: string; context: string | null } | null },
  hash: string,
  result: StructuredOcrResult,
  rawResponseLine: string,
  metadata: { model: string; inputTokens: number; outputTokens: number; processingTimeMs: number },
  targetLang: string,
  batchId?: string,
): Promise<string> {
  // Create document with batchId
  // Create translation
  // Create glossary entries
  // Create initial versions
  // Return document ID
}
```

**d) Refactor main flow:**

Replace the current per-page loop with:

1. Pre-filter: load all pages, skip those with existing translations, skip hash-cached
2. Sort remaining by `order` (or `createdAt`)
3. Split into batches via `createBatches()`
4. For each batch:
   - Emit `batch_info` event
   - If 1 page: call `processWithClaude` with `previousContext` from `getPreviousPageContext`
   - If N pages: call `processWithClaudeBatch` with `previousContext` and `collectionContext`
   - On success: match results to pages by `imageIndex`, save each, emit `page_done`
   - On partial success: save what we have, collect missing pages
   - On failure: try splitting in half, then individual fallback
   - After batch: update `previousContext` from last transcriptions for next batch

**e) Implement 3-level fallback as a recursive function:**
```typescript
async function processBatchWithFallback(
  pages: PageWithData[],
  encoder: TextEncoder,
  controller: ReadableStreamDefaultController,
  options: {
    collectionContext?: string;
    previousContext?: string;
    batchId: string;
    targetLang: string;
    avgOutputTokens: number;
    batchNumber: number;
    totalBatches: number;
    completedRef: { count: number };
    totalPages: number;
  },
): Promise<string | undefined> {
  // Returns: last transcription for inter-batch context (or undefined)

  if (pages.length === 1) {
    // Individual processing with previousContext
    // ...
    return transcription;
  }

  try {
    // Try batch processing
    const batchResult = await processWithClaudeBatch(images, prompt, { ... });

    // Match results to pages
    const matched = new Map<string, { index: number; result: StructuredOcrResult }>();
    for (const r of batchResult.results) {
      const page = pages[r.index];
      if (page) matched.set(page.id, r);
    }

    // Save matched results
    for (const page of pages) {
      const match = matched.get(page.id);
      if (match) {
        // Extract individual JSONL line for rawResponse
        const rawLine = batchResult.rawResponse.split('\n')[match.index] ?? batchResult.rawResponse;
        await saveDocumentResult(page, hash, match.result, rawLine, ...);
        sendEvent(controller, encoder, 'page_done', { ... });
      }
    }

    // Retry unmatched pages individually
    const unmatchedPages = pages.filter(p => !matched.has(p.id));
    for (const page of unmatchedPages) {
      // Individual fallback
    }

    return lastTranscription;
  } catch (err) {
    console.error('[Batch] Failed, splitting:', err);
    // Split in half
    const mid = Math.ceil(pages.length / 2);
    const firstHalf = pages.slice(0, mid);
    const secondHalf = pages.slice(mid);

    let lastContext: string | undefined;
    try {
      lastContext = await processBatchWithFallback(firstHalf, encoder, controller, { ...options, previousContext: options.previousContext });
      lastContext = await processBatchWithFallback(secondHalf, encoder, controller, { ...options, previousContext: lastContext ?? options.previousContext });
    } catch {
      // Even halves failed — process all individually
      for (const page of pages) {
        try {
          // processWithClaude individual
        } catch (pageErr) {
          sendEvent(controller, encoder, 'page_error', { ... });
        }
      }
    }
    return lastContext;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/web/app/api/pages/__tests__/process.test.ts`
Expected: All tests PASS (both old and new)

- [ ] **Step 6: Run full test suite**

Run: `npx turbo test`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/pages/process/route.ts apps/web/app/api/pages/__tests__/process.test.ts
git commit -m "feat: dávkové zpracování stránek s fallback a kontextem"
```

---

### Task 8: Update Workspace UI — Batch Events

**Files:**
- Modify: `apps/web/app/workspace/page.tsx`

- [ ] **Step 1: Add batch state variables**

Add new state variables near the existing processing state (~line 40):

```typescript
const [batchInfo, setBatchInfo] = useState<{
  batchNumber: number;
  totalBatches: number;
  pageCount: number;
} | null>(null);
```

- [ ] **Step 2: Handle batch_info and batch_progress SSE events**

In the SSE event handling section (~line 395-462), add handlers for new event types:

```typescript
if (eventType === 'batch_info') {
  setBatchInfo(data);
}
if (eventType === 'batch_progress') {
  setProcessingStep(`Dávka ${data.batchNumber}/${data.totalBatches}`);
  setProcessingProgress(
    Math.round((data.outputTokens / data.estimatedTotal) * 100),
  );
}
```

- [ ] **Step 3: Show batch info in UI**

Above the existing progress bar (find the progress display section), add batch info display:

```tsx
{batchInfo && batchInfo.totalBatches > 1 && (
  <div className="text-xs text-neutral-500 mb-1">
    Dávka {batchInfo.batchNumber}/{batchInfo.totalBatches} ({batchInfo.pageCount} stránek)
  </div>
)}
```

- [ ] **Step 4: Reset batch state on completion**

In the `done` event handler and in the cleanup function, reset batch state:

```typescript
if (eventType === 'done') {
  setBatchInfo(null);
  // ... existing cleanup
}
```

Also in the finally/cleanup block (~line 472-475):
```typescript
setBatchInfo(null);
```

- [ ] **Step 5: Test manually in browser**

1. Start dev server: `npx turbo dev`
2. Upload 3+ pages to a collection
3. Select all → click "Zpracovat"
4. Verify: batch info shows above progress bar
5. Verify: pages get marked as done progressively
6. Verify: single page processing still works

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/workspace/page.tsx
git commit -m "feat: UI zobrazení průběhu dávkového zpracování"
```

---

### Task 9: Integration Testing & Cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full validation**

```bash
npx turbo typecheck && npx turbo lint && npx turbo format:check && npx turbo test
```

Expected: All checks PASS

- [ ] **Step 2: Fix any lint/type/format issues**

Address any issues found in Step 1.

- [ ] **Step 3: Final commit (only if fixes were needed)**

```bash
git add -A
git commit -m "fix: opravy lint/type po batch processing implementaci"
```
