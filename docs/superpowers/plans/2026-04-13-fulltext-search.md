# Fulltext Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fulltext search across document transcriptions and translations, with results shown as dimmed/highlighted pages in the existing grid and highlighted text in the document panel.

**Architecture:** New API endpoint `GET /api/pages/search` queries PostgreSQL via Prisma (ILIKE on Document.transcription + Translation.text). Frontend adds search state to workspace page, passes matching IDs to FileGrid/FileList for dimming, and passes query to ResultViewer for text highlighting.

**Tech Stack:** Next.js API Route, Prisma, PostgreSQL ILIKE, React state + props

---

## File Structure

### Files to Create
| File | Responsibility |
|------|---------------|
| `apps/web/app/api/pages/search/route.ts` | Search API endpoint |

### Files to Modify
| File | Change |
|------|--------|
| `apps/web/components/Toolbar.tsx` | Add search button + inline input |
| `apps/web/app/[locale]/workspace/page.tsx` | Add search state, wire search to Toolbar/FileGrid/ResultViewer |
| `apps/web/components/FileGrid.tsx` | Accept `searchMatchIds` prop, dim non-matching pages |
| `apps/web/components/FileList.tsx` | Accept `searchMatchIds` prop, dim non-matching pages |
| `apps/web/components/ResultViewer.tsx` | Accept `highlightQuery` prop, highlight matches in text |
| `apps/web/messages/cs.json` | Search-related translations |
| `apps/web/messages/en.json` | Search-related translations |

---

### Task 1: Search API endpoint

**Files:**
- Create: `apps/web/app/api/pages/search/route.ts`

- [ ] **Step 1: Create the search API route**

Create `apps/web/app/api/pages/search/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@ai-sedlacek/db';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await getAuthenticatedUserId();
  if (auth.error) return auth.error;
  const { userId } = auth;

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const collectionId = searchParams.get('collectionId');

  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const pattern = `%${q}%`;

  const pages = await prisma.page.findMany({
    where: {
      userId,
      status: { not: 'archived' },
      ...(collectionId ? { collectionId } : {}),
      document: {
        OR: [
          { transcription: { contains: q, mode: 'insensitive' } },
          { translations: { some: { text: { contains: q, mode: 'insensitive' } } } },
        ],
      },
    },
    select: {
      id: true,
      filename: true,
      displayName: true,
      collectionId: true,
      collection: { select: { name: true } },
      document: {
        select: {
          transcription: true,
          translations: { select: { text: true } },
        },
      },
    },
  });

  const results = pages.map((page) => {
    const transcription = page.document?.transcription ?? '';
    const translationTexts = page.document?.translations.map((t) => t.text) ?? [];
    const allText = [transcription, ...translationTexts].join(' ');

    // Count occurrences (case-insensitive)
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = (allText.match(regex) ?? []).length;

    // Build snippet around first occurrence
    const lowerAll = allText.toLowerCase();
    const idx = lowerAll.indexOf(q.toLowerCase());
    let snippet = '';
    if (idx >= 0) {
      const start = Math.max(0, idx - 50);
      const end = Math.min(allText.length, idx + q.length + 50);
      snippet =
        (start > 0 ? '…' : '') +
        allText.slice(start, end) +
        (end < allText.length ? '…' : '');
    }

    return {
      pageId: page.id,
      filename: page.filename,
      displayName: page.displayName,
      collectionId: page.collectionId,
      collectionName: page.collection?.name ?? null,
      matches,
      snippet,
    };
  });

  return NextResponse.json({ results });
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web`

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/pages/search/route.ts
git commit -m "feat: přidat API endpoint pro fulltextové vyhledávání"
```

---

### Task 2: Add i18n translations for search

**Files:**
- Modify: `apps/web/messages/cs.json`
- Modify: `apps/web/messages/en.json`

- [ ] **Step 1: Add search translations to Czech**

In `apps/web/messages/cs.json`, add to the `"toolbar"` section (after `"cancelTitle"`):

```json
    "search": "Hledat",
    "searchPlaceholder": "Hledat v textech…",
    "searchAllCollections": "Hledat ve všech svazcích",
    "searchResults": "{count, plural, one {# výsledek} few {# výsledky} other {# výsledků}}",
    "searchNoResults": "Nic nenalezeno",
    "searchMatches": "{count}×"
```

- [ ] **Step 2: Add search translations to English**

In `apps/web/messages/en.json`, add to the `"toolbar"` section (after `"cancelTitle"`):

```json
    "search": "Search",
    "searchPlaceholder": "Search in texts…",
    "searchAllCollections": "Search all volumes",
    "searchResults": "{count, plural, one {# result} other {# results}}",
    "searchNoResults": "No results found",
    "searchMatches": "{count}×"
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/messages/cs.json apps/web/messages/en.json
git commit -m "feat: přidat i18n překlady pro vyhledávání"
```

---

### Task 3: Add search button and input to Toolbar

**Files:**
- Modify: `apps/web/components/Toolbar.tsx`

- [ ] **Step 1: Extend ToolbarProps interface**

Add these props to the `ToolbarProps` interface:

```typescript
  isSearchOpen?: boolean;
  onSearchToggle?: () => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  searchScope?: 'collection' | 'all';
  onSearchScopeChange?: (scope: 'collection' | 'all') => void;
  searchResultCount?: number;
  hasCollection?: boolean; // already exists
```

- [ ] **Step 2: Destructure new props and add search UI**

Add the new props to the destructuring. Then, after the Group 2 (Tools) `</div>` and before `{/* Group 3: Selected actions */}`, add:

```tsx
        {/* Search */}
        <div className={divider} />
        <div className="flex items-end gap-1">
          <button
            onClick={onSearchToggle}
            className={isSearchOpen ? `${btnBase} text-blue-600 bg-blue-50 hover:bg-blue-100` : btnDefault}
          >
            <svg className={ico} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            {t('search')}
          </button>
          {isSearchOpen && (
            <div className="flex items-center gap-2 self-center">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery ?? ''}
                  onChange={(e) => onSearchChange?.(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  autoFocus
                  className="w-48 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 placeholder-slate-400 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      onSearchToggle?.();
                      e.stopPropagation();
                    }
                  }}
                />
                {(searchQuery?.length ?? 0) > 0 && (
                  <button
                    onClick={() => onSearchChange?.('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              {hasCollection && (
                <label className="flex items-center gap-1 text-[10px] text-slate-500 whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={searchScope === 'all'}
                    onChange={(e) => onSearchScopeChange?.(e.target.checked ? 'all' : 'collection')}
                    className="h-3 w-3 rounded border-slate-300"
                  />
                  {t('searchAllCollections')}
                </label>
              )}
              {searchResultCount != null && (searchQuery?.length ?? 0) >= 2 && (
                <span className="text-[10px] text-slate-400 whitespace-nowrap">
                  {searchResultCount > 0
                    ? t('searchResults', { count: searchResultCount })
                    : t('searchNoResults')}
                </span>
              )}
            </div>
          )}
        </div>
```

- [ ] **Step 3: Verify typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web`

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/Toolbar.tsx
git commit -m "feat: přidat tlačítko a input pro vyhledávání do toolbaru"
```

---

### Task 4: Add search state and logic to workspace page

**Files:**
- Modify: `apps/web/app/[locale]/workspace/page.tsx`

- [ ] **Step 1: Add search state variables**

After the existing state declarations (after `const [createWorkspaceDialogOpen, setCreateWorkspaceDialogOpen] = useState(false);`), add:

```typescript
  // Search
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<'collection' | 'all'>('collection');
  const [searchResults, setSearchResults] = useState<Map<string, { matches: number; snippet: string; collectionName: string | null }>>(new Map());
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add the `useRef` import if not already present (it is).

- [ ] **Step 2: Add search effect with debounce**

After the state declarations, add:

```typescript
  // Search effect — debounced API call
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (!isSearchOpen || searchQuery.length < 2) {
      setSearchResults(new Map());
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      const params = new URLSearchParams({ q: searchQuery });
      if (searchScope === 'collection' && selectedCollectionId) {
        params.set('collectionId', selectedCollectionId);
      }
      try {
        const res = await apiFetch(`/api/pages/search?${params}`);
        if (!res.ok) return;
        const data = await res.json();
        const map = new Map<string, { matches: number; snippet: string; collectionName: string | null }>();
        for (const r of data.results) {
          map.set(r.pageId, { matches: r.matches, snippet: r.snippet, collectionName: r.collectionName });
        }
        setSearchResults(map);
      } catch {
        // ignore network errors
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, searchScope, isSearchOpen, selectedCollectionId]);
```

- [ ] **Step 3: Add search toggle handler and Ctrl+F shortcut**

Add a handler for toggling search:

```typescript
  const handleSearchToggle = useCallback(() => {
    setIsSearchOpen((prev) => {
      if (prev) {
        setSearchQuery('');
        setSearchResults(new Map());
      }
      return !prev;
    });
  }, []);
```

Add Ctrl+F handler — in the existing `useWorkspaceKeyboard` or as a separate effect. Since useWorkspaceKeyboard already captures keyboard events, add a new effect after it:

```typescript
  // Ctrl+F to open search
  useEffect(() => {
    const handleCtrlF = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && !panelPage) {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    document.addEventListener('keydown', handleCtrlF);
    return () => document.removeEventListener('keydown', handleCtrlF);
  }, [panelPage]);
```

- [ ] **Step 4: Wire search props to Toolbar**

Add these props to the existing `<Toolbar>` JSX:

```tsx
  isSearchOpen={isSearchOpen}
  onSearchToggle={handleSearchToggle}
  searchQuery={searchQuery}
  onSearchChange={setSearchQuery}
  searchScope={searchScope}
  onSearchScopeChange={setSearchScope}
  searchResultCount={searchResults.size}
```

- [ ] **Step 5: Pass searchMatchIds to FileGrid and FileList**

Compute the set of matching IDs:

```typescript
  const searchMatchIds = isSearchOpen && searchQuery.length >= 2 ? searchResults : null;
```

Add to `<FileGrid>`:
```tsx
  searchMatchIds={searchMatchIds}
```

Add to `<FileList>` (if rendered):
```tsx
  searchMatchIds={searchMatchIds}
```

- [ ] **Step 6: Pass highlightQuery to ResultViewer via DocumentPanel**

Find where `<DocumentPanel>` is rendered and add:

```tsx
  highlightQuery={isSearchOpen ? searchQuery : undefined}
```

This requires DocumentPanel to accept and pass through `highlightQuery`. Add to DocumentPanel's props interface:

```typescript
  highlightQuery?: string;
```

And pass it down to `<ResultViewer>` inside DocumentPanel:

```tsx
  highlightQuery={highlightQuery}
```

- [ ] **Step 7: Verify typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web`

- [ ] **Step 8: Commit**

```bash
git add "apps/web/app/[locale]/workspace/page.tsx"
git commit -m "feat: search state, debounce a Ctrl+F zkratka ve workspace"
```

---

### Task 5: Dim non-matching pages in FileGrid

**Files:**
- Modify: `apps/web/components/FileGrid.tsx`

- [ ] **Step 1: Add `searchMatchIds` prop to FileGridProps**

```typescript
  searchMatchIds?: Map<string, { matches: number; snippet: string; collectionName: string | null }> | null;
```

Destructure it in the component function.

- [ ] **Step 2: Apply dimming and badge to each page card**

Find where individual page cards are rendered (the div with `cursor=pointer` for each page). Wrap the card's `className` to include opacity when search is active but page doesn't match:

```typescript
const isSearchActive = searchMatchIds != null;
const isMatch = searchMatchIds?.has(page.id) ?? false;
const matchCount = searchMatchIds?.get(page.id)?.matches;
```

Add to the card's className:
```typescript
className={`... ${isSearchActive && !isMatch ? 'opacity-20' : ''}`}
```

Add a match count badge inside the card (near the status badge):
```tsx
{isSearchActive && isMatch && matchCount != null && (
  <div className="absolute left-1 top-1 rounded-full bg-yellow-400 px-1.5 py-0.5 text-[9px] font-bold text-yellow-900">
    {matchCount}×
  </div>
)}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web`

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/FileGrid.tsx
git commit -m "feat: ztlumení nematchujících stránek a badge ve FileGrid"
```

---

### Task 6: Dim non-matching pages in FileList

**Files:**
- Modify: `apps/web/components/FileList.tsx`

- [ ] **Step 1: Add `searchMatchIds` prop to FileListProps**

Same type as FileGrid:
```typescript
  searchMatchIds?: Map<string, { matches: number; snippet: string; collectionName: string | null }> | null;
```

- [ ] **Step 2: Apply dimming to each list row**

Similar logic as FileGrid — add opacity to non-matching rows and a match count indicator:

```typescript
const isSearchActive = searchMatchIds != null;
const isMatch = searchMatchIds?.has(page.id) ?? false;
const matchCount = searchMatchIds?.get(page.id)?.matches;
```

Add to row className:
```typescript
className={`... ${isSearchActive && !isMatch ? 'opacity-20' : ''}`}
```

Add match count next to filename:
```tsx
{isSearchActive && isMatch && matchCount != null && (
  <span className="ml-1 rounded bg-yellow-100 px-1 text-[10px] font-medium text-yellow-700">
    {matchCount}×
  </span>
)}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web`

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/FileList.tsx
git commit -m "feat: ztlumení nematchujících stránek a badge ve FileList"
```

---

### Task 7: Highlight search query in ResultViewer

**Files:**
- Modify: `apps/web/components/ResultViewer.tsx`

- [ ] **Step 1: Add `highlightQuery` prop to ResultViewerProps**

```typescript
interface ResultViewerProps {
  result: DocumentResult;
  onUpdate?: (updated: DocumentResult) => void;
  highlightQuery?: string;
}
```

- [ ] **Step 2: Create a highlight helper function**

Add before the `ResultViewer` function:

```typescript
function highlightText(text: string, query: string | undefined): string {
  if (!query || query.length < 2) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(
    new RegExp(`(${escaped})`, 'gi'),
    '==$1==',
  );
}
```

This uses `==text==` which is the markdown highlight syntax. ReactMarkdown with remark-gfm renders `==text==` as `<mark>`.

Note: remark-gfm does NOT support `==highlight==` syntax. We need a different approach. Instead, modify the `EditableSection` component to accept `highlightQuery` and do DOM-level highlighting.

**Revised approach:** Add `highlightQuery` prop to `EditableSection`. When not editing, instead of rendering markdown directly, post-process the rendered content to wrap matches in `<mark>`.

- [ ] **Step 3: Modify EditableSection to highlight matches**

Add `highlightQuery?: string` to EditableSection props:

```typescript
function EditableSection({
  title,
  subtitle,
  content,
  onSave,
  saving,
  highlightQuery,
}: {
  title: string;
  subtitle?: string;
  content: string;
  onSave: (newContent: string) => void;
  saving?: boolean;
  highlightQuery?: string;
}): React.JSX.Element {
```

Create a `HighlightedMarkdown` component inside ResultViewer.tsx (before `EditableSection`):

```typescript
function HighlightedMarkdown({ content, query }: { content: string; query?: string }): React.JSX.Element {
  if (!query || query.length < 2) {
    return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = content.split(regex);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Override text rendering to highlight matches
        p: ({ children }) => <p>{highlightChildren(children, regex)}</p>,
        li: ({ children }) => <li>{highlightChildren(children, regex)}</li>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function highlightChildren(children: React.ReactNode, regex: RegExp): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      const parts = child.split(regex);
      if (parts.length <= 1) return child;
      return parts.map((part, i) =>
        regex.test(part) ? <mark key={i} className="bg-yellow-200 rounded px-0.5">{part}</mark> : part
      );
    }
    return child;
  });
}
```

Replace the markdown rendering in EditableSection's non-editing mode:

```tsx
      ) : (
        <div className="prose prose-stone prose-sm max-w-none p-4">
          <HighlightedMarkdown content={content} query={highlightQuery} />
        </div>
      )}
```

- [ ] **Step 4: Pass highlightQuery to EditableSection calls**

In `ResultViewer`, pass `highlightQuery` to each `<EditableSection>` for transcription and translation:

```tsx
    <EditableSection
      title={t('transcription')}
      subtitle={t('originalLanguage', { lang: result.detectedLanguage })}
      content={result.transcription}
      onSave={(text) => void handleTranscriptionSave(text)}
      saving={saving}
      highlightQuery={highlightQuery}
    />
```

```tsx
    <EditableSection
      title={t('translation')}
      subtitle={...}
      content={result.translation}
      onSave={(text) => void saveField('translation', text)}
      saving={saving}
      highlightQuery={highlightQuery}
    />
```

- [ ] **Step 5: Add React import for Children.map**

Ensure `React` is imported at the top of ResultViewer.tsx (it likely is via `useState`, but `React.Children` requires the namespace import):

```typescript
import React, { useState, useCallback, useRef } from 'react';
```

- [ ] **Step 6: Verify typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web`

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ResultViewer.tsx
git commit -m "feat: zvýrazňování nalezených výrazů v transkripci a překladu"
```

---

### Task 8: Wire highlightQuery through DocumentPanel

**Files:**
- Modify: `apps/web/components/DocumentPanel.tsx`

- [ ] **Step 1: Add `highlightQuery` to DocumentPanelProps**

```typescript
  highlightQuery?: string;
```

Destructure it in the component.

- [ ] **Step 2: Pass to ResultViewer**

Find where `<ResultViewer>` is rendered inside DocumentPanel and add:

```tsx
  highlightQuery={highlightQuery}
```

- [ ] **Step 3: Verify typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web`

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/DocumentPanel.tsx
git commit -m "feat: předat highlightQuery z DocumentPanel do ResultViewer"
```

---

### Task 9: Deploy and verify

- [ ] **Step 1: Run full validation**

```bash
npx turbo typecheck && npx turbo lint
```

- [ ] **Step 2: Push and deploy**

```bash
git push origin main
ssh root@204.168.176.128 "cd /opt/AiSedlacek && git pull origin main && npx turbo build --filter=@ai-sedlacek/web && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static && cp -r apps/web/public apps/web/.next/standalone/apps/web/public 2>/dev/null; pm2 restart ai-sedlacek-web"
```

- [ ] **Step 3: Verify search works**

1. Open https://aisedlacek.com, log in
2. Open a collection with processed documents
3. Click "Hledat" button in toolbar
4. Type a word that appears in transcriptions (e.g. "Wien" or "Beroun")
5. Verify: non-matching pages dim, matching pages show yellow badge with count
6. Double-click a matching page — verify yellow highlights in transcription/translation
7. Try "Hledat ve všech svazcích" checkbox — should search across all collections
8. Press Escape — search closes, filter resets
9. Press Ctrl+F — search opens
