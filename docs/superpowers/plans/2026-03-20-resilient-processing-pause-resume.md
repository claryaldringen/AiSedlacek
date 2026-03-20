# Resilientní zpracování s pause/resume — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pause/resume to page processing and detect/recover interrupted jobs after server restarts.

**Architecture:** Extend in-memory `ProcessingJob` with pause state (Promise-based blocking). Add `interrupted` endpoint that detects orphaned `processing` pages. UI gets pause/resume buttons with cassette-player icons and a yellow banner for interrupted jobs.

**Tech Stack:** Next.js API Routes, Server-Sent Events, React state, Prisma

**Spec:** `docs/superpowers/specs/2026-03-20-resilient-processing-pause-resume-design.md`

---

### Task 1: Extend processing-jobs.ts with pause/resume

**Files:**
- Modify: `apps/web/lib/infrastructure/processing-jobs.ts`
- Test: `apps/web/lib/infrastructure/__tests__/processing-jobs.test.ts`

- [ ] **Step 1: Write tests for pause/resume**

```typescript
// apps/web/lib/infrastructure/__tests__/processing-jobs.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createJob,
  pauseJob,
  resumeJob,
  isJobPaused,
  cancelJob,
  getActiveJob,
  completeJob,
} from '../processing-jobs';

describe('pause/resume', () => {
  const userId = 'test-user';

  beforeEach(() => {
    // Clean up any existing job
    const job = getActiveJob(userId);
    if (job && !job.completed) {
      cancelJob(userId);
    }
    completeJob(userId);
  });

  it('pauseJob sets paused state and creates promise', () => {
    createJob(userId, ['p1']);
    expect(isJobPaused(userId)).toBe(false);
    expect(pauseJob(userId)).toBe(true);
    expect(isJobPaused(userId)).toBe(true);
  });

  it('resumeJob clears paused state and resolves promise', async () => {
    createJob(userId, ['p1']);
    pauseJob(userId);
    const job = getActiveJob(userId)!;

    let resolved = false;
    void job.pausePromise!.then(() => { resolved = true; });

    resumeJob(userId);
    await Promise.resolve(); // flush microtasks
    expect(isJobPaused(userId)).toBe(false);
    expect(resolved).toBe(true);
  });

  it('pauseJob returns false if no active job', () => {
    expect(pauseJob('nonexistent')).toBe(false);
  });

  it('cancelJob resolves pausePromise so loop unblocks', async () => {
    createJob(userId, ['p1']);
    pauseJob(userId);
    const job = getActiveJob(userId)!;

    let resolved = false;
    void job.pausePromise!.then(() => { resolved = true; });

    cancelJob(userId);
    await Promise.resolve();
    expect(resolved).toBe(true);
  });

  it('pauseJob on completed job returns false', () => {
    createJob(userId, ['p1']);
    completeJob(userId);
    expect(pauseJob(userId)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/infrastructure/__tests__/processing-jobs.test.ts`
Expected: FAIL — `pauseJob`, `resumeJob`, `isJobPaused` not exported

- [ ] **Step 3: Implement pause/resume in processing-jobs.ts**

Add to `ProcessingJob` interface:
```typescript
export interface ProcessingJob {
  userId: string;
  pageIds: string[];
  events: ProcessingEvent[];
  completed: boolean;
  abortController: AbortController;
  listeners: Set<(evt: ProcessingEvent) => void>;
  paused: boolean;
  pausePromise: Promise<void> | null;
  pauseResolve: (() => void) | null;
}
```

Update `createJob` — add `paused: false, pausePromise: null, pauseResolve: null`.

Add new functions:
```typescript
export function pauseJob(userId: string): boolean {
  const job = activeJobs.get(userId);
  if (!job || job.completed || job.paused) return false;
  job.paused = true;
  job.pausePromise = new Promise<void>((resolve) => {
    job.pauseResolve = resolve;
  });
  return true;
}

export function resumeJob(userId: string): boolean {
  const job = activeJobs.get(userId);
  if (!job || !job.paused) return false;
  job.paused = false;
  job.pauseResolve?.();
  job.pausePromise = null;
  job.pauseResolve = null;
  return true;
}

export function isJobPaused(userId: string): boolean {
  const job = activeJobs.get(userId);
  return job?.paused ?? false;
}
```

Update `cancelJob` to also resolve pausePromise:
```typescript
export function cancelJob(userId: string): boolean {
  const job = activeJobs.get(userId);
  if (!job || job.completed) return false;
  job.pauseResolve?.();
  job.pausePromise = null;
  job.pauseResolve = null;
  job.paused = false;
  job.abortController.abort();
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/infrastructure/__tests__/processing-jobs.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/infrastructure/processing-jobs.ts apps/web/lib/infrastructure/__tests__/processing-jobs.test.ts
git commit -m "feat: pause/resume stav v processing-jobs"
```

---

### Task 2: Add pause checkpoints to runProcessing

**Files:**
- Modify: `apps/web/app/api/pages/process/route.ts`

- [ ] **Step 1: Add waitIfPaused helper and import getActiveJob**

At the top of `route.ts`, update imports to include `getActiveJob`. Add helper function after `emit`:

```typescript
import {
  createJob,
  getActiveJob,
  emitEvent,
  completeJob,
  type ProcessingEvent,
} from '@/lib/infrastructure/processing-jobs';

// ... existing emit helper ...

async function waitIfPaused(userId: string, signal: AbortSignal, progress: number): Promise<void> {
  const job = getActiveJob(userId);
  if (!job || !job.paused) return;
  emit(userId, 'paused', { message: 'Zpracování pozastaveno', progress });
  // Wait until resumed or cancelled
  await Promise.race([
    job.pausePromise ?? Promise.resolve(),
    new Promise<void>((resolve) => {
      if (signal.aborted) { resolve(); return; }
      signal.addEventListener('abort', () => resolve(), { once: true });
    }),
  ]);
  if (!signal.aborted) {
    emit(userId, 'resumed', { message: 'Zpracování obnoveno', progress });
  }
}
```

- [ ] **Step 2: Add pause checkpoint after single-page processing (line ~383)**

After the `emit(userId, 'page_done', ...)` for single-page batch (after line 383), add:

```typescript
await waitIfPaused(userId, signal, Math.round((completed / total) * 100));
```

- [ ] **Step 3: Add pause checkpoint after multi-page batch (line ~523)**

After `batchSuccess = true;` (line 523), add:

```typescript
await waitIfPaused(userId, signal, Math.round((completed / total) * 100));
```

- [ ] **Step 4: Add pause checkpoint in fallback loop (line ~619)**

After the page_done emit in fallback processing (after line 599), add:

```typescript
await waitIfPaused(userId, signal, Math.round((completed / total) * 100));
```

- [ ] **Step 5: Run typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/pages/process/route.ts
git commit -m "feat: pause checkpointy v processing loopu"
```

---

### Task 3: Create pause and resume API endpoints

**Files:**
- Create: `apps/web/app/api/pages/process/pause/route.ts`
- Create: `apps/web/app/api/pages/process/resume/route.ts`

- [ ] **Step 1: Create pause endpoint**

```typescript
// apps/web/app/api/pages/process/pause/route.ts
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { pauseJob } from '@/lib/infrastructure/processing-jobs';

export async function POST(): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const paused = pauseJob(userId);
  if (!paused) {
    return NextResponse.json({ error: 'Žádné aktivní zpracování' }, { status: 404 });
  }

  return NextResponse.json({ status: 'paused' });
}
```

- [ ] **Step 2: Create resume endpoint**

```typescript
// apps/web/app/api/pages/process/resume/route.ts
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { resumeJob } from '@/lib/infrastructure/processing-jobs';

export async function POST(): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const resumed = resumeJob(userId);
  if (!resumed) {
    return NextResponse.json({ error: 'Žádné pozastavené zpracování' }, { status: 404 });
  }

  return NextResponse.json({ status: 'resumed' });
}
```

- [ ] **Step 3: Run typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/pages/process/pause/route.ts apps/web/app/api/pages/process/resume/route.ts
git commit -m "feat: API endpointy pro pause a resume zpracování"
```

---

### Task 4: Create interrupted detection endpoint

**Files:**
- Create: `apps/web/app/api/pages/process/interrupted/route.ts`

- [ ] **Step 1: Create interrupted endpoint (GET + POST)**

```typescript
// apps/web/app/api/pages/process/interrupted/route.ts
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { getActiveJob } from '@/lib/infrastructure/processing-jobs';
import { prisma } from '@/lib/infrastructure/db';

export async function GET(): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  // If there's an active job, pages aren't truly interrupted
  const job = getActiveJob(userId);
  if (job && !job.completed) {
    return NextResponse.json({ count: 0, pageIds: [] });
  }

  const pages = await prisma.page.findMany({
    where: { userId, status: 'processing' },
    select: { id: true },
  });

  return NextResponse.json({
    count: pages.length,
    pageIds: pages.map((p) => p.id),
  });
}

export async function POST(): Promise<NextResponse> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }

  const result = await prisma.page.updateMany({
    where: { userId, status: 'processing' },
    data: { status: 'pending' },
  });

  return NextResponse.json({ reset: result.count });
}
```

- [ ] **Step 2: Run typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/pages/process/interrupted/route.ts
git commit -m "feat: endpoint pro detekci a reset přerušených stránek"
```

---

### Task 5: Update Toolbar UI with pause/resume/cancel icons

**Files:**
- Modify: `apps/web/components/Toolbar.tsx`

- [ ] **Step 1: Add new props to ToolbarProps interface**

Add to `ToolbarProps`:
```typescript
  onPauseProcessing?: () => void;
  onResumeProcessing?: () => void;
  isPaused?: boolean;
```

Add to destructured props in function signature.

- [ ] **Step 2: Replace processing status bar with pause-aware version**

Replace the entire `{/* Processing status bar */}` section (lines 391-432) with:

```tsx
{/* Processing status bar */}
{isProcessing && (
  <div className={[
    'border-t px-4 py-2',
    isPaused ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-blue-50',
  ].join(' ')}>
    <div className="flex items-center gap-3">
      {isPaused ? (
        <svg className="h-4 w-4 text-amber-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
        </svg>
      ) : (
        <svg className="h-4 w-4 animate-spin text-blue-600" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      )}
      <span className={['flex-1 text-sm', isPaused ? 'text-amber-700' : 'text-blue-700'].join(' ')}>
        {processingStep ?? 'Zpracovávám…'}
      </span>
      {processingProgress != null && (
        <span className={['text-xs', isPaused ? 'text-amber-600' : 'text-blue-600'].join(' ')}>
          {Math.round(processingProgress)}%
        </span>
      )}
      {/* Pause / Resume button */}
      {isPaused ? (
        onResumeProcessing && (
          <button
            onClick={onResumeProcessing}
            title="Pokračovat ve zpracování"
            className="flex items-center gap-1 rounded border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50"
          >
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
            </svg>
            Pokračovat
          </button>
        )
      ) : (
        onPauseProcessing && (
          <button
            onClick={onPauseProcessing}
            title="Pozastavit zpracování"
            className="flex items-center gap-1 rounded border border-amber-200 bg-white px-2.5 py-1 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-50"
          >
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
            Pozastavit
          </button>
        )
      )}
      {/* Stop / Cancel button */}
      {onCancelProcessing && (
        <button
          onClick={onCancelProcessing}
          title="Zrušit zpracování"
          className="flex items-center gap-1 rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50"
        >
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h12v12H6V6z" />
          </svg>
          Zrušit
        </button>
      )}
    </div>
    {processingProgress != null && (
      <div className={[
        'mt-1.5 h-1.5 overflow-hidden rounded-full',
        isPaused ? 'bg-amber-200' : 'bg-blue-200',
      ].join(' ')}>
        <div
          className={[
            'h-full rounded-full transition-all duration-500',
            isPaused ? 'bg-amber-500' : 'bg-blue-600',
          ].join(' ')}
          style={{ width: `${Math.min(processingProgress, 100)}%` }}
        />
      </div>
    )}
  </div>
)}
```

- [ ] **Step 3: Run typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/Toolbar.tsx
git commit -m "feat: pause/resume/cancel tlačítka s ikonami kazeťáku v toolbaru"
```

---

### Task 6: Wire up workspace page — pause/resume handlers and SSE events

**Files:**
- Modify: `apps/web/app/workspace/page.tsx`

- [ ] **Step 1: Add isPaused state**

Near the other processing state declarations (around line 32), add:
```typescript
const [isPaused, setIsPaused] = useState(false);
```

- [ ] **Step 2: Handle paused/resumed SSE events in consumeProcessingStream**

In `consumeProcessingStream`, after the `cancelled` handler (line ~510), add:

```typescript
} else if (eventType === 'paused') {
  const data = JSON.parse(dataStr) as { message: string; progress: number };
  setProcessingStep(data.message);
  setProcessingProgress(data.progress);
  setIsPaused(true);
} else if (eventType === 'resumed') {
  const data = JSON.parse(dataStr) as { message: string; progress: number };
  setProcessingStep(data.message);
  setProcessingProgress(data.progress);
  setIsPaused(false);
}
```

- [ ] **Step 3: Add pause/resume handlers**

After `handleCancelProcessing` (around line 648), add:

```typescript
const handlePauseProcessing = useCallback(async (): Promise<void> => {
  try {
    await fetch('/api/pages/process/pause', { method: 'POST' });
  } catch {
    // ignore
  }
}, []);

const handleResumeProcessing = useCallback(async (): Promise<void> => {
  try {
    await fetch('/api/pages/process/resume', { method: 'POST' });
  } catch {
    // ignore
  }
}, []);
```

- [ ] **Step 4: Reset isPaused in cleanup**

In `handleProcessSelected`'s `finally` block (line ~574) and in the reconnect cleanup (line ~628), add:
```typescript
setIsPaused(false);
```

- [ ] **Step 5: Pass new props to Toolbar**

In the `<Toolbar>` JSX, add:
```tsx
onPauseProcessing={isProcessing && !isPaused ? handlePauseProcessing : undefined}
onResumeProcessing={isProcessing && isPaused ? handleResumeProcessing : undefined}
isPaused={isPaused}
```

- [ ] **Step 6: Run typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/workspace/page.tsx
git commit -m "feat: pause/resume handlery a SSE eventy ve workspace"
```

---

### Task 7: Add interrupted processing banner

**Files:**
- Modify: `apps/web/app/workspace/page.tsx`

- [ ] **Step 1: Add interrupted state and detection**

Near the other state declarations, add:
```typescript
const [interruptedPages, setInterruptedPages] = useState<string[]>([]);
```

Add a useEffect to check for interrupted pages after pages load:
```typescript
useEffect(() => {
  if (loadingPages) return;
  const checkInterrupted = async (): Promise<void> => {
    try {
      const res = await fetch('/api/pages/process/interrupted');
      if (!res.ok) return;
      const data = (await res.json()) as { count: number; pageIds: string[] };
      setInterruptedPages(data.pageIds);
    } catch {
      // ignore
    }
  };
  void checkInterrupted();
}, [loadingPages]);
```

- [ ] **Step 2: Add handler for resuming interrupted pages**

```typescript
const handleResumeInterrupted = useCallback(async (): Promise<void> => {
  const pageIds = [...interruptedPages];
  setInterruptedPages([]);
  try {
    await fetch('/api/pages/process/interrupted', { method: 'POST' });
    // Update local state
    setPages((prev) => prev.map((p) => (pageIds.includes(p.id) ? { ...p, status: 'pending' } : p)));
    // Start processing
    setProcessingPageIds(new Set(pageIds));
    setProcessingStep('Spouštím zpracování…');
    setProcessingProgress(0);
    setError(null);
    setPages((prev) =>
      prev.map((p) => (pageIds.includes(p.id) ? { ...p, status: 'processing' } : p)),
    );
    const response = await fetch('/api/pages/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageIds, language: 'cs', mode: processingMode }),
    });
    if (!response.ok || !response.body) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error ?? `HTTP ${response.status}`);
    }
    await consumeProcessingStream(response);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Neznámá chyba');
  } finally {
    setProcessingPageIds(new Set());
    setBatchInfo(null);
    batchInfoRef.current = null;
    setIsPaused(false);
    setTimeout(() => {
      setProcessingStep(undefined);
      setProcessingProgress(undefined);
    }, 2000);
  }
}, [interruptedPages, processingMode, consumeProcessingStream]);

const handleResetInterrupted = useCallback(async (): Promise<void> => {
  const pageIds = [...interruptedPages];
  setInterruptedPages([]);
  try {
    await fetch('/api/pages/process/interrupted', { method: 'POST' });
    setPages((prev) => prev.map((p) => (pageIds.includes(p.id) ? { ...p, status: 'pending' } : p)));
  } catch {
    // ignore
  }
}, [interruptedPages]);
```

- [ ] **Step 3: Add banner JSX**

In the JSX, after the error banner (around line 1178) and before the content area, add:

```tsx
{/* Interrupted processing banner */}
{interruptedPages.length > 0 && !isProcessing && (
  <div className="mx-4 mt-3 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
    <svg className="h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
    <span className="flex-1">
      Zpracování {interruptedPages.length} {interruptedPages.length === 1 ? 'stránky' : interruptedPages.length < 5 ? 'stránek' : 'stránek'} bylo přerušeno.
    </span>
    <button
      onClick={() => void handleResumeInterrupted()}
      className="flex items-center gap-1 rounded border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50"
    >
      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
      </svg>
      Pokračovat
    </button>
    <button
      onClick={() => void handleResetInterrupted()}
      className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
    >
      Resetovat
    </button>
  </div>
)}
```

- [ ] **Step 4: Run typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Run all tests**

Run: `cd apps/web && npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/workspace/page.tsx
git commit -m "feat: banner pro přerušené zpracování s pokračovat/resetovat"
```

---

### Task 8: Reset stuck pages in database

**Files:** None (one-off database fix)

- [ ] **Step 1: Reset the 255 stuck pages from the Berner Chronik incident**

```bash
psql postgresql://martin-pracovni@localhost:5433/ai_sedlacek -c "UPDATE \"Page\" SET status = 'pending' WHERE status = 'processing';"
```

- [ ] **Step 2: Verify**

```bash
psql postgresql://martin-pracovni@localhost:5433/ai_sedlacek -c "SELECT status, COUNT(*) FROM \"Page\" GROUP BY status ORDER BY status;"
```

Expected: No pages in `processing` status.

---

### Task 9: Final validation

- [ ] **Step 1: Run full validation suite**

Run: `npx turbo typecheck && npx turbo lint && npx turbo test`
Expected: ALL PASS

- [ ] **Step 2: Manual smoke test**

1. Open http://localhost:3003/workspace
2. Select a few pages, click "Zpracovat"
3. Click "⏸ Pozastavit" — verify progress bar turns amber, processing pauses after current page
4. Click "▶ Pokračovat" — verify processing resumes
5. Click "⏹ Zrušit" — verify processing stops
6. Refresh page during processing — verify reconnect works
7. Kill and restart server during processing — verify interrupted banner appears

- [ ] **Step 3: Commit any fixes from validation**
