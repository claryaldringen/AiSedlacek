# CLI klient (`ais`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLI klient pro čtečku starých textů — upload obrázků (URL/soubory), lokální OCR přes `claude` CLI, pull/push editace, správa kolekcí.

**Architecture:** Nový `apps/cli` v Turborepo monorepu. Importuje z `packages/ocr` (lokální OCR), `packages/shared` (typy). Komunikuje se serverem přes HTTP API (Bearer token auth). Nové server endpointy pro URL upload, OCR result upload, a API token auth.

**Tech Stack:** Commander.js, chalk, ora, cli-table3, open (browser), tsup (bundling), vitest (testy)

---

## File Structure

### Nové soubory (CLI app)

| File | Responsibility |
|------|---------------|
| `apps/cli/package.json` | Dependencies, bin entry, scripts |
| `apps/cli/tsconfig.json` | TS config extending base |
| `apps/cli/tsup.config.ts` | Bundle config |
| `apps/cli/src/bin.ts` | Shebang entry point |
| `apps/cli/src/index.ts` | Commander program setup, all commands registered |
| `apps/cli/src/lib/config.ts` | Config loading (~/.config/ai-sedlacek/), server URL |
| `apps/cli/src/lib/auth.ts` | Token read/write/delete from config dir |
| `apps/cli/src/lib/api-client.ts` | HTTP fetch wrapper with Bearer auth |
| `apps/cli/src/lib/workspace.ts` | .ais-workspace/ management, hash tracking, meta.json |
| `apps/cli/src/lib/output.ts` | Table formatting, colored output helpers |
| `apps/cli/src/commands/login.ts` | OAuth browser flow + local HTTP callback server |
| `apps/cli/src/commands/logout.ts` | Token revocation + local delete |
| `apps/cli/src/commands/whoami.ts` | Show logged-in user |
| `apps/cli/src/commands/upload.ts` | URL + local file upload |
| `apps/cli/src/commands/process.ts` | Local OCR via claude CLI, result upload |
| `apps/cli/src/commands/list.ts` | List pages (table) |
| `apps/cli/src/commands/show.ts` | Show page detail |
| `apps/cli/src/commands/pull.ts` | Download documents to workspace |
| `apps/cli/src/commands/push.ts` | Upload changed files to server |
| `apps/cli/src/commands/diff.ts` | Show local changes vs server |
| `apps/cli/src/commands/collections.ts` | Collection CRUD |

### Nové soubory (server)

| File | Responsibility |
|------|---------------|
| `apps/web/app/api/pages/upload-url/route.ts` | Download images from URLs, create Pages |
| `apps/web/app/api/pages/[id]/result/route.ts` | Accept OCR results from CLI, create Document+Translation+Glossary+Version |
| `apps/web/app/api/auth/cli/token/route.ts` | POST: exchange auth code for API token, DELETE: revoke |
| `apps/web/app/api/auth/cli/me/route.ts` | GET: current user info via API token |
| `apps/web/app/auth/cli/page.tsx` | OAuth consent UI ("Povolit přístup pro CLI?") |
| `apps/web/lib/infrastructure/api-auth.ts` | `resolveUser(request)` — try session, then Bearer token |

### Modifikované soubory

| File | Change |
|------|--------|
| `apps/web/prisma/schema.prisma` | Add `ApiToken` model, add `apiTokens` relation to `User` |
| `turbo.json` | Add CLI-specific env vars if needed |
| `.gitignore` | Add `.ais-workspace/` |

### Prisma migrace

```prisma
model ApiToken {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  name       String    @default("CLI")
  lastUsedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
}
```

---

## Task 1: Scaffolding — `apps/cli` balíček

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/tsup.config.ts`
- Create: `apps/cli/src/bin.ts`
- Create: `apps/cli/src/index.ts`

- [ ] **Step 1: Vytvořit `apps/cli/package.json`**

```json
{
  "name": "@ai-sedlacek/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "ais": "./dist/bin.js"
  },
  "scripts": {
    "dev": "tsup --watch",
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "format:check": "prettier --check src/",
    "format": "prettier --write src/",
    "test": "vitest run"
  },
  "dependencies": {
    "@ai-sedlacek/ocr": "*",
    "@ai-sedlacek/shared": "*",
    "chalk": "^5",
    "cli-table3": "^0.6",
    "commander": "^13",
    "open": "^10",
    "ora": "^8"
  },
  "devDependencies": {
    "eslint": "^9",
    "prettier": "^3",
    "tsup": "^8",
    "typescript": "^5",
    "typescript-eslint": "^8",
    "vitest": "^3"
  }
}
```

- [ ] **Step 2: Vytvořit `apps/cli/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Vytvořit `apps/cli/tsup.config.ts`**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
});
```

- [ ] **Step 4: Vytvořit `apps/cli/src/bin.ts`**

```typescript
#!/usr/bin/env node
import { program } from './index.js';

program.parse();
```

- [ ] **Step 5: Vytvořit `apps/cli/src/index.ts`**

```typescript
import { Command } from 'commander';

export const program = new Command()
  .name('ais')
  .description('CLI klient pro čtečku starých textů')
  .version('0.0.0');
```

- [ ] **Step 6: Spustit `npm install` z rootu monorepa**

Run: `npm install`
Expected: success, `apps/cli` resolved in workspace

- [ ] **Step 7: Ověřit build**

Run: `npx turbo build --filter=@ai-sedlacek/cli`
Expected: `dist/bin.js` vytvořen

- [ ] **Step 8: Ověřit typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/cli`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/cli/
git commit -m "feat(cli): scaffold apps/cli balíček s Commander.js"
```

---

## Task 2: Config a Auth library

**Files:**
- Create: `apps/cli/src/lib/config.ts`
- Create: `apps/cli/src/lib/auth.ts`
- Create: `apps/cli/src/__tests__/config.test.ts`
- Create: `apps/cli/src/__tests__/auth.test.ts`

- [ ] **Step 1: Napsat test pro config**

```typescript
// apps/cli/src/__tests__/config.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getConfigDir, loadConfig, saveConfig } from '../lib/config.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('node:fs');
vi.mock('node:os');

describe('config', () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue('/home/test');
  });

  it('returns config dir path', () => {
    expect(getConfigDir()).toBe('/home/test/.config/ai-sedlacek');
  });

  it('loads config from file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ server: 'https://sedlacek.ai' }),
    );
    const config = loadConfig();
    expect(config.server).toBe('https://sedlacek.ai');
  });

  it('returns defaults when no config file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig();
    expect(config.server).toBe('https://sedlacek.ai');
  });
});
```

- [ ] **Step 2: Spustit test — ověřit FAIL**

Run: `cd apps/cli && npx vitest run src/__tests__/config.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implementovat `config.ts`**

```typescript
// apps/cli/src/lib/config.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface CliConfig {
  server: string;
}

const DEFAULT_CONFIG: CliConfig = {
  server: 'https://sedlacek.ai',
};

export function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'ai-sedlacek');
}

export function loadConfig(): CliConfig {
  const configPath = path.join(getConfigDir(), 'config.json');
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function saveConfig(config: CliConfig): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify(config, null, 2),
  );
}
```

- [ ] **Step 4: Spustit test — ověřit PASS**

Run: `cd apps/cli && npx vitest run src/__tests__/config.test.ts`
Expected: PASS

- [ ] **Step 5: Napsat test pro auth**

```typescript
// apps/cli/src/__tests__/auth.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getToken, saveToken, deleteToken } from '../lib/auth.js';
import * as fs from 'node:fs';
import * as os from 'node:os';

vi.mock('node:fs');
vi.mock('node:os');

describe('auth', () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue('/home/test');
  });

  it('returns null when no token file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(getToken()).toBeNull();
  });

  it('reads token from file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ token: 'test-token-123' }),
    );
    expect(getToken()).toBe('test-token-123');
  });

  it('saves token to file', () => {
    const writeSpy = vi.mocked(fs.writeFileSync);
    saveToken('new-token');
    expect(writeSpy).toHaveBeenCalledWith(
      '/home/test/.config/ai-sedlacek/auth.json',
      JSON.stringify({ token: 'new-token' }, null, 2),
    );
  });

  it('deletes token file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const unlinkSpy = vi.mocked(fs.unlinkSync);
    deleteToken();
    expect(unlinkSpy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Spustit test — ověřit FAIL**

Run: `cd apps/cli && npx vitest run src/__tests__/auth.test.ts`
Expected: FAIL

- [ ] **Step 7: Implementovat `auth.ts`**

```typescript
// apps/cli/src/lib/auth.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getConfigDir } from './config.js';

function getAuthPath(): string {
  return path.join(getConfigDir(), 'auth.json');
}

export function getToken(): string | null {
  const authPath = getAuthPath();
  if (!fs.existsSync(authPath)) return null;
  const raw = fs.readFileSync(authPath, 'utf-8');
  const data = JSON.parse(raw);
  return data.token ?? null;
}

export function saveToken(token: string): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    getAuthPath(),
    JSON.stringify({ token }, null, 2),
  );
}

export function deleteToken(): void {
  const authPath = getAuthPath();
  if (fs.existsSync(authPath)) {
    fs.unlinkSync(authPath);
  }
}
```

- [ ] **Step 8: Spustit testy — ověřit PASS**

Run: `cd apps/cli && npx vitest run src/__tests__/`
Expected: ALL PASS

- [ ] **Step 9: Commit**

```bash
git add apps/cli/src/lib/config.ts apps/cli/src/lib/auth.ts apps/cli/src/__tests__/
git commit -m "feat(cli): config a auth moduly s testy"
```

---

## Task 3: API klient

**Files:**
- Create: `apps/cli/src/lib/api-client.ts`
- Create: `apps/cli/src/__tests__/api-client.test.ts`

- [ ] **Step 1: Napsat test**

```typescript
// apps/cli/src/__tests__/api-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiClient } from '../lib/api-client.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('api-client', () => {
  let api: ReturnType<typeof createApiClient>;

  beforeEach(() => {
    mockFetch.mockReset();
    api = createApiClient('https://sedlacek.ai', 'test-token');
  });

  it('sends GET with auth header', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const result = await api.get('/api/pages');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://sedlacek.ai/api/pages',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('sends POST JSON with auth header', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ id: '1' })));
    const result = await api.postJson('/api/collections', { name: 'Test' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://sedlacek.ai/api/collections',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        }),
      }),
    );
    expect(result).toEqual({ id: '1' });
  });

  it('throws on 401', async () => {
    mockFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    await expect(api.get('/api/pages')).rejects.toThrow('Nejste přihlášen');
  });

  it('throws on server error', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    );
    await expect(api.get('/api/pages/999')).rejects.toThrow('Not found');
  });
});
```

- [ ] **Step 2: Spustit test — ověřit FAIL**

Run: `cd apps/cli && npx vitest run src/__tests__/api-client.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementovat `api-client.ts`**

```typescript
// apps/cli/src/lib/api-client.ts

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function createApiClient(serverUrl: string, token: string) {
  async function request(path: string, init?: RequestInit): Promise<any> {
    const url = `${serverUrl}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
    });

    if (res.status === 401) {
      throw new ApiError(401, 'Nejste přihlášen. Spusťte `ais login`.');
    }

    const body = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = body?.error ?? `Server vrátil ${res.status}`;
      throw new ApiError(res.status, msg);
    }

    return body;
  }

  return {
    get(path: string) {
      return request(path);
    },

    postJson(path: string, data: unknown) {
      return request(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    patchJson(path: string, data: unknown) {
      return request(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    delete(path: string) {
      return request(path, { method: 'DELETE' });
    },

    async postFormData(path: string, formData: FormData) {
      return request(path, {
        method: 'POST',
        body: formData,
        headers: {}, // let fetch set content-type with boundary
      });
    },

    getRaw(path: string): Promise<Response> {
      const url = `${serverUrl}${path}`;
      return fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
```

- [ ] **Step 4: Spustit test — ověřit PASS**

Run: `cd apps/cli && npx vitest run src/__tests__/api-client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/lib/api-client.ts apps/cli/src/__tests__/api-client.test.ts
git commit -m "feat(cli): API klient s auth a error handling"
```

---

## Task 4: Output helpers

**Files:**
- Create: `apps/cli/src/lib/output.ts`

- [ ] **Step 1: Implementovat `output.ts`**

```typescript
// apps/cli/src/lib/output.ts
import chalk from 'chalk';
import Table from 'cli-table3';

export function error(msg: string): void {
  console.error(chalk.red(`Chyba: ${msg}`));
}

export function success(msg: string): void {
  console.log(chalk.green(msg));
}

export function info(msg: string): void {
  console.log(chalk.blue(msg));
}

export function warn(msg: string): void {
  console.log(chalk.yellow(msg));
}

export function table(
  headers: string[],
  rows: string[][],
): void {
  const t = new Table({ head: headers.map((h) => chalk.bold(h)) });
  for (const row of rows) {
    t.push(row);
  }
  console.log(t.toString());
}

export function statusBadge(status: string): string {
  switch (status) {
    case 'done':
    case 'completed':
      return chalk.green('done');
    case 'pending':
      return chalk.yellow('pending');
    case 'processing':
      return chalk.blue('processing');
    case 'error':
      return chalk.red('error');
    case 'blank':
      return chalk.gray('blank');
    default:
      return status;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/cli && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/cli/src/lib/output.ts
git commit -m "feat(cli): output helpers — tabulky, barvy, status badge"
```

---

## Task 5: Workspace management (pull/push/diff)

**Files:**
- Create: `apps/cli/src/lib/workspace.ts`
- Create: `apps/cli/src/__tests__/workspace.test.ts`

- [ ] **Step 1: Napsat test**

```typescript
// apps/cli/src/__tests__/workspace.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import {
  getWorkspaceDir,
  getPageDir,
  writePageFiles,
  readPageFiles,
  getChangedFiles,
  readMeta,
  PageData,
} from '../lib/workspace.js';

vi.mock('node:fs');

describe('workspace', () => {
  it('returns workspace dir in cwd', () => {
    expect(getWorkspaceDir()).toBe(process.cwd() + '/.ais-workspace');
  });

  it('returns page dir', () => {
    expect(getPageDir('42')).toBe(process.cwd() + '/.ais-workspace/42');
  });

  it('writes page files and meta', () => {
    const mkdirSpy = vi.mocked(fs.mkdirSync);
    const writeSpy = vi.mocked(fs.writeFileSync);

    const data: PageData = {
      pageId: '42',
      documentId: 'doc-1',
      transcription: 'Hallo Welt',
      translation: 'Ahoj světe',
      context: 'Kontext',
      glossary: '**Welt**: svět',
    };

    writePageFiles(data);

    // 4 content files + 1 meta file = 5 writes
    expect(writeSpy).toHaveBeenCalledTimes(5);
    expect(mkdirSpy).toHaveBeenCalledWith(
      expect.stringContaining('/.ais-workspace/42'),
      { recursive: true },
    );
  });

  it('detects changed files', () => {
    // Meta has old hashes, files on disk have different content
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      if (filePath.toString().endsWith('.meta.json')) {
        return JSON.stringify({
          documentId: 'doc-1',
          pageId: '42',
          pulledAt: '2026-04-20T10:00:00Z',
          hashes: {
            'transcription.md': 'sha256:old-hash',
            'translation.md': 'sha256:current-hash',
            'context.md': 'sha256:current-hash',
            'glossary.md': 'sha256:current-hash',
          },
        });
      }
      return 'file content';
    });

    const changed = getChangedFiles('42');
    // All 4 files will be "changed" because real hash won't match 'sha256:old-hash'
    expect(changed.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Spustit test — ověřit FAIL**

Run: `cd apps/cli && npx vitest run src/__tests__/workspace.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementovat `workspace.ts`**

```typescript
// apps/cli/src/lib/workspace.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const WORKSPACE_DIR = '.ais-workspace';
const FILES = ['transcription.md', 'translation.md', 'context.md', 'glossary.md'] as const;

export type WorkspaceFile = (typeof FILES)[number];

export interface PageData {
  pageId: string;
  documentId: string;
  transcription: string;
  translation: string;
  context: string;
  glossary: string;
}

export interface PageMeta {
  documentId: string;
  pageId: string;
  pulledAt: string;
  hashes: Record<string, string>;
}

function sha256(content: string): string {
  return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
}

export function getWorkspaceDir(): string {
  return path.join(process.cwd(), WORKSPACE_DIR);
}

export function getPageDir(pageId: string): string {
  return path.join(getWorkspaceDir(), pageId);
}

export function writePageFiles(data: PageData): void {
  const dir = getPageDir(data.pageId);
  fs.mkdirSync(dir, { recursive: true });

  const contents: Record<WorkspaceFile, string> = {
    'transcription.md': data.transcription,
    'translation.md': data.translation,
    'context.md': data.context,
    'glossary.md': data.glossary,
  };

  const hashes: Record<string, string> = {};
  for (const [file, content] of Object.entries(contents)) {
    const filePath = path.join(dir, file);
    fs.writeFileSync(filePath, content);
    hashes[file] = sha256(content);
  }

  const meta: PageMeta = {
    documentId: data.documentId,
    pageId: data.pageId,
    pulledAt: new Date().toISOString(),
    hashes,
  };
  fs.writeFileSync(path.join(dir, '.meta.json'), JSON.stringify(meta, null, 2));
}

export function readMeta(pageId: string): PageMeta | null {
  const metaPath = path.join(getPageDir(pageId), '.meta.json');
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
}

export function readPageFiles(pageId: string): Record<WorkspaceFile, string> | null {
  const dir = getPageDir(pageId);
  if (!fs.existsSync(dir)) return null;

  const result: Record<string, string> = {};
  for (const file of FILES) {
    const filePath = path.join(dir, file);
    result[file] = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
  }
  return result as Record<WorkspaceFile, string>;
}

export interface ChangedFile {
  file: WorkspaceFile;
  oldHash: string;
  newHash: string;
}

export function getChangedFiles(pageId: string): ChangedFile[] {
  const meta = readMeta(pageId);
  if (!meta) return [];

  const dir = getPageDir(pageId);
  const changed: ChangedFile[] = [];

  for (const file of FILES) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) continue;

    const content = fs.readFileSync(filePath, 'utf-8');
    const currentHash = sha256(content);
    const oldHash = meta.hashes[file] ?? '';

    if (currentHash !== oldHash) {
      changed.push({ file, oldHash, newHash: currentHash });
    }
  }

  return changed;
}

export function listWorkspacePages(): string[] {
  const dir = getWorkspaceDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((entry) => {
    const entryPath = path.join(dir, entry);
    return fs.statSync(entryPath).isDirectory() && !entry.startsWith('.');
  });
}
```

- [ ] **Step 4: Spustit test — ověřit PASS**

Run: `cd apps/cli && npx vitest run src/__tests__/workspace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/lib/workspace.ts apps/cli/src/__tests__/workspace.test.ts
git commit -m "feat(cli): workspace management — write/read/diff lokálních souborů"
```

---

## Task 6: Server — Prisma migrace (ApiToken model)

**Files:**
- Modify: `apps/web/prisma/schema.prisma`

- [ ] **Step 1: Přidat ApiToken model do schema.prisma**

Přidat na konec souboru:

```prisma
model ApiToken {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  name       String    @default("CLI")
  lastUsedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
}
```

A přidat relaci do modelu `User`:

```prisma
  apiTokens     ApiToken[]
```

- [ ] **Step 2: Spustit migrace**

Run: `npx prisma migrate dev --schema=apps/web/prisma/schema.prisma --name add_api_token`
Expected: Migration created and applied

- [ ] **Step 3: Vygenerovat Prisma klienta**

Run: `npx prisma generate --schema=apps/web/prisma/schema.prisma`
Expected: Prisma Client generated

- [ ] **Step 4: Commit**

```bash
git add apps/web/prisma/
git commit -m "feat(db): přidat ApiToken model pro CLI autentizaci"
```

---

## Task 7: Server — API token auth middleware

**Files:**
- Create: `apps/web/lib/infrastructure/api-auth.ts`
- Create: `apps/web/lib/infrastructure/__tests__/api-auth.test.ts`

- [ ] **Step 1: Napsat test**

```typescript
// apps/web/lib/infrastructure/__tests__/api-auth.test.ts
import { describe, it, expect, vi } from 'vitest';
import { resolveUserFromToken } from '../api-auth.js';

vi.mock('@ai-sedlacek/db', () => ({
  prisma: {
    apiToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '@ai-sedlacek/db';

describe('resolveUserFromToken', () => {
  it('returns null for missing header', async () => {
    const result = await resolveUserFromToken(null);
    expect(result).toBeNull();
  });

  it('returns null for invalid prefix', async () => {
    const result = await resolveUserFromToken('Basic abc');
    expect(result).toBeNull();
  });

  it('returns userId for valid token', async () => {
    vi.mocked(prisma.apiToken.findUnique).mockResolvedValue({
      id: 'tok-1',
      userId: 'user-123',
      tokenHash: 'hash',
      name: 'CLI',
      lastUsedAt: null,
      createdAt: new Date(),
    } as any);
    vi.mocked(prisma.apiToken.update).mockResolvedValue({} as any);

    const result = await resolveUserFromToken('Bearer test-token-123');
    expect(result).toBe('user-123');
  });

  it('returns null for unknown token', async () => {
    vi.mocked(prisma.apiToken.findUnique).mockResolvedValue(null);
    const result = await resolveUserFromToken('Bearer unknown');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Spustit test — ověřit FAIL**

Run: `cd apps/web && npx vitest run lib/infrastructure/__tests__/api-auth.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementovat `api-auth.ts`**

```typescript
// apps/web/lib/infrastructure/api-auth.ts
import * as crypto from 'node:crypto';
import { prisma } from '@ai-sedlacek/db';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function resolveUserFromToken(
  authHeader: string | null,
): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const apiToken = await prisma.apiToken.findUnique({
    where: { tokenHash },
  });

  if (!apiToken) return null;

  // Update lastUsedAt (fire and forget)
  prisma.apiToken
    .update({
      where: { id: apiToken.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => {});

  return apiToken.userId;
}

export { hashToken };
```

- [ ] **Step 4: Spustit test — ověřit PASS**

Run: `cd apps/web && npx vitest run lib/infrastructure/__tests__/api-auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/infrastructure/api-auth.ts apps/web/lib/infrastructure/__tests__/api-auth.test.ts
git commit -m "feat(server): API token auth — resolveUserFromToken"
```

---

## Task 8: Server — CLI auth endpointy (token exchange, revoke, me)

**Files:**
- Create: `apps/web/app/api/auth/cli/token/route.ts`
- Create: `apps/web/app/api/auth/cli/me/route.ts`
- Create: `apps/web/app/auth/cli/page.tsx`

- [ ] **Step 1: Implementovat token endpoint**

```typescript
// apps/web/app/api/auth/cli/token/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'node:crypto';
import { prisma } from '@ai-sedlacek/db';
import { hashToken, resolveUserFromToken } from '@/lib/infrastructure/api-auth';
import { requireUserId } from '@/lib/auth';

// POST: Exchange session auth for API token (called from CLI after OAuth consent)
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const userId = await requireUserId();

    // Generate random token
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);

    await prisma.apiToken.create({
      data: {
        userId,
        tokenHash,
        name: 'CLI',
      },
    });

    return NextResponse.json({ token });
  } catch {
    return NextResponse.json({ error: 'Nepřihlášen' }, { status: 401 });
  }
}

// DELETE: Revoke API token
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const userId = await resolveUserFromToken(authHeader);
  if (!userId) {
    return NextResponse.json({ error: 'Neplatný token' }, { status: 401 });
  }

  const token = authHeader!.slice(7);
  const tokenHash = hashToken(token);

  await prisma.apiToken.delete({
    where: { tokenHash },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Implementovat me endpoint**

```typescript
// apps/web/app/api/auth/cli/me/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@ai-sedlacek/db';
import { resolveUserFromToken } from '@/lib/infrastructure/api-auth';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const userId = await resolveUserFromToken(
    request.headers.get('authorization'),
  );
  if (!userId) {
    return NextResponse.json({ error: 'Neplatný token' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'Uživatel nenalezen' }, { status: 404 });
  }

  return NextResponse.json(user);
}
```

- [ ] **Step 3: Implementovat OAuth consent stránku**

```tsx
// apps/web/app/auth/cli/page.tsx
'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function CliAuthPage() {
  const searchParams = useSearchParams();
  const state = searchParams.get('state');
  const redirect = searchParams.get('redirect');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function handleAuthorize() {
    setStatus('loading');
    try {
      const res = await fetch('/api/auth/cli/token', { method: 'POST' });
      if (!res.ok) throw new Error('Token creation failed');
      const { token } = await res.json();

      // Redirect back to CLI local server with token
      const url = new URL(redirect!);
      url.searchParams.set('token', token);
      url.searchParams.set('state', state!);
      window.location.href = url.toString();
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  if (!state || !redirect) {
    return <div className="p-8 text-center">Neplatný požadavek.</div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="mx-4 w-full max-w-md rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-4 text-xl font-bold">CLI přístup</h1>
        <p className="mb-6 text-gray-600">
          Aplikace <strong>ais</strong> žádá přístup k vašemu účtu.
        </p>

        {status === 'error' && (
          <p className="mb-4 text-red-600">
            Chyba při autorizaci. Zkuste to znovu.
          </p>
        )}

        <button
          onClick={handleAuthorize}
          disabled={status === 'loading' || status === 'done'}
          className="w-full rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {status === 'loading' ? 'Autorizuji...' : 'Povolit přístup'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/auth/cli/ apps/web/app/auth/cli/
git commit -m "feat(server): CLI auth endpointy — token exchange, revoke, me, consent page"
```

---

## Task 9: Server — Upload URL endpoint

**Files:**
- Create: `apps/web/app/api/pages/upload-url/route.ts`
- Create: `apps/web/app/api/pages/__tests__/upload-url.test.ts`

- [ ] **Step 1: Napsat test**

```typescript
// apps/web/app/api/pages/__tests__/upload-url.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../upload-url/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/infrastructure/api-auth', () => ({
  resolveUserFromToken: vi.fn().mockResolvedValue('user-1'),
}));

vi.mock('@ai-sedlacek/db', () => ({
  prisma: {
    page: {
      create: vi.fn().mockResolvedValue({
        id: 'page-1',
        filename: 'scan1.jpg',
        status: 'pending',
      }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock('@/lib/adapters/storage', () => ({
  getStorage: () => ({
    upload: vi.fn().mockResolvedValue({ path: 'uploads/uuid-scan1.jpg', url: '/uploads/uuid-scan1.jpg' }),
  }),
}));

// Mock global fetch for URL download
const originalFetch = global.fetch;

describe('POST /api/pages/upload-url', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), {
        headers: { 'content-type': 'image/jpeg', 'content-length': '1000' },
      }),
    );
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('downloads images from URLs and creates pages', async () => {
    const req = new NextRequest('http://localhost/api/pages/upload-url', {
      method: 'POST',
      body: JSON.stringify({ urls: ['https://example.com/scan1.jpg'] }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pages).toHaveLength(1);
  });

  it('rejects non-HTTP URLs', async () => {
    const req = new NextRequest('http://localhost/api/pages/upload-url', {
      method: 'POST',
      body: JSON.stringify({ urls: ['ftp://example.com/file'] }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-token',
      },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(body.errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Spustit test — ověřit FAIL**

Run: `cd apps/web && npx vitest run app/api/pages/__tests__/upload-url.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementovat endpoint**

```typescript
// apps/web/app/api/pages/upload-url/route.ts
import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'node:crypto';
import { prisma } from '@ai-sedlacek/db';
import { resolveUserFromToken } from '@/lib/infrastructure/api-auth';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';
import { getStorage } from '@/lib/adapters/storage';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp'];
const MAX_SIZE = (parseInt(process.env.MAX_FILE_SIZE_MB ?? '20', 10)) * 1024 * 1024;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Try API token first, then session
  let userId: string | null = await resolveUserFromToken(
    request.headers.get('authorization'),
  );
  if (!userId) {
    const auth = await getAuthenticatedUserId();
    if (auth.error) return auth.error;
    userId = auth.userId;
  }

  const { urls, collectionId } = (await request.json()) as {
    urls: string[];
    collectionId?: string;
  };

  if (!Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json(
      { error: 'Pole urls je povinné' },
      { status: 400 },
    );
  }

  const storage = getStorage();
  const pages: Array<{ id: string; filename: string; status: string }> = [];
  const errors: Array<{ url: string; error: string }> = [];

  for (const url of urls) {
    try {
      // Validate URL
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push({ url, error: 'Pouze HTTP/HTTPS URL jsou podporovány' });
        continue;
      }

      // Download
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        errors.push({ url, error: `Server vrátil ${res.status}` });
        continue;
      }

      // Validate content type
      const contentType = res.headers.get('content-type')?.split(';')[0]?.trim();
      if (!contentType || !ALLOWED_TYPES.includes(contentType)) {
        errors.push({ url, error: `Nepodporovaný typ: ${contentType}` });
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());

      // Validate size
      if (buffer.length > MAX_SIZE) {
        errors.push({ url, error: `Soubor je příliš velký (${Math.round(buffer.length / 1024 / 1024)} MB)` });
        continue;
      }

      // Hash for dedup
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const existing = await prisma.page.findFirst({
        where: { hash, userId },
      });
      if (existing) {
        errors.push({ url, error: `Duplikát (existuje jako stránka ${existing.id})` });
        continue;
      }

      // Extract filename from URL
      const filename = decodeURIComponent(
        parsed.pathname.split('/').pop() || 'image.jpg',
      );

      // Store
      const stored = await storage.upload(buffer, filename);

      // Get dimensions via sharp (dynamic import)
      const sharp = (await import('sharp')).default;
      const meta = await sharp(buffer).metadata();

      // Create page
      const page = await prisma.page.create({
        data: {
          userId,
          collectionId: collectionId ?? null,
          filename,
          hash,
          imageUrl: stored.url,
          status: 'pending',
          mimeType: contentType,
          fileSize: buffer.length,
          width: meta.width ?? null,
          height: meta.height ?? null,
        },
      });

      pages.push({ id: page.id, filename: page.filename, status: page.status });
    } catch (e: any) {
      errors.push({ url, error: e.message ?? 'Neznámá chyba' });
    }
  }

  return NextResponse.json({ pages, errors });
}
```

- [ ] **Step 4: Spustit test — ověřit PASS**

Run: `cd apps/web && npx vitest run app/api/pages/__tests__/upload-url.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/pages/upload-url/
git commit -m "feat(server): POST /api/pages/upload-url — stažení obrázků z URL"
```

---

## Task 10: Server — OCR result endpoint

**Files:**
- Create: `apps/web/app/api/pages/[id]/result/route.ts`

- [ ] **Step 1: Implementovat endpoint**

```typescript
// apps/web/app/api/pages/[id]/result/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@ai-sedlacek/db';
import { createVersion } from '@ai-sedlacek/db/versioning';
import { resolveUserFromToken } from '@/lib/infrastructure/api-auth';
import { getAuthenticatedUserId } from '@/lib/infrastructure/auth-utils';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { id } = await params;

  // Auth: API token or session
  let userId: string | null = await resolveUserFromToken(
    request.headers.get('authorization'),
  );
  if (!userId) {
    const auth = await getAuthenticatedUserId();
    if (auth.error) return auth.error;
    userId = auth.userId;
  }

  // Verify page ownership
  const page = await prisma.page.findUnique({ where: { id } });
  if (!page || page.userId !== userId) {
    return NextResponse.json({ error: 'Stránka nenalezena' }, { status: 404 });
  }

  if (page.status === 'done') {
    return NextResponse.json(
      { error: 'Stránka už byla zpracována' },
      { status: 409 },
    );
  }

  const body = await request.json();
  const {
    transcription,
    detectedLanguage,
    translation,
    translationLanguage,
    context,
    glossary,
    model,
    processingTimeMs,
  } = body;

  if (!transcription || !translation) {
    return NextResponse.json(
      { error: 'transcription a translation jsou povinné' },
      { status: 400 },
    );
  }

  // Create document
  const document = await prisma.document.create({
    data: {
      pageId: id,
      hash: page.hash,
      transcription,
      detectedLanguage: detectedLanguage ?? 'unknown',
      context: context ?? '',
      model: model ?? 'claude-cli',
      processingTimeMs: processingTimeMs ?? null,
    },
  });

  // Create translation
  await prisma.translation.create({
    data: {
      documentId: document.id,
      language: translationLanguage ?? 'cs',
      text: translation,
      context: context ?? '',
    },
  });

  // Create glossary entries
  if (Array.isArray(glossary) && glossary.length > 0) {
    await prisma.glossaryEntry.createMany({
      data: glossary.map((g: { term: string; definition: string }) => ({
        documentId: document.id,
        term: g.term,
        definition: g.definition,
      })),
    });
  }

  // Create initial versions
  await createVersion(document.id, 'transcription', transcription, 'ai_initial', model);
  await createVersion(document.id, `translation:${translationLanguage ?? 'cs'}`, translation, 'ai_initial', model);
  if (context) {
    await createVersion(document.id, 'context', context, 'ai_initial', model);
  }

  // Update page status
  await prisma.page.update({
    where: { id },
    data: { status: 'done' },
  });

  return NextResponse.json({
    documentId: document.id,
    status: 'done',
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx turbo typecheck --filter=@ai-sedlacek/web`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/pages/\[id\]/result/
git commit -m "feat(server): POST /api/pages/:id/result — přijetí OCR výsledků z CLI"
```

---

## Task 11: CLI příkaz — login

**Files:**
- Create: `apps/cli/src/commands/login.ts`

- [ ] **Step 1: Implementovat login**

```typescript
// apps/cli/src/commands/login.ts
import { Command } from 'commander';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import open from 'open';
import ora from 'ora';
import { loadConfig } from '../lib/config.js';
import { saveToken, getToken } from '../lib/auth.js';
import * as output from '../lib/output.js';

export const loginCommand = new Command('login')
  .description('Přihlásit se k serveru přes prohlížeč')
  .action(async () => {
    if (getToken()) {
      output.warn('Už jste přihlášen. Použijte `ais logout` pro odhlášení.');
      return;
    }

    const config = loadConfig();
    const state = crypto.randomBytes(16).toString('hex');

    // Start local HTTP server for callback
    const { port, tokenPromise, server } = await startCallbackServer(state);

    const authUrl = `${config.server}/auth/cli?state=${state}&redirect=${encodeURIComponent(`http://localhost:${port}/callback`)}`;

    const spinner = ora('Otevírám prohlížeč pro přihlášení...').start();

    try {
      await open(authUrl);
      spinner.text = 'Čekám na autorizaci v prohlížeči...';

      const token = await tokenPromise;
      saveToken(token);

      spinner.stop();
      output.success('Přihlášení úspěšné!');
    } catch (e: any) {
      spinner.stop();
      output.error(e.message ?? 'Přihlášení selhalo');
      process.exit(1);
    } finally {
      server.close();
    }
  });

function startCallbackServer(
  expectedState: string,
): Promise<{ port: number; tokenPromise: Promise<string>; server: http.Server }> {
  return new Promise((resolveSetup) => {
    let resolveToken: (token: string) => void;
    let rejectToken: (err: Error) => void;
    const tokenPromise = new Promise<string>((res, rej) => {
      resolveToken = res;
      rejectToken = rej;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const token = url.searchParams.get('token');
      const state = url.searchParams.get('state');

      if (state !== expectedState) {
        res.writeHead(400);
        res.end('Neplatný state parametr');
        rejectToken(new Error('State mismatch'));
        return;
      }

      if (!token) {
        res.writeHead(400);
        res.end('Token chybí');
        rejectToken(new Error('Token missing'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h1>Přihlášení úspěšné!</h1><p>Můžete zavřít tuto stránku.</p></body></html>');
      resolveToken(token);
    });

    server.listen(0, () => {
      const addr = server.address() as { port: number };
      resolveSetup({ port: addr.port, tokenPromise, server });
    });
  });
}
```

- [ ] **Step 2: Registrovat v index.ts**

Přidat do `apps/cli/src/index.ts`:

```typescript
import { Command } from 'commander';
import { loginCommand } from './commands/login.js';

export const program = new Command()
  .name('ais')
  .description('CLI klient pro čtečku starých textů')
  .version('0.0.0');

program.addCommand(loginCommand);
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/cli && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/commands/login.ts apps/cli/src/index.ts
git commit -m "feat(cli): login příkaz — OAuth browser flow"
```

---

## Task 12: CLI příkazy — logout, whoami

**Files:**
- Create: `apps/cli/src/commands/logout.ts`
- Create: `apps/cli/src/commands/whoami.ts`

- [ ] **Step 1: Implementovat logout**

```typescript
// apps/cli/src/commands/logout.ts
import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { getToken, deleteToken } from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import * as output from '../lib/output.js';

export const logoutCommand = new Command('logout')
  .description('Odhlásit se a revokovat token')
  .action(async () => {
    const token = getToken();
    if (!token) {
      output.warn('Nejste přihlášen.');
      return;
    }

    try {
      const config = loadConfig();
      const api = createApiClient(config.server, token);
      await api.delete('/api/auth/cli/token');
    } catch {
      // Token revocation failed, but still delete locally
    }

    deleteToken();
    output.success('Odhlášení úspěšné.');
  });
```

- [ ] **Step 2: Implementovat whoami**

```typescript
// apps/cli/src/commands/whoami.ts
import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import * as output from '../lib/output.js';

export const whoamiCommand = new Command('whoami')
  .description('Zobrazit přihlášeného uživatele')
  .action(async () => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    try {
      const user = await api.get('/api/auth/cli/me');
      console.log(`Email: ${user.email}`);
      if (user.name) console.log(`Jméno: ${user.name}`);
      console.log(`ID: ${user.id}`);
    } catch (e: any) {
      output.error(e.message);
      process.exit(1);
    }
  });
```

- [ ] **Step 3: Registrovat v index.ts**

```typescript
// apps/cli/src/index.ts
import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { whoamiCommand } from './commands/whoami.js';

export const program = new Command()
  .name('ais')
  .description('CLI klient pro čtečku starých textů')
  .version('0.0.0');

program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(whoamiCommand);
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/cli && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/logout.ts apps/cli/src/commands/whoami.ts apps/cli/src/index.ts
git commit -m "feat(cli): logout a whoami příkazy"
```

---

## Task 13: CLI příkaz — upload

**Files:**
- Create: `apps/cli/src/commands/upload.ts`

- [ ] **Step 1: Implementovat upload**

```typescript
// apps/cli/src/commands/upload.ts
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ora from 'ora';
import { loadConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import * as output from '../lib/output.js';

export const uploadCommand = new Command('upload')
  .description('Nahrát obrázky (URL nebo lokální soubory)')
  .argument('<sources...>', 'URL adresy, lokální soubory, nebo .txt soubor se seznamem URL')
  .option('-c, --collection <id>', 'ID kolekce')
  .action(async (sources: string[], options: { collection?: string }) => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    // Expand sources: .txt files contain one URL per line
    const expanded = expandSources(sources);

    // Separate URLs from local files
    const urls: string[] = [];
    const localFiles: string[] = [];

    for (const src of expanded) {
      if (src.startsWith('http://') || src.startsWith('https://')) {
        urls.push(src);
      } else if (fs.existsSync(src)) {
        localFiles.push(src);
      } else {
        output.warn(`Přeskakuji: ${src} (soubor nenalezen)`);
      }
    }

    const spinner = ora('Nahrávám...').start();
    let totalPages = 0;
    let totalErrors = 0;

    // Upload URLs
    if (urls.length > 0) {
      spinner.text = `Nahrávám ${urls.length} URL...`;
      try {
        const result = await api.postJson('/api/pages/upload-url', {
          urls,
          collectionId: options.collection,
        });
        totalPages += result.pages.length;
        totalErrors += result.errors.length;

        for (const page of result.pages) {
          output.success(`  ${page.filename} → stránka ${page.id}`);
        }
        for (const err of result.errors) {
          output.error(`  ${err.url}: ${err.error}`);
        }
      } catch (e: any) {
        spinner.stop();
        output.error(e.message);
        process.exit(1);
      }
    }

    // Upload local files
    for (const filePath of localFiles) {
      spinner.text = `Nahrávám ${path.basename(filePath)}...`;
      try {
        const formData = new FormData();
        const buffer = fs.readFileSync(filePath);
        const blob = new Blob([buffer]);
        formData.append('files', blob, path.basename(filePath));
        if (options.collection) {
          formData.append('collectionId', options.collection);
        }

        const result = await api.postFormData('/api/pages/upload', formData);
        totalPages += result.pages.length;

        for (const page of result.pages) {
          output.success(`  ${page.filename} → stránka ${page.id}`);
        }
        if (result.errors) {
          totalErrors += result.errors.length;
          for (const err of result.errors) {
            output.error(`  ${err.filename}: ${err.error}`);
          }
        }
      } catch (e: any) {
        output.error(`  ${filePath}: ${e.message}`);
        totalErrors++;
      }
    }

    spinner.stop();
    output.info(`Nahráno: ${totalPages} stránek, ${totalErrors} chyb`);
  });

function expandSources(sources: string[]): string[] {
  const result: string[] = [];
  for (const src of sources) {
    if (src.endsWith('.txt') && fs.existsSync(src)) {
      const lines = fs.readFileSync(src, 'utf-8').split('\n').map((l) => l.trim()).filter(Boolean);
      result.push(...lines);
    } else {
      result.push(src);
    }
  }
  return result;
}
```

- [ ] **Step 2: Registrovat v index.ts**

Přidat `import { uploadCommand } from './commands/upload.js';` a `program.addCommand(uploadCommand);`

- [ ] **Step 3: Typecheck**

Run: `cd apps/cli && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/commands/upload.ts apps/cli/src/index.ts
git commit -m "feat(cli): upload příkaz — URL i lokální soubory"
```

---

## Task 14: CLI příkaz — process (lokální OCR)

**Files:**
- Create: `apps/cli/src/commands/process.ts`

- [ ] **Step 1: Implementovat process**

```typescript
// apps/cli/src/commands/process.ts
import { Command } from 'commander';
import ora from 'ora';
import { processWithClaudeCli } from '@ai-sedlacek/ocr';
import { prepareImage } from '@ai-sedlacek/ocr';
import { loadConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { createApiClient, type ApiClient } from '../lib/api-client.js';
import * as output from '../lib/output.js';

export const processCommand = new Command('process')
  .description('Zpracovat stránky lokálním OCR (claude CLI)')
  .argument('[pageIds...]', 'ID stránek ke zpracování')
  .option('-c, --collection <id>', 'Zpracovat celou kolekci')
  .option('-a, --all', 'Zpracovat všechny pending stránky')
  .option('-l, --language <lang>', 'Cílový jazyk překladu', 'cs')
  .action(async (pageIds: string[], options) => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    // Resolve page IDs
    let ids = pageIds;
    if (options.collection) {
      const collection = await api.get(`/api/collections/${options.collection}`);
      ids = collection.pages
        .filter((p: any) => p.status === 'pending')
        .map((p: any) => p.id);
    } else if (options.all) {
      const pages = await api.get('/api/pages?status=pending');
      ids = (pages.pages ?? pages).map((p: any) => p.id);
    }

    if (ids.length === 0) {
      output.warn('Žádné stránky ke zpracování.');
      return;
    }

    output.info(`Zpracovávám ${ids.length} stránek...`);

    for (let i = 0; i < ids.length; i++) {
      const pageId = ids[i];
      const spinner = ora(`[${i + 1}/${ids.length}] Stránka ${pageId}...`).start();

      try {
        // Get page info
        const page = await api.get(`/api/pages/${pageId}`);
        if (page.status === 'done') {
          spinner.succeed(`[${i + 1}/${ids.length}] Stránka ${pageId} — již zpracována`);
          continue;
        }

        // Download image
        spinner.text = `[${i + 1}/${ids.length}] Stahuji obrázek...`;
        const imageRes = await api.getRaw(`/api/images/${page.imageUrl.replace(/^\/uploads\//, '')}`);
        if (!imageRes.ok) throw new Error('Nelze stáhnout obrázek');
        const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

        // Prepare image (resize if needed)
        spinner.text = `[${i + 1}/${ids.length}] Zpracovávám přes Claude CLI...`;
        const { buffer: prepared } = await prepareImage(imageBuffer);

        // Run local OCR
        const { result, processingTimeMs, model } = await processWithClaudeCli(
          prepared,
          'Přepiš text z tohoto rukopisu.',
          undefined,
          undefined,
          undefined,
          'transcribe+translate',
          options.language,
        );

        // Upload results to server
        spinner.text = `[${i + 1}/${ids.length}] Odesílám výsledky...`;
        await api.postJson(`/api/pages/${pageId}/result`, {
          ...result,
          model,
          processingTimeMs,
        });

        spinner.succeed(
          `[${i + 1}/${ids.length}] ${page.filename} — hotovo (${result.detectedLanguage} → ${result.translationLanguage})`,
        );
      } catch (e: any) {
        spinner.fail(`[${i + 1}/${ids.length}] Stránka ${pageId} — ${e.message}`);
      }
    }

    output.info('Zpracování dokončeno.');
  });
```

- [ ] **Step 2: Registrovat v index.ts**

Přidat `import { processCommand } from './commands/process.js';` a `program.addCommand(processCommand);`

- [ ] **Step 3: Typecheck**

Run: `cd apps/cli && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/commands/process.ts apps/cli/src/index.ts
git commit -m "feat(cli): process příkaz — lokální OCR přes claude CLI"
```

---

## Task 15: CLI příkazy — list, show

**Files:**
- Create: `apps/cli/src/commands/list.ts`
- Create: `apps/cli/src/commands/show.ts`

- [ ] **Step 1: Implementovat list**

```typescript
// apps/cli/src/commands/list.ts
import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import * as output from '../lib/output.js';

export const listCommand = new Command('list')
  .description('Zobrazit seznam stránek')
  .option('-c, --collection <id>', 'Filtrovat podle kolekce')
  .action(async (options) => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    try {
      let url = '/api/pages';
      if (options.collection) url += `?collectionId=${options.collection}`;
      const data = await api.get(url);
      const pages = data.pages ?? data;

      if (pages.length === 0) {
        output.info('Žádné stránky.');
        return;
      }

      output.table(
        ['ID', 'Soubor', 'Status', 'Kolekce', 'Vytvořeno'],
        pages.map((p: any) => [
          p.id.slice(0, 8),
          p.displayName ?? p.filename,
          output.statusBadge(p.status),
          p.collection?.name ?? '—',
          new Date(p.createdAt).toLocaleDateString('cs'),
        ]),
      );
    } catch (e: any) {
      output.error(e.message);
      process.exit(1);
    }
  });
```

- [ ] **Step 2: Implementovat show**

```typescript
// apps/cli/src/commands/show.ts
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import * as output from '../lib/output.js';

export const showCommand = new Command('show')
  .description('Zobrazit detail stránky')
  .argument('<pageId>', 'ID stránky')
  .action(async (pageId: string) => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    try {
      const page = await api.get(`/api/pages/${pageId}`);

      console.log(chalk.bold(`\n=== ${page.displayName ?? page.filename} ===`));
      console.log(`Status: ${output.statusBadge(page.status)}`);
      console.log(`ID: ${page.id}`);
      if (page.collection) console.log(`Kolekce: ${page.collection.name}`);
      console.log();

      if (!page.document) {
        output.warn('Stránka ještě nebyla zpracována.');
        return;
      }

      const doc = page.document;

      console.log(chalk.bold.underline('Transkripce'));
      console.log(`(${doc.detectedLanguage})\n`);
      console.log(doc.transcription);
      console.log();

      if (doc.translations?.length > 0) {
        for (const t of doc.translations) {
          console.log(chalk.bold.underline(`Překlad (${t.language})`));
          console.log(t.text);
          console.log();
        }
      }

      if (doc.context) {
        console.log(chalk.bold.underline('Kontext'));
        console.log(doc.context);
        console.log();
      }

      if (doc.glossary?.length > 0) {
        console.log(chalk.bold.underline('Glosář'));
        for (const g of doc.glossary) {
          console.log(`  ${chalk.bold(g.term)}: ${g.definition}`);
        }
        console.log();
      }
    } catch (e: any) {
      output.error(e.message);
      process.exit(1);
    }
  });
```

- [ ] **Step 3: Registrovat v index.ts**

Přidat oba importy a `program.addCommand(listCommand);`, `program.addCommand(showCommand);`

- [ ] **Step 4: Typecheck**

Run: `cd apps/cli && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/cli/src/commands/list.ts apps/cli/src/commands/show.ts apps/cli/src/index.ts
git commit -m "feat(cli): list a show příkazy"
```

---

## Task 16: CLI příkazy — pull, push, diff

**Files:**
- Create: `apps/cli/src/commands/pull.ts`
- Create: `apps/cli/src/commands/push.ts`
- Create: `apps/cli/src/commands/diff.ts`

- [ ] **Step 1: Implementovat pull**

```typescript
// apps/cli/src/commands/pull.ts
import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import { writePageFiles } from '../lib/workspace.js';
import * as output from '../lib/output.js';

export const pullCommand = new Command('pull')
  .description('Stáhnout dokumenty do lokálního workspace')
  .argument('[pageIds...]', 'ID stránek')
  .option('-c, --collection <id>', 'Stáhnout celou kolekci')
  .action(async (pageIds: string[], options) => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    // Resolve page IDs
    let ids = pageIds;
    if (options.collection) {
      const collection = await api.get(`/api/collections/${options.collection}`);
      ids = collection.pages.filter((p: any) => p.status === 'done').map((p: any) => p.id);
    }

    if (ids.length === 0) {
      output.warn('Žádné stránky ke stažení.');
      return;
    }

    const spinner = ora('Stahuji...').start();

    for (let i = 0; i < ids.length; i++) {
      const pageId = ids[i];
      spinner.text = `[${i + 1}/${ids.length}] ${pageId}`;

      try {
        const page = await api.get(`/api/pages/${pageId}`);
        if (!page.document) {
          output.warn(`  ${pageId}: není zpracována, přeskakuji`);
          continue;
        }

        const doc = page.document;
        const translation = doc.translations?.[0];

        const glossaryText = (doc.glossary ?? [])
          .map((g: any) => `**${g.term}**: ${g.definition}`)
          .join('\n');

        writePageFiles({
          pageId,
          documentId: doc.id,
          transcription: doc.transcription ?? '',
          translation: translation?.text ?? '',
          context: doc.context ?? '',
          glossary: glossaryText,
        });

        output.success(`  ${page.displayName ?? page.filename} → .ais-workspace/${pageId}/`);
      } catch (e: any) {
        output.error(`  ${pageId}: ${e.message}`);
      }
    }

    spinner.stop();
    output.info('Pull dokončen.');
  });
```

- [ ] **Step 2: Implementovat push**

```typescript
// apps/cli/src/commands/push.ts
import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import {
  listWorkspacePages,
  getChangedFiles,
  readPageFiles,
  readMeta,
  writePageFiles,
} from '../lib/workspace.js';
import * as output from '../lib/output.js';

export const pushCommand = new Command('push')
  .description('Odeslat lokální změny na server')
  .argument('[pageIds...]', 'ID stránek (výchozí: všechny změněné)')
  .option('-f, --force', 'Přepsat i při konfliktu')
  .action(async (pageIds: string[], options) => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    const ids = pageIds.length > 0 ? pageIds : listWorkspacePages();

    if (ids.length === 0) {
      output.info('Žádné stránky ve workspace.');
      return;
    }

    let pushed = 0;
    const spinner = ora('Odesílám změny...').start();

    for (const pageId of ids) {
      const changed = getChangedFiles(pageId);
      if (changed.length === 0) continue;

      const meta = readMeta(pageId);
      if (!meta) continue;

      const files = readPageFiles(pageId);
      if (!files) continue;

      spinner.text = `Odesílám ${pageId} (${changed.length} změn)...`;

      try {
        // Build patch payload
        const patch: Record<string, string> = {};
        for (const c of changed) {
          if (c.file === 'transcription.md') patch.transcription = files['transcription.md'];
          if (c.file === 'translation.md') patch.translation = files['translation.md'];
          if (c.file === 'context.md') patch.context = files['context.md'];
        }

        if (Object.keys(patch).length > 0) {
          await api.patchJson(`/api/documents/${meta.documentId}`, patch);
        }

        // Re-pull to update meta hashes
        const page = await api.get(`/api/pages/${pageId}`);
        const doc = page.document;
        const translation = doc.translations?.[0];
        const glossaryText = (doc.glossary ?? [])
          .map((g: any) => `**${g.term}**: ${g.definition}`)
          .join('\n');

        writePageFiles({
          pageId,
          documentId: doc.id,
          transcription: doc.transcription ?? '',
          translation: translation?.text ?? '',
          context: doc.context ?? '',
          glossary: glossaryText,
        });

        output.success(`  ${pageId}: ${changed.map((c) => c.file).join(', ')}`);
        pushed++;
      } catch (e: any) {
        output.error(`  ${pageId}: ${e.message}`);
      }
    }

    spinner.stop();
    output.info(`Push dokončen: ${pushed} stránek aktualizováno.`);
  });
```

- [ ] **Step 3: Implementovat diff**

```typescript
// apps/cli/src/commands/diff.ts
import { Command } from 'commander';
import chalk from 'chalk';
import { listWorkspacePages, getChangedFiles } from '../lib/workspace.js';
import * as output from '../lib/output.js';

export const diffCommand = new Command('diff')
  .description('Zobrazit lokální změny oproti serveru')
  .argument('[pageIds...]', 'ID stránek (výchozí: všechny)')
  .action(async (pageIds: string[]) => {
    const ids = pageIds.length > 0 ? pageIds : listWorkspacePages();

    if (ids.length === 0) {
      output.info('Žádné stránky ve workspace.');
      return;
    }

    let totalChanged = 0;

    for (const pageId of ids) {
      const changed = getChangedFiles(pageId);
      if (changed.length === 0) continue;

      console.log(chalk.bold(`\nStránka ${pageId}:`));
      for (const c of changed) {
        console.log(`  ${chalk.yellow('M')} ${c.file}`);
      }
      totalChanged += changed.length;
    }

    if (totalChanged === 0) {
      output.info('Žádné lokální změny.');
    } else {
      output.info(`\nCelkem: ${totalChanged} změněných souborů.`);
    }
  });
```

- [ ] **Step 4: Registrovat v index.ts**

Přidat importy a `addCommand` pro pull, push, diff.

- [ ] **Step 5: Typecheck**

Run: `cd apps/cli && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/commands/pull.ts apps/cli/src/commands/push.ts apps/cli/src/commands/diff.ts apps/cli/src/index.ts
git commit -m "feat(cli): pull, push, diff příkazy — lokální editace workflow"
```

---

## Task 17: CLI příkaz — collections

**Files:**
- Create: `apps/cli/src/commands/collections.ts`

- [ ] **Step 1: Implementovat collections**

```typescript
// apps/cli/src/commands/collections.ts
import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import * as output from '../lib/output.js';

export const collectionsCommand = new Command('collections')
  .description('Správa kolekcí')
  .action(async () => {
    // Default: list collections
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    try {
      const data = await api.get('/api/collections');
      const collections = data.collections ?? data;

      if (collections.length === 0) {
        output.info('Žádné kolekce.');
        return;
      }

      output.table(
        ['ID', 'Název', 'Stránek', 'Vytvořeno'],
        collections.map((c: any) => [
          c.id.slice(0, 8),
          c.name,
          String(c._count?.pages ?? c.pages?.length ?? 0),
          new Date(c.createdAt).toLocaleDateString('cs'),
        ]),
      );
    } catch (e: any) {
      output.error(e.message);
      process.exit(1);
    }
  });

collectionsCommand
  .command('create')
  .description('Vytvořit novou kolekci')
  .argument('<name>', 'Název kolekce')
  .option('-d, --description <text>', 'Popis kolekce')
  .action(async (name: string, options: { description?: string }) => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    try {
      const collection = await api.postJson('/api/collections', {
        name,
        description: options.description,
      });
      output.success(`Kolekce vytvořena: ${collection.id} — ${collection.name}`);
    } catch (e: any) {
      output.error(e.message);
      process.exit(1);
    }
  });

collectionsCommand
  .command('delete')
  .description('Smazat kolekci')
  .argument('<id>', 'ID kolekce')
  .action(async (id: string) => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    try {
      await api.delete(`/api/collections/${id}`);
      output.success(`Kolekce ${id} smazána.`);
    } catch (e: any) {
      output.error(e.message);
      process.exit(1);
    }
  });
```

- [ ] **Step 2: Registrovat v index.ts**

Přidat import a `program.addCommand(collectionsCommand);`

- [ ] **Step 3: Typecheck**

Run: `cd apps/cli && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/commands/collections.ts apps/cli/src/index.ts
git commit -m "feat(cli): collections příkaz — list, create, delete"
```

---

## Task 18: Finální index.ts, .gitignore, build test

**Files:**
- Modify: `apps/cli/src/index.ts` (final version with all commands)
- Modify: `.gitignore`

- [ ] **Step 1: Finální `index.ts`**

```typescript
// apps/cli/src/index.ts
import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { whoamiCommand } from './commands/whoami.js';
import { uploadCommand } from './commands/upload.js';
import { processCommand } from './commands/process.js';
import { listCommand } from './commands/list.js';
import { showCommand } from './commands/show.js';
import { pullCommand } from './commands/pull.js';
import { pushCommand } from './commands/push.js';
import { diffCommand } from './commands/diff.js';
import { collectionsCommand } from './commands/collections.js';

export const program = new Command()
  .name('ais')
  .description('CLI klient pro čtečku starých textů')
  .version('0.0.0');

program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(whoamiCommand);
program.addCommand(uploadCommand);
program.addCommand(processCommand);
program.addCommand(listCommand);
program.addCommand(showCommand);
program.addCommand(pullCommand);
program.addCommand(pushCommand);
program.addCommand(diffCommand);
program.addCommand(collectionsCommand);
```

- [ ] **Step 2: Přidat `.ais-workspace/` do `.gitignore`**

Přidat na konec root `.gitignore`:

```
# CLI workspace
.ais-workspace/
```

- [ ] **Step 3: Full build**

Run: `npx turbo build`
Expected: ALL PASS, including `apps/cli`

- [ ] **Step 4: Ověřit CLI funguje**

Run: `node apps/cli/dist/bin.js --help`
Expected: Výpis všech příkazů

- [ ] **Step 5: Full validation**

Run: `npx turbo typecheck && npx turbo lint && npx turbo format:check && npx turbo test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add apps/cli/src/index.ts .gitignore
git commit -m "feat(cli): finální registrace všech příkazů, .gitignore update"
```

---

## Task 19: npm link pro lokální testování

- [ ] **Step 1: Nastavit npm link**

Run: `cd apps/cli && npm link`
Expected: `ais` command dostupný globálně

- [ ] **Step 2: Ověřit**

Run: `ais --help`
Expected: Výpis příkazů

Run: `ais --version`
Expected: `0.0.0`

- [ ] **Step 3: Commit** (pokud byly potřeba úpravy)

```bash
git add -A
git commit -m "feat(cli): CLI klient připraven k testování"
```
