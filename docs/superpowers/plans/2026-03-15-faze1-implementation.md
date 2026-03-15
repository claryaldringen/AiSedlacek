# Fáze 1 – Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plně funkční OCR pipeline pro středověké texty – dev režim s Ollama, připravené pro produkci s Claude API.

**Architecture:** Turborepo monorepo (apps/web + packages/shared). Clean Architecture: domain rozhraní v shared, adaptéry v web. DI kontejner přepíná mezi Ollama (dev) a Claude (produkce) sadou adapterů na základě env proměnných.

**Tech Stack:** Next.js 15 (App Router), TypeScript (strict), Tailwind CSS, Turborepo, Vitest, Sharp, Ollama REST API, Tesseract.js

**Spec:** `docs/superpowers/specs/2026-03-15-faze1-design.md`

---

## File Structure Map

### packages/shared/

| File | Responsibility |
|---|---|
| `package.json` | Shared package config |
| `tsconfig.json` | Strict TS config for shared |
| `src/domain/ocr-engine.ts` | `IOcrEngine` interface |
| `src/domain/translator.ts` | `ITranslator` interface |
| `src/domain/preprocessor.ts` | `IPreprocessor` interface |
| `src/domain/classifier.ts` | `ILayoutClassifier` interface |
| `src/domain/storage.ts` | `IStorageProvider` interface |
| `src/types.ts` | All shared types (OcrEngineResult, ProcessingResult, etc.) |
| `src/prompts.ts` | All LLM prompt templates |
| `src/index.ts` | Barrel export |

### apps/web/

| File | Responsibility |
|---|---|
| `package.json` | Web app dependencies |
| `tsconfig.json` | TS config extending shared |
| `next.config.ts` | Next.js config (Sharp, external packages) |
| ~~`tailwind.config.ts`~~ | Tailwind v4 – CSS-based config, není potřeba |
| `.env.local` | Local env variables |
| `app/layout.tsx` | Root layout with Tailwind |
| `app/page.tsx` | Main page – upload + results |
| `app/api/process/route.ts` | Pipeline orchestration endpoint |
| `app/api/process/[id]/tesseract-result/route.ts` | Receive Tesseract result from client |
| `app/api/process/[id]/status/route.ts` | SSE progress stream |
| `app/api/upload/route.ts` | File upload handler |
| `lib/adapters/ocr/ollama-vision.ts` | `OllamaVisionOcrEngine` |
| `lib/adapters/ocr/claude-vision.ts` | `ClaudeVisionOcrEngine` |
| `lib/adapters/ocr/transkribus.ts` | `TranskribusOcrEngine` |
| `lib/adapters/ocr/tesseract.ts` | `TesseractOcrEngine` (server-side wrapper) |
| `lib/adapters/llm/ollama-translator.ts` | `OllamaTranslator` |
| `lib/adapters/llm/ollama-classifier.ts` | `OllamaLayoutClassifier` |
| `lib/adapters/llm/claude-translator.ts` | `ClaudeTranslator` |
| `lib/adapters/llm/claude-classifier.ts` | `ClaudeLayoutClassifier` |
| `lib/adapters/preprocessing/sharp.ts` | `SharpPreprocessor` |
| `lib/adapters/storage/local-storage.ts` | `LocalStorageProvider` |
| `lib/adapters/storage/vercel-blob.ts` | `VercelBlobStorageProvider` |
| `lib/use-cases/process-document.ts` | Main pipeline use case |
| `lib/use-cases/ensemble.ts` | `EnsembleOrchestrator` |
| `lib/infrastructure/container.ts` | DI composition root |
| `lib/client/tesseract-worker.ts` | Web Worker for Tesseract.js |
| `components/FileUpload.tsx` | Drag & drop upload |
| `components/ProcessingStatus.tsx` | Real-time progress |
| `components/ResultViewer.tsx` | 4-column result display |
| `components/TextColumn.tsx` | Single text column |
| `components/ConfidenceHighlight.tsx` | Highlight uncertain text |
| `components/TierSelector.tsx` | Tier selection UI |

### Root

| File | Responsibility |
|---|---|
| `package.json` | Workspace root |
| `turbo.json` | Turborepo pipeline config |
| `tsconfig.base.json` | Base TS config |
| `.gitignore` | Git ignore rules |
| `.prettierrc` | Prettier config |
| `eslint.config.mjs` | ESLint v9 flat config with Clean Architecture rules |

### Tests (co-located)

| File | Tests for |
|---|---|
| `packages/shared/src/__tests__/types.test.ts` | Type guards and validators |
| `apps/web/lib/adapters/ocr/__tests__/ollama-vision.test.ts` | OllamaVisionOcrEngine |
| `apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts` | ClaudeVisionOcrEngine |
| `apps/web/lib/adapters/ocr/__tests__/transkribus.test.ts` | TranskribusOcrEngine |
| `apps/web/lib/adapters/llm/__tests__/ollama-translator.test.ts` | OllamaTranslator |
| `apps/web/lib/adapters/llm/__tests__/ollama-classifier.test.ts` | OllamaLayoutClassifier |
| `apps/web/lib/adapters/llm/__tests__/claude-translator.test.ts` | ClaudeTranslator |
| `apps/web/lib/adapters/llm/__tests__/claude-classifier.test.ts` | ClaudeLayoutClassifier |
| `apps/web/lib/adapters/preprocessing/__tests__/sharp.test.ts` | SharpPreprocessor |
| `apps/web/lib/adapters/storage/__tests__/local-storage.test.ts` | LocalStorageProvider |
| `apps/web/lib/use-cases/__tests__/ensemble.test.ts` | EnsembleOrchestrator |
| `apps/web/lib/use-cases/__tests__/process-document.test.ts` | ProcessDocument |
| `apps/web/lib/infrastructure/__tests__/container.test.ts` | DI container |

---

## Chunk 1: Scaffolding

### Task 1: Initialize Turborepo monorepo

**Files:**
- Create: `package.json`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.prettierrc`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`

- [ ] **Step 1: Create root package.json with workspaces**

```json
{
  "name": "ai-sedlacek",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "lint": "turbo lint",
    "format:check": "turbo format:check",
    "format": "turbo format",
    "typecheck": "turbo typecheck",
    "test": "turbo test"
  },
  "devDependencies": {
    "turbo": "^2"
  },
  "packageManager": "npm@11.6.2"
}
```

- [ ] **Step 2: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "format:check": {},
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 3: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
.next/
dist/
.turbo/
.env.local
tmp/
*.tsbuildinfo
```

- [ ] **Step 5: Create .prettierrc**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 6: Create packages/shared/package.json**

```json
{
  "name": "@ai-sedlacek/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "format:check": "prettier --check src/",
    "format": "prettier --write src/",
    "test": "vitest run"
  },
  "devDependencies": {
    "eslint": "^9",
    "typescript-eslint": "^8",
    "prettier": "^3",
    "typescript": "^5",
    "vitest": "^3"
  }
}
```

- [ ] **Step 7: Create packages/shared/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 8: Create apps/web/package.json**

```json
{
  "name": "@ai-sedlacek/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "eslint app/ lib/ components/",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,mjs,json,css}\" --ignore-path ../../.gitignore",
    "format": "prettier --write \"**/*.{ts,tsx,js,mjs,json,css}\" --ignore-path ../../.gitignore",
    "test": "vitest run"
  },
  "dependencies": {
    "@ai-sedlacek/shared": "*",
    "next": "^15",
    "react": "^19",
    "react-dom": "^19",
    "sharp": "^0.33"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "typescript-eslint": "^8",
    "prettier": "^3",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vitest": "^3"
  }
}
```

- [ ] **Step 9: Create apps/web/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowJs": true,
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"],
      "@ai-sedlacek/shared": ["../../packages/shared/src"],
      "@ai-sedlacek/shared/*": ["../../packages/shared/src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 10: Run npm install**

Run: `npm install`
Expected: Successful installation, node_modules created in root

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: inicializuj Turborepo monorepo s packages/shared a apps/web"
```

---

### Task 2: Setup Next.js app shell with Tailwind

**Files:**
- Create: `apps/web/next.config.ts`
- Create: `apps/web/app/globals.css`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/postcss.config.mjs`

- [ ] **Step 1: Create next.config.ts**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@ai-sedlacek/shared'],
  serverExternalPackages: ['sharp'],
};

export default nextConfig;
```

- [ ] **Step 2: Create postcss.config.mjs**

```javascript
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
```

- [ ] **Step 3: Create app/globals.css**

Tailwind v4 uses CSS-based config. No `tailwind.config.ts` needed.

```css
@import 'tailwindcss';
```

- [ ] **Step 4: Create app/layout.tsx**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Čtečka starých textů',
  description: 'OCR a překlad středověkých dokumentů',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <html lang="cs">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <header className="border-b border-stone-200 bg-white px-6 py-4">
          <h1 className="text-xl font-semibold">Čtečka starých textů</h1>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Create app/page.tsx**

```tsx
export default function HomePage(): React.JSX.Element {
  return (
    <div className="text-center">
      <p className="text-stone-600">Nahrajte obrázek středověkého dokumentu pro OCR a překlad.</p>
    </div>
  );
}
```

- [ ] **Step 6: Verify dev server starts**

Run: `cd apps/web && npx next dev --port 3000`
Expected: Server starts on http://localhost:3000, page renders with header and text.
Stop the server after verification.

- [ ] **Step 7: Commit**

```bash
git add apps/web/next.config.ts apps/web/postcss.config.mjs apps/web/app/
git commit -m "feat: přidej Next.js app shell s Tailwind CSS v4"
```

---

### Task 3: Create shared domain interfaces and types

**Files:**
- Create: `packages/shared/src/domain/ocr-engine.ts`
- Create: `packages/shared/src/domain/translator.ts`
- Create: `packages/shared/src/domain/preprocessor.ts`
- Create: `packages/shared/src/domain/classifier.ts`
- Create: `packages/shared/src/domain/storage.ts`
- Create: `packages/shared/src/types.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Create types.ts with all shared types**

```typescript
// packages/shared/src/types.ts

export type OcrTier = 'tier1' | 'tier2';

export type OcrEngineName =
  | 'transkribus'
  | 'tesseract'
  | 'kraken'
  | 'claude_vision'
  | 'ollama_vision';

export type OcrEngineRole = 'recognizer' | 'segmenter';

export interface DocumentClassification {
  tier: OcrTier;
  scriptType: 'print' | 'manuscript';
  layoutComplexity: 'simple' | 'complex';
  detectedFeatures: string[];
  confidence: number;
  reasoning: string;
}

export interface OcrEngineResult {
  engine: OcrEngineName;
  role: OcrEngineRole;
  text: string;
  lines?: SegmentedLine[];
  confidence?: number;
  uncertainMarkers?: string[];
  processingTimeMs: number;
  costUsd?: number;
}

export interface SegmentedLine {
  id: string;
  baseline: [number, number][];
  boundingBox: BoundingBox;
  imageSlice: Buffer;
  text?: string;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConsolidationResult {
  consolidatedText: string;
  literalTranslation: string;
  notes: string[];
}

export interface ProcessingResult {
  id: string;
  originalImage: string;
  classification: DocumentClassification;
  ocrResults: OcrEngineResult[];
  consolidatedText: string;
  literalTranslation: string;
  polishedTranslation: string;
  detectedLanguage: string;
  confidenceNotes: string[];
}

export interface TranskribusConfig {
  modelId: string;
  lineDetection: boolean;
}

export interface KrakenConfig {
  segmentationModel: string;
  recognitionModel?: string;
  baseUrl: string;
  device: 'cpu' | 'cuda';
}

export interface OllamaConfig {
  baseUrl: string;
  visionModel: string;
  textModel: string;
  timeoutMs: number;
}

export interface OcrOptions {
  language?: string;
  tier?: OcrTier;
}

export interface StorageResult {
  url: string;
  path: string;
}
```

- [ ] **Step 2: Create domain/ocr-engine.ts**

```typescript
// packages/shared/src/domain/ocr-engine.ts

import type { OcrEngineResult, OcrEngineRole, OcrOptions } from '../types.js';

export interface IOcrEngine {
  readonly name: string;
  readonly role: OcrEngineRole;
  isAvailable(): Promise<boolean>;
  recognize(image: Buffer, options?: OcrOptions): Promise<OcrEngineResult>;
}
```

- [ ] **Step 3: Create domain/translator.ts**

```typescript
// packages/shared/src/domain/translator.ts

import type { ConsolidationResult, OcrEngineResult } from '../types.js';

export interface ITranslator {
  consolidateAndTranslate(
    image: Buffer,
    ocrResults: OcrEngineResult[],
    targetLanguage: string,
  ): Promise<ConsolidationResult>;
  polish(literalTranslation: string, targetLanguage: string): Promise<string>;
}
```

- [ ] **Step 4: Create domain/preprocessor.ts**

```typescript
// packages/shared/src/domain/preprocessor.ts

export interface IPreprocessor {
  process(image: Buffer): Promise<Buffer>;
}
```

- [ ] **Step 5: Create domain/classifier.ts**

```typescript
// packages/shared/src/domain/classifier.ts

import type { DocumentClassification } from '../types.js';

export interface ILayoutClassifier {
  classify(image: Buffer): Promise<DocumentClassification>;
}
```

- [ ] **Step 6: Create domain/storage.ts**

```typescript
// packages/shared/src/domain/storage.ts

import type { StorageResult } from '../types.js';

export interface IStorageProvider {
  upload(file: Buffer, filename: string): Promise<StorageResult>;
  getUrl(path: string): string;
  delete(path: string): Promise<void>;
}
```

- [ ] **Step 7: Create index.ts barrel export**

```typescript
// packages/shared/src/index.ts

export type {
  OcrTier,
  OcrEngineName,
  OcrEngineRole,
  DocumentClassification,
  OcrEngineResult,
  SegmentedLine,
  BoundingBox,
  ConsolidationResult,
  ProcessingResult,
  TranskribusConfig,
  KrakenConfig,
  OllamaConfig,
  OcrOptions,
  StorageResult,
} from './types.js';

export type { IOcrEngine } from './domain/ocr-engine.js';
export type { ITranslator } from './domain/translator.js';
export type { IPreprocessor } from './domain/preprocessor.js';
export type { ILayoutClassifier } from './domain/classifier.js';
export type { IStorageProvider } from './domain/storage.js';
```

- [ ] **Step 8: Verify typecheck passes**

Run: `npx turbo typecheck`
Expected: All packages pass typecheck

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/
git commit -m "feat: přidej domain rozhraní a sdílené typy"
```

---

### Task 4: Create shared prompts

**Files:**
- Create: `packages/shared/src/prompts.ts`

- [ ] **Step 1: Create prompts.ts with all LLM prompt templates**

Content from `docs/prompts.md` – all 4 prompts as exported constants:

```typescript
// packages/shared/src/prompts.ts

export const CLASSIFY_LAYOUT_PROMPT = `Analyzuj tento obrázek středověkého dokumentu a klasifikuj ho.

Odpověz POUZE v tomto JSON formátu:
{
  "tier": "tier1" nebo "tier2",
  "scriptType": "print" nebo "manuscript",
  "layoutComplexity": "simple" nebo "complex",
  "detectedFeatures": ["seznam detekovaných rysů"],
  "confidence": 0.0-1.0,
  "reasoning": "stručné zdůvodnění v češtině"
}

Pravidla pro výběr tieru:
- tier1: tištěný text, jednosloupcový layout, čistý rukopis bez gloss
- tier2: marginální glosy, interlineární poznámky, více textových sloupců, zakřivené/šikmé řádky, dekorativní iniciály zasahující do textu, směs různých písem, poškozený/fragmentární dokument

Detekované rysy mohou zahrnovat:
- "fraktur", "bastarda", "kurziva", "karolínská_minuskule"
- "marginální_glosy", "interlineární_poznámky"
- "jednosloupcový", "vícesloupcový"
- "dekorativní_iniciály", "rubriky"
- "poškozený", "vybledlý", "fragmentární"`;

export const OCR_TRANSCRIPTION_PROMPT = `Jsi paleograf specializovaný na středověké dokumenty. Přepiš co nejpřesněji veškerý text, který vidíš na tomto obrázku historického dokumentu.

Pravidla:
- Přepisuj přesně to, co vidíš – nepřekládej, neopravuj pravopis
- Zachovej původní řádkování (každý řádek originálu = jeden řádek výstupu)
- Středověké zkratky přepiš tak, jak vypadají (nerozváděj je)
- Speciální znaky (dlouhé ſ, ligatury, rubriky) přepiš co nejblíže originálu
- Místa, která nedokážeš přečíst, označ jako [...]
- Místa, kde si nejsi jistý, označ jako [?text?]
- Na konec přidej krátkou poznámku o typu písma a jazyce, který rozpoznáváš

DŮLEŽITÉ: Nevymýšlej text, který nevidíš. Raději označ jako nečitelný.`;

export function buildConsolidationPrompt(
  ocrSection: string,
  targetLanguage: string,
  engineCount: number,
  engineNames: string,
): string {
  return `Jsi expert na středověkou paleografii a historickou lingvistiku se zaměřením na starou horní němčinu, staročeštinu a latinu.

[OBRÁZEK: originální sken dokumentu je přiložen]

Dostáváš ${engineCount} OCR výstupů téhož středověkého textu z různých OCR enginů (${engineNames}). Máš k dispozici i originální obrázek dokumentu.
Tvým úkolem je:

1. Porovnej všechny OCR výstupy a zároveň se dívej na originální obrázek
2. Na místech kde se výstupy liší, ověř správnou variantu přímo z obrázku
3. Kde žádný OCR engine neuspěl, pokus se přečíst text přímo z obrázku
4. Při rozhodování zohledni:
   - kontext věty a jazyka
   - znalost typických OCR chyb (záměna ſ/f, u/n, c/e, chybějící diakritika)
   - znalost středověkého pravopisu a zkratek
   - vizuální podobu znaků v obrázku
5. Vytvoř konsolidovaný text originálu
6. Přelož konsolidovaný text DOSLOVNĚ do moderní ${targetLanguage}
   - zachovej pořadí slov co nejvíce
   - zachovej strukturu vět
   - rozviň středověké zkratky v hranatých závorkách [takto]
7. Označ místa, kde si nejsi jistý správným čtením, pomocí {?}

${ocrSection}

Výstup ve formátu:
---KONSOLIDOVANÝ TEXT---
[konsolidovaný text originálu]

---DOSLOVNÝ PŘEKLAD---
[doslovný překlad]

---POZNÁMKY---
[seznam nejistých míst a alternativních čtení]`;
}

export function buildPolishPrompt(targetLanguage: string): string {
  return `Jsi překladatel specializovaný na středověké texty.

Dostáváš doslovný překlad středověkého textu do moderní ${targetLanguage}.
Tvým úkolem je přepsat tento překlad do plynulé, čtivé moderní ${targetLanguage}, přičemž:

- zachováš věcný obsah a význam
- použiješ přirozený slovosled a moderní frazeologii
- odstraníš archaické obraty, pokud nemají stylistický účel
- zachováš vlastní jména v původním tvaru
- u nejasných míst (označených {?}) ponech poznámku

Výstup: pouze učesaný překlad, bez komentáře.`;
}
```

- [ ] **Step 2: Add prompts to barrel export**

Add to `packages/shared/src/index.ts`:

```typescript
export {
  CLASSIFY_LAYOUT_PROMPT,
  OCR_TRANSCRIPTION_PROMPT,
  buildConsolidationPrompt,
  buildPolishPrompt,
} from './prompts.js';
```

- [ ] **Step 3: Verify typecheck**

Run: `npx turbo typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/prompts.ts packages/shared/src/index.ts
git commit -m "feat: přidej sdílené LLM prompt šablony"
```

---

### Task 5: Setup ESLint with Clean Architecture rules

**Files:**
- Create: `eslint.config.mjs`
- Create: `apps/web/vitest.config.ts`
- Create: `packages/shared/vitest.config.ts`

- [ ] **Step 1: Create root eslint.config.mjs (ESLint v9 flat config)**

Install the unified `typescript-eslint` package (replaces separate plugin+parser):

```bash
npm install -D typescript-eslint -w packages/shared -w apps/web
```

```javascript
// eslint.config.mjs
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/.turbo/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', {
        allowExpressions: true,
      }],
    },
  },
  {
    files: ['packages/shared/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['*/adapters/*', '*/infrastructure/*', '*/use-cases/*'],
            message: 'Domain vrstva nesmí importovat z vnějších vrstev',
          },
        ],
      }],
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
);
```

Note: `no-restricted-imports` applies ONLY to domain files. Other layers (use-cases, API routes) can freely import adapters.

- [ ] **Step 2: Create apps/web/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': import.meta.dirname,
      '@ai-sedlacek/shared': `${import.meta.dirname}/../../packages/shared/src`,
    },
  },
});
```

Note: `import.meta.dirname` is available since Node 21.2+ (project uses Node 24).

- [ ] **Step 3: Create packages/shared/vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 4: Verify full validation pipeline**

Run: `npx turbo typecheck && npx turbo lint && npx turbo format:check`
Expected: All pass (format:check may need `npx turbo format` first)

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs apps/web/vitest.config.ts packages/shared/vitest.config.ts
git commit -m "feat: přidej ESLint v9 s Clean Architecture pravidly a Vitest config"
```

---

### Task 6: Create DI container with provider switching

**Files:**
- Create: `apps/web/lib/infrastructure/container.ts`
- Create: `apps/web/lib/infrastructure/__tests__/container.test.ts`

- [ ] **Step 1: Write the failing test for container**

```typescript
// apps/web/lib/infrastructure/__tests__/container.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveProvider, getLlmProvider, getStorageProvider } from '../container.js';

describe('resolveProvider', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns "ollama" when LLM_PROVIDER is explicitly set to ollama', () => {
    vi.stubEnv('LLM_PROVIDER', 'ollama');
    expect(resolveProvider('LLM_PROVIDER', 'ANTHROPIC_API_KEY', ['ollama', 'claude'], 'ollama', 'claude')).toBe('ollama');
  });

  it('returns "claude" when LLM_PROVIDER is explicitly set to claude and API key exists', () => {
    vi.stubEnv('LLM_PROVIDER', 'claude');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    expect(resolveProvider('LLM_PROVIDER', 'ANTHROPIC_API_KEY', ['ollama', 'claude'], 'ollama', 'claude')).toBe('claude');
  });

  it('throws when LLM_PROVIDER is claude but API key is missing', () => {
    vi.stubEnv('LLM_PROVIDER', 'claude');
    expect(() =>
      resolveProvider('LLM_PROVIDER', 'ANTHROPIC_API_KEY', ['ollama', 'claude'], 'ollama', 'claude'),
    ).toThrow('vyžaduje nastavení ANTHROPIC_API_KEY');
  });

  it('throws when LLM_PROVIDER is set to an invalid value', () => {
    vi.stubEnv('LLM_PROVIDER', 'openai');
    expect(() =>
      resolveProvider('LLM_PROVIDER', 'ANTHROPIC_API_KEY', ['ollama', 'claude'], 'ollama', 'claude'),
    ).toThrow('Neplatná hodnota');
  });

  it('auto-detects claude when API key exists and no explicit provider', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    expect(resolveProvider('LLM_PROVIDER', 'ANTHROPIC_API_KEY', ['ollama', 'claude'], 'ollama', 'claude')).toBe('claude');
  });

  it('auto-detects ollama when no API key and no explicit provider', () => {
    expect(resolveProvider('LLM_PROVIDER', 'ANTHROPIC_API_KEY', ['ollama', 'claude'], 'ollama', 'claude')).toBe('ollama');
  });
});

describe('getLlmProvider', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns "ollama" by default', () => {
    expect(getLlmProvider()).toBe('ollama');
  });

  it('returns "claude" when ANTHROPIC_API_KEY is set', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    expect(getLlmProvider()).toBe('claude');
  });
});

describe('getStorageProvider', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns "local" by default', () => {
    expect(getStorageProvider()).toBe('local');
  });

  it('returns "vercel-blob" when BLOB_READ_WRITE_TOKEN is set', () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_test');
    expect(getStorageProvider()).toBe('vercel-blob');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/infrastructure/__tests__/container.test.ts`
Expected: FAIL – cannot find module `../container.js`

- [ ] **Step 3: Implement container.ts**

```typescript
// apps/web/lib/infrastructure/container.ts

export function resolveProvider(
  providerEnvKey: string,
  apiKeyEnvKey: string,
  validValues: string[],
  defaultProvider: string,
  apiKeyProvider: string,
): string {
  const explicit = process.env[providerEnvKey];

  if (explicit) {
    if (!validValues.includes(explicit)) {
      throw new Error(
        `Neplatná hodnota ${providerEnvKey}=${explicit}. Povolené: ${validValues.join(', ')}`,
      );
    }
    if (explicit === apiKeyProvider && !process.env[apiKeyEnvKey]) {
      throw new Error(
        `${providerEnvKey}=${apiKeyProvider} vyžaduje nastavení ${apiKeyEnvKey}`,
      );
    }
    return explicit;
  }

  if (process.env[apiKeyEnvKey]) {
    return apiKeyProvider;
  }

  return defaultProvider;
}

export type LlmProvider = 'ollama' | 'claude';
export type StorageProvider = 'local' | 'vercel-blob';

export function getLlmProvider(): LlmProvider {
  return resolveProvider(
    'LLM_PROVIDER',
    'ANTHROPIC_API_KEY',
    ['ollama', 'claude'],
    'ollama',
    'claude',
  ) as LlmProvider;
}

export function getStorageProvider(): StorageProvider {
  return resolveProvider(
    'STORAGE_PROVIDER',
    'BLOB_READ_WRITE_TOKEN',
    ['local', 'vercel-blob'],
    'local',
    'vercel-blob',
  ) as StorageProvider;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/infrastructure/__tests__/container.test.ts`
Expected: All 10 tests PASS (6 resolveProvider + 2 getLlmProvider + 2 getStorageProvider)

- [ ] **Step 5: Run full validation**

Run: `npx turbo typecheck && npx turbo lint && npx turbo test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/infrastructure/
git commit -m "feat: přidej DI kontejner s logikou přepínání providerů"
```

---

### Task 7: Create .env.local template

**Files:**
- Create: `apps/web/.env.local`
- Create: `apps/web/.env.example`

- [ ] **Step 1: Create .env.example (checked into git)**

```env
# === Přepínání providerů ===
# LLM_PROVIDER=ollama              # dev (default)
# LLM_PROVIDER=claude              # produkce
# STORAGE_PROVIDER=local           # dev (default)
# STORAGE_PROVIDER=vercel-blob     # produkce

# === Ollama (dev) ===
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_VISION_MODEL=llama3.2-vision:11b
OLLAMA_TEXT_MODEL=qwen2.5:14b

# === Claude API (produkce) ===
# ANTHROPIC_API_KEY=

# === Transkribus (produkce) ===
# TRANSKRIBUS_EMAIL=
# TRANSKRIBUS_PASSWORD=
# TRANSKRIBUS_MODEL_ID=

# === Vercel Blob (produkce) ===
# BLOB_READ_WRITE_TOKEN=

# === Volitelné ===
TESSERACT_LANG=deu_frak+ces+lat
MAX_FILE_SIZE_MB=20
```

- [ ] **Step 2: Create .env.local (gitignored, for actual use)**

Same content as .env.example with Ollama defaults uncommented.

- [ ] **Step 3: Commit**

```bash
git add apps/web/.env.example
git commit -m "feat: přidej .env.example s konfigurací providerů"
```

---

End of Chunk 1.

---

## Chunk 2: Upload, Storage & Preprocessing

### Task 8: Local storage adapter

**Files:**
- Create: `apps/web/lib/adapters/storage/local-storage.ts`
- Create: `apps/web/lib/adapters/storage/__tests__/local-storage.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/lib/adapters/storage/__tests__/local-storage.test.ts

import { describe, it, expect, afterEach } from 'vitest';
import { LocalStorageProvider } from '../local-storage.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_DIR = path.join(import.meta.dirname, '../../../../tmp/test-uploads');

describe('LocalStorageProvider', () => {
  const storage = new LocalStorageProvider(TEST_DIR);

  afterEach(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  it('uploads a file and returns url and path', async () => {
    const buffer = Buffer.from('test image data');
    const result = await storage.upload(buffer, 'test.jpg');

    expect(result.path).toContain('test.jpg');
    expect(result.url).toContain('/tmp/test-uploads/');

    const saved = await fs.readFile(path.join(TEST_DIR, result.path));
    expect(saved).toEqual(buffer);
  });

  it('generates unique filenames to avoid collisions', async () => {
    const buffer = Buffer.from('data');
    const r1 = await storage.upload(buffer, 'file.jpg');
    const r2 = await storage.upload(buffer, 'file.jpg');
    expect(r1.path).not.toBe(r2.path);
  });

  it('deletes a file', async () => {
    const buffer = Buffer.from('data');
    const result = await storage.upload(buffer, 'delete-me.jpg');
    await storage.delete(result.path);

    await expect(fs.access(path.join(TEST_DIR, result.path))).rejects.toThrow();
  });

  it('getUrl returns path-based URL', () => {
    const url = storage.getUrl('abc123-test.jpg');
    expect(url).toContain('abc123-test.jpg');
    expect(url.startsWith('/')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/adapters/storage/__tests__/local-storage.test.ts`
Expected: FAIL – cannot find `../local-storage.js`

- [ ] **Step 3: Implement LocalStorageProvider**

```typescript
// apps/web/lib/adapters/storage/local-storage.ts

import type { IStorageProvider, StorageResult } from '@ai-sedlacek/shared';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export class LocalStorageProvider implements IStorageProvider {
  constructor(private readonly uploadDir: string = 'tmp/uploads') {}

  async upload(file: Buffer, filename: string): Promise<StorageResult> {
    await fs.mkdir(this.uploadDir, { recursive: true });

    const uniqueName = `${crypto.randomUUID()}-${filename}`;
    const filePath = path.join(this.uploadDir, uniqueName);
    await fs.writeFile(filePath, file);

    return {
      url: `/${filePath}`,
      path: uniqueName,
    };
  }

  getUrl(filePath: string): string {
    return `/${this.uploadDir}/${filePath}`;
  }

  async delete(filePath: string): Promise<void> {
    await fs.unlink(path.join(this.uploadDir, filePath));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/adapters/storage/__tests__/local-storage.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/adapters/storage/
git commit -m "feat: přidej LocalStorageProvider pro dev režim"
```

---

### Task 9: Sharp preprocessor adapter

**Files:**
- Create: `apps/web/lib/adapters/preprocessing/sharp.ts`
- Create: `apps/web/lib/adapters/preprocessing/__tests__/sharp.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/lib/adapters/preprocessing/__tests__/sharp.test.ts

import { describe, it, expect } from 'vitest';
import { SharpPreprocessor } from '../sharp.js';
import sharp from 'sharp';

describe('SharpPreprocessor', () => {
  const preprocessor = new SharpPreprocessor();

  it('processes an image and returns a buffer', async () => {
    // Create a simple 100x100 test image
    const input = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .jpeg()
      .toBuffer();

    const result = await preprocessor.process(input);

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('converts to greyscale', async () => {
    const input = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();

    const result = await preprocessor.process(input);
    const metadata = await sharp(result).metadata();

    expect(metadata.channels).toBe(1);
  });

  it('limits width to 3000px', async () => {
    const input = await sharp({
      create: { width: 5000, height: 1000, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();

    const result = await preprocessor.process(input);
    const metadata = await sharp(result).metadata();

    expect(metadata.width).toBeLessThanOrEqual(3000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/adapters/preprocessing/__tests__/sharp.test.ts`
Expected: FAIL – cannot find `../sharp.js`

- [ ] **Step 3: Implement SharpPreprocessor**

```typescript
// apps/web/lib/adapters/preprocessing/sharp.ts

import type { IPreprocessor } from '@ai-sedlacek/shared';
import sharp from 'sharp';

export class SharpPreprocessor implements IPreprocessor {
  async process(image: Buffer): Promise<Buffer> {
    return sharp(image)
      .greyscale()
      .normalize()
      .sharpen({ sigma: 1.5 })
      .threshold(128)
      .resize({ width: 3000, withoutEnlargement: true })
      .toBuffer();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/adapters/preprocessing/__tests__/sharp.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/adapters/preprocessing/
git commit -m "feat: přidej SharpPreprocessor pro binarizaci a normalizaci obrázků"
```

---

### Task 10: Upload API route

**Files:**
- Create: `apps/web/app/api/upload/route.ts`

- [ ] **Step 1: Create upload route**

```typescript
// apps/web/app/api/upload/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { LocalStorageProvider } from '@/lib/adapters/storage/local-storage.js';
import { getStorageProvider } from '@/lib/infrastructure/container.js';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'Soubor nebyl nahrán' }, { status: 400 });
  }

  const maxSizeMb = parseInt(process.env.MAX_FILE_SIZE_MB ?? '20', 10);
  if (file.size > maxSizeMb * 1024 * 1024) {
    return NextResponse.json(
      { error: `Soubor je příliš velký (max ${maxSizeMb} MB)` },
      { status: 400 },
    );
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/tiff', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json(
      { error: 'Nepodporovaný formát. Povolené: JPEG, PNG, TIFF, WebP' },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // TODO: switch storage based on getStorageProvider() when Vercel Blob adapter exists
  const storage = new LocalStorageProvider();
  const result = await storage.upload(buffer, file.name);

  return NextResponse.json({ url: result.url, path: result.path });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/api/upload/
git commit -m "feat: přidej upload API endpoint s validací formátu a velikosti"
```

---

### Task 11: FileUpload component

**Files:**
- Create: `apps/web/components/FileUpload.tsx`
- Modify: `apps/web/app/page.tsx`

- [ ] **Step 1: Create FileUpload component**

```tsx
// apps/web/components/FileUpload.tsx
'use client';

import { useState, useCallback, type DragEvent, type ChangeEvent } from 'react';

interface FileUploadProps {
  onFileUploaded: (url: string, file: File) => void;
}

export function FileUpload({ onFileUploaded }: FileUploadProps): React.JSX.Element {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const uploadFile = useCallback(
    async (file: File) => {
      setError(null);
      setIsUploading(true);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await response.json();

        if (!response.ok) {
          setError(data.error ?? 'Nahrávání selhalo');
          return;
        }

        setPreview(URL.createObjectURL(file));
        onFileUploaded(data.url, file);
      } catch {
        setError('Chyba při nahrávání souboru');
      } finally {
        setIsUploading(false);
      }
    },
    [onFileUploaded],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) void uploadFile(file);
    },
    [uploadFile],
  );

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void uploadFile(file);
    },
    [uploadFile],
  );

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
          isDragging ? 'border-blue-500 bg-blue-50' : 'border-stone-300 hover:border-stone-400'
        }`}
      >
        {isUploading ? (
          <p className="text-stone-500">Nahrávám...</p>
        ) : (
          <>
            <p className="text-stone-600">Přetáhněte obrázek sem nebo</p>
            <label className="mt-2 cursor-pointer rounded bg-stone-800 px-4 py-2 text-sm text-white hover:bg-stone-700">
              Vyberte soubor
              <input
                type="file"
                accept="image/jpeg,image/png,image/tiff,image/webp"
                onChange={handleChange}
                className="hidden"
              />
            </label>
            <p className="mt-2 text-xs text-stone-400">JPEG, PNG, TIFF, WebP – max 20 MB</p>
          </>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {preview && (
        <div className="overflow-hidden rounded-lg border border-stone-200">
          <img src={preview} alt="Náhled nahraného dokumentu" className="max-h-64 w-full object-contain" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update page.tsx to use FileUpload**

```tsx
// apps/web/app/page.tsx
'use client';

import { useState } from 'react';
import { FileUpload } from '@/components/FileUpload';

export default function HomePage(): React.JSX.Element {
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <p className="text-stone-600">Nahrajte obrázek středověkého dokumentu pro OCR a překlad.</p>
      <FileUpload
        onFileUploaded={(url) => {
          setUploadedUrl(url);
        }}
      />
      {uploadedUrl && (
        <p className="text-sm text-green-700">Soubor nahrán: {uploadedUrl}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify in browser**

Run: `npx turbo dev`
Expected: Drag & drop zone visible, file upload works, preview shows.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/FileUpload.tsx apps/web/app/page.tsx
git commit -m "feat: přidej FileUpload komponentu s drag & drop a náhledem"
```

---

End of Chunk 2.

---

## Chunk 3: Ollama Vision OCR Adapter

### Task 12: Ollama Vision OCR engine

**Files:**
- Create: `apps/web/lib/adapters/ocr/ollama-vision.ts`
- Create: `apps/web/lib/adapters/ocr/__tests__/ollama-vision.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/lib/adapters/ocr/__tests__/ollama-vision.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaVisionOcrEngine } from '../ollama-vision.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('OllamaVisionOcrEngine', () => {
  const engine = new OllamaVisionOcrEngine({
    baseUrl: 'http://localhost:11434',
    visionModel: 'llama3.2-vision:11b',
    textModel: 'qwen2.5:14b',
    timeoutMs: 120000,
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('has correct name and role', () => {
    expect(engine.name).toBe('ollama_vision');
    expect(engine.role).toBe('recognizer');
  });

  it('isAvailable returns true when Ollama responds', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ models: [] }),
    });

    expect(await engine.isAvailable()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('isAvailable returns false when Ollama is down', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await engine.isAvailable()).toBe(false);
  });

  it('recognize sends image and prompt to Ollama chat API', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          role: 'assistant',
          content: 'Přepis textu z obrázku\nDruhý řádek\n[...]\n[?slovo?]',
        },
      }),
    });

    const image = Buffer.from('fake-image-data');
    const result = await engine.recognize(image);

    expect(result.engine).toBe('ollama_vision');
    expect(result.role).toBe('recognizer');
    expect(result.text).toContain('Přepis textu z obrázku');
    expect(result.uncertainMarkers).toEqual(['slovo']);
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);

    // Verify correct API call
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toBe('http://localhost:11434/api/chat');
    const body = JSON.parse(callArgs[1].body);
    expect(body.model).toBe('llama3.2-vision:11b');
    expect(body.stream).toBe(false);
    expect(body.messages[0].images).toHaveLength(1);
  });

  it('recognize throws on API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Internal Server Error',
    });

    const image = Buffer.from('fake-image-data');
    await expect(engine.recognize(image)).rejects.toThrow('Ollama OCR selhal');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/adapters/ocr/__tests__/ollama-vision.test.ts`
Expected: FAIL – cannot find `../ollama-vision.js`

- [ ] **Step 3: Implement OllamaVisionOcrEngine**

```typescript
// apps/web/lib/adapters/ocr/ollama-vision.ts

import type { IOcrEngine, OcrEngineResult, OcrOptions, OllamaConfig } from '@ai-sedlacek/shared';
import { OCR_TRANSCRIPTION_PROMPT } from '@ai-sedlacek/shared';

export class OllamaVisionOcrEngine implements IOcrEngine {
  readonly name = 'ollama_vision' as const;
  readonly role = 'recognizer' as const;

  constructor(private readonly config: OllamaConfig) {}

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async recognize(image: Buffer, _options?: OcrOptions): Promise<OcrEngineResult> {
    const startTime = Date.now();

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.visionModel,
        messages: [
          {
            role: 'user',
            content: OCR_TRANSCRIPTION_PROMPT,
            images: [image.toString('base64')],
          },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Ollama OCR selhal: ${response.statusText}`);
    }

    const data = await response.json();
    const text: string = data.message?.content ?? '';

    const uncertainMarkers = [...text.matchAll(/\[\?(.+?)\?\]/g)].map((m) => m[1]);

    return {
      engine: this.name,
      role: this.role,
      text,
      uncertainMarkers,
      processingTimeMs: Date.now() - startTime,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/adapters/ocr/__tests__/ollama-vision.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Run full validation**

Run: `npx turbo typecheck && npx turbo lint && npx turbo test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/adapters/ocr/ollama-vision.ts apps/web/lib/adapters/ocr/__tests__/
git commit -m "feat: přidej OllamaVisionOcrEngine adapter pro dev OCR"
```

---

End of Chunk 3.

---

## Chunk 4: Ensemble Orchestrator

### Task 13: Ensemble orchestrator

**Files:**
- Create: `apps/web/lib/use-cases/ensemble.ts`
- Create: `apps/web/lib/use-cases/__tests__/ensemble.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/lib/use-cases/__tests__/ensemble.test.ts

import { describe, it, expect, vi } from 'vitest';
import { EnsembleOrchestrator } from '../ensemble.js';
import type { IOcrEngine, OcrEngineResult } from '@ai-sedlacek/shared';

function createMockEngine(
  name: string,
  available: boolean,
  result?: Partial<OcrEngineResult>,
): IOcrEngine {
  return {
    name,
    role: 'recognizer' as const,
    isAvailable: vi.fn().mockResolvedValue(available),
    recognize: vi.fn().mockResolvedValue({
      engine: name,
      role: 'recognizer',
      text: `Text from ${name}`,
      processingTimeMs: 100,
      ...result,
    }),
  };
}

describe('EnsembleOrchestrator', () => {
  it('runs all available engines in parallel', async () => {
    const engine1 = createMockEngine('engine1', true);
    const engine2 = createMockEngine('engine2', true);
    const orchestrator = new EnsembleOrchestrator([engine1, engine2]);

    const results = await orchestrator.run(Buffer.from('image'));

    expect(results).toHaveLength(2);
    expect(engine1.recognize).toHaveBeenCalled();
    expect(engine2.recognize).toHaveBeenCalled();
  });

  it('skips unavailable engines', async () => {
    const available = createMockEngine('available', true);
    const unavailable = createMockEngine('unavailable', false);
    const orchestrator = new EnsembleOrchestrator([available, unavailable]);

    const results = await orchestrator.run(Buffer.from('image'));

    expect(results).toHaveLength(1);
    expect(results[0].engine).toBe('available');
    expect(unavailable.recognize).not.toHaveBeenCalled();
  });

  it('handles engine failure gracefully (continues with remaining)', async () => {
    const working = createMockEngine('working', true);
    const failing: IOcrEngine = {
      name: 'failing',
      role: 'recognizer',
      isAvailable: vi.fn().mockResolvedValue(true),
      recognize: vi.fn().mockRejectedValue(new Error('Engine crashed')),
    };
    const orchestrator = new EnsembleOrchestrator([working, failing]);

    const results = await orchestrator.run(Buffer.from('image'));

    expect(results).toHaveLength(1);
    expect(results[0].engine).toBe('working');
  });

  it('throws when no engines produce results', async () => {
    const unavailable = createMockEngine('unavailable', false);
    const orchestrator = new EnsembleOrchestrator([unavailable]);

    await expect(orchestrator.run(Buffer.from('image'))).rejects.toThrow(
      'Žádný OCR engine neposkytl výsledek',
    );
  });

  it('measures processing time for each engine', async () => {
    const engine = createMockEngine('timed', true, { processingTimeMs: 42 });
    const orchestrator = new EnsembleOrchestrator([engine]);

    const results = await orchestrator.run(Buffer.from('image'));

    expect(results[0].processingTimeMs).toBe(42);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/use-cases/__tests__/ensemble.test.ts`
Expected: FAIL – cannot find `../ensemble.js`

- [ ] **Step 3: Implement EnsembleOrchestrator**

```typescript
// apps/web/lib/use-cases/ensemble.ts

import type { IOcrEngine, OcrEngineResult, OcrOptions } from '@ai-sedlacek/shared';

export class EnsembleOrchestrator {
  constructor(private readonly engines: IOcrEngine[]) {}

  async run(image: Buffer, options?: OcrOptions): Promise<OcrEngineResult[]> {
    const availabilityChecks = await Promise.all(
      this.engines.map(async (engine) => ({
        engine,
        available: await engine.isAvailable(),
      })),
    );

    const availableEngines = availabilityChecks
      .filter((check) => check.available)
      .map((check) => check.engine);

    console.log(
      `[Ensemble] ${availableEngines.length}/${this.engines.length} enginů dostupných: ${availableEngines.map((e) => e.name).join(', ')}`,
    );

    const settledResults = await Promise.allSettled(
      availableEngines.map(async (engine) => {
        console.log(`[Ensemble] Spouštím ${engine.name}...`);
        const result = await engine.recognize(image, options);
        console.log(
          `[Ensemble] ${engine.name} dokončen za ${result.processingTimeMs}ms (${result.text.length} znaků)`,
        );
        return result;
      }),
    );

    const results: OcrEngineResult[] = [];
    for (const settled of settledResults) {
      if (settled.status === 'fulfilled') {
        results.push(settled.value);
      } else {
        console.error(`[Ensemble] Engine selhal:`, settled.reason);
      }
    }

    if (results.length === 0) {
      throw new Error('Žádný OCR engine neposkytl výsledek');
    }

    return results;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/use-cases/__tests__/ensemble.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/use-cases/
git commit -m "feat: přidej EnsembleOrchestrator s graceful degradation"
```

---

End of Chunk 4.

---

## Chunk 5: Consolidation & Translation

### Task 14: Ollama translator adapter

**Files:**
- Create: `apps/web/lib/adapters/llm/ollama-translator.ts`
- Create: `apps/web/lib/adapters/llm/__tests__/ollama-translator.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/lib/adapters/llm/__tests__/ollama-translator.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaTranslator } from '../ollama-translator.js';
import type { OcrEngineResult } from '@ai-sedlacek/shared';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const MOCK_CONSOLIDATION_RESPONSE = `---KONSOLIDOVANÝ TEXT---
Toto je konsolidovaný text originálu.

---DOSLOVNÝ PŘEKLAD---
Toto je doslovný překlad do češtiny.

---POZNÁMKY---
- Řádek 3: nejisté čtení {?} slova "xyz"`;

describe('OllamaTranslator', () => {
  const translator = new OllamaTranslator({
    baseUrl: 'http://localhost:11434',
    visionModel: 'llama3.2-vision:11b',
    textModel: 'qwen2.5:14b',
    timeoutMs: 120000,
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('consolidateAndTranslate sends image + OCR results and parses response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: MOCK_CONSOLIDATION_RESPONSE },
      }),
    });

    const ocrResults: OcrEngineResult[] = [
      { engine: 'ollama_vision', role: 'recognizer', text: 'OCR text 1', processingTimeMs: 100 },
      { engine: 'tesseract', role: 'recognizer', text: 'OCR text 2', processingTimeMs: 50 },
    ];

    const result = await translator.consolidateAndTranslate(
      Buffer.from('image-data'),
      ocrResults,
      'češtiny',
    );

    expect(result.consolidatedText).toContain('konsolidovaný text originálu');
    expect(result.literalTranslation).toContain('doslovný překlad');
    expect(result.notes).toHaveLength(1);

    // Verify vision model used (multimodal consolidation)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('llama3.2-vision:11b');
    expect(body.messages[0].images).toBeDefined();
  });

  it('polish sends text to text model and returns result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: 'Učesaný plynulý překlad.' },
      }),
    });

    const result = await translator.polish('Doslovný překlad textu.', 'češtiny');

    expect(result).toBe('Učesaný plynulý překlad.');

    // Verify text model used (not vision)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('qwen2.5:14b');
    expect(body.messages[0].images).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/adapters/llm/__tests__/ollama-translator.test.ts`
Expected: FAIL – cannot find `../ollama-translator.js`

- [ ] **Step 3: Implement OllamaTranslator**

```typescript
// apps/web/lib/adapters/llm/ollama-translator.ts

import type {
  ITranslator,
  ConsolidationResult,
  OcrEngineResult,
  OllamaConfig,
} from '@ai-sedlacek/shared';
import { buildConsolidationPrompt, buildPolishPrompt } from '@ai-sedlacek/shared';

export class OllamaTranslator implements ITranslator {
  constructor(private readonly config: OllamaConfig) {}

  async consolidateAndTranslate(
    image: Buffer,
    ocrResults: OcrEngineResult[],
    targetLanguage: string,
  ): Promise<ConsolidationResult> {
    const recognizers = ocrResults.filter((r) => r.role === 'recognizer');
    const ocrSection = recognizers
      .map((r) => `--- ${r.engine.toUpperCase()} ---\n${r.text}`)
      .join('\n\n');
    const engineNames = recognizers.map((r) => r.engine).join(', ');

    const prompt = buildConsolidationPrompt(
      ocrSection,
      targetLanguage,
      recognizers.length,
      engineNames,
    );

    const response = await this.callOllama(this.config.visionModel, prompt, image);
    return this.parseConsolidationResponse(response);
  }

  async polish(literalTranslation: string, targetLanguage: string): Promise<string> {
    const prompt = `${buildPolishPrompt(targetLanguage)}\n\n${literalTranslation}`;
    return this.callOllama(this.config.textModel, prompt);
  }

  private async callOllama(
    model: string,
    prompt: string,
    image?: Buffer,
  ): Promise<string> {
    const message: Record<string, unknown> = {
      role: 'user',
      content: prompt,
    };
    if (image) {
      message.images = [image.toString('base64')];
    }

    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [message],
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Ollama volání selhalo: ${response.statusText}`);
    }

    const data = await response.json();
    return data.message?.content ?? '';
  }

  private parseConsolidationResponse(text: string): ConsolidationResult {
    const consolidatedMatch = text.match(
      /---KONSOLIDOVANÝ TEXT---\s*([\s\S]*?)(?=---DOSLOVNÝ PŘEKLAD---|$)/,
    );
    const translationMatch = text.match(
      /---DOSLOVNÝ PŘEKLAD---\s*([\s\S]*?)(?=---POZNÁMKY---|$)/,
    );
    const notesMatch = text.match(/---POZNÁMKY---\s*([\s\S]*?)$/);

    const notes = notesMatch
      ? notesMatch[1]
          .trim()
          .split('\n')
          .map((line) => line.replace(/^-\s*/, '').trim())
          .filter(Boolean)
      : [];

    return {
      consolidatedText: consolidatedMatch?.[1]?.trim() ?? text,
      literalTranslation: translationMatch?.[1]?.trim() ?? '',
      notes,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/adapters/llm/__tests__/ollama-translator.test.ts`
Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/adapters/llm/ollama-translator.ts apps/web/lib/adapters/llm/__tests__/
git commit -m "feat: přidej OllamaTranslator s multimodální konsolidací a překladem"
```

---

End of Chunk 5.

---

## Chunk 6: Ollama Classifier & Process Pipeline

### Task 15: Ollama layout classifier

**Files:**
- Create: `apps/web/lib/adapters/llm/ollama-classifier.ts`
- Create: `apps/web/lib/adapters/llm/__tests__/ollama-classifier.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/lib/adapters/llm/__tests__/ollama-classifier.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OllamaLayoutClassifier } from '../ollama-classifier.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('OllamaLayoutClassifier', () => {
  const classifier = new OllamaLayoutClassifier({
    baseUrl: 'http://localhost:11434',
    visionModel: 'llama3.2-vision:11b',
    textModel: 'qwen2.5:14b',
    timeoutMs: 120000,
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('classifies document and returns DocumentClassification', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: {
          content: JSON.stringify({
            tier: 'tier1',
            scriptType: 'print',
            layoutComplexity: 'simple',
            detectedFeatures: ['fraktur', 'jednosloupcový'],
            confidence: 0.85,
            reasoning: 'Tištěný text v jednom sloupci, frakturové písmo.',
          }),
        },
      }),
    });

    const result = await classifier.classify(Buffer.from('image-data'));

    expect(result.tier).toBe('tier1');
    expect(result.scriptType).toBe('print');
    expect(result.layoutComplexity).toBe('simple');
    expect(result.detectedFeatures).toContain('fraktur');
    expect(result.confidence).toBe(0.85);
  });

  it('defaults to tier1 on parse failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: 'Neplatná odpověď bez JSON' },
      }),
    });

    const result = await classifier.classify(Buffer.from('image'));

    expect(result.tier).toBe('tier1');
    expect(result.confidence).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/adapters/llm/__tests__/ollama-classifier.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement OllamaLayoutClassifier**

```typescript
// apps/web/lib/adapters/llm/ollama-classifier.ts

import type {
  ILayoutClassifier,
  DocumentClassification,
  OllamaConfig,
} from '@ai-sedlacek/shared';
import { CLASSIFY_LAYOUT_PROMPT } from '@ai-sedlacek/shared';

export class OllamaLayoutClassifier implements ILayoutClassifier {
  constructor(private readonly config: OllamaConfig) {}

  async classify(image: Buffer): Promise<DocumentClassification> {
    const response = await fetch(`${this.config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.visionModel,
        messages: [
          {
            role: 'user',
            content: CLASSIFY_LAYOUT_PROMPT,
            images: [image.toString('base64')],
          },
        ],
        stream: false,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Ollama klasifikace selhala: ${response.statusText}`);
    }

    const data = await response.json();
    const content: string = data.message?.content ?? '';

    return this.parseClassification(content);
  }

  private parseClassification(text: string): DocumentClassification {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        tier: parsed.tier ?? 'tier1',
        scriptType: parsed.scriptType ?? 'print',
        layoutComplexity: parsed.layoutComplexity ?? 'simple',
        detectedFeatures: parsed.detectedFeatures ?? [],
        confidence: parsed.confidence ?? 0,
        reasoning: parsed.reasoning ?? '',
      };
    } catch {
      return {
        tier: 'tier1',
        scriptType: 'print',
        layoutComplexity: 'simple',
        detectedFeatures: [],
        confidence: 0,
        reasoning: 'Klasifikace se nezdařila, použit výchozí tier1',
      };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/adapters/llm/__tests__/ollama-classifier.test.ts`
Expected: All 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/adapters/llm/ollama-classifier.ts apps/web/lib/adapters/llm/__tests__/ollama-classifier.test.ts
git commit -m "feat: přidej OllamaLayoutClassifier s fallback na tier1"
```

---

### Task 16: ProcessDocument use case

**Files:**
- Create: `apps/web/lib/use-cases/process-document.ts`
- Create: `apps/web/lib/use-cases/__tests__/process-document.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/lib/use-cases/__tests__/process-document.test.ts

import { describe, it, expect, vi } from 'vitest';
import { ProcessDocument } from '../process-document.js';
import type { IOcrEngine, ITranslator, IPreprocessor, ILayoutClassifier } from '@ai-sedlacek/shared';

describe('ProcessDocument', () => {
  it('runs full pipeline: preprocess → classify → OCR → consolidate → polish', async () => {
    const preprocessor: IPreprocessor = {
      process: vi.fn().mockResolvedValue(Buffer.from('processed')),
    };
    const classifier: ILayoutClassifier = {
      classify: vi.fn().mockResolvedValue({
        tier: 'tier1', scriptType: 'print', layoutComplexity: 'simple',
        detectedFeatures: [], confidence: 0.9, reasoning: 'Test',
      }),
    };
    const engine: IOcrEngine = {
      name: 'test', role: 'recognizer',
      isAvailable: vi.fn().mockResolvedValue(true),
      recognize: vi.fn().mockResolvedValue({
        engine: 'test', role: 'recognizer', text: 'OCR text', processingTimeMs: 50,
      }),
    };
    const translator: ITranslator = {
      consolidateAndTranslate: vi.fn().mockResolvedValue({
        consolidatedText: 'Konsolidovaný', literalTranslation: 'Překlad', notes: ['Poznámka'],
      }),
      polish: vi.fn().mockResolvedValue('Učesaný překlad'),
    };

    const useCase = new ProcessDocument(preprocessor, classifier, [engine], translator);
    const result = await useCase.execute(Buffer.from('image'), 'test-url', 'češtiny');

    expect(preprocessor.process).toHaveBeenCalled();
    expect(classifier.classify).toHaveBeenCalled();
    expect(engine.recognize).toHaveBeenCalled();
    expect(translator.consolidateAndTranslate).toHaveBeenCalled();
    expect(translator.polish).toHaveBeenCalled();

    expect(result.consolidatedText).toBe('Konsolidovaný');
    expect(result.polishedTranslation).toBe('Učesaný překlad');
    expect(result.classification.tier).toBe('tier1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/use-cases/__tests__/process-document.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ProcessDocument use case**

```typescript
// apps/web/lib/use-cases/process-document.ts

import type {
  IOcrEngine,
  ITranslator,
  IPreprocessor,
  ILayoutClassifier,
  ProcessingResult,
} from '@ai-sedlacek/shared';
import { EnsembleOrchestrator } from './ensemble.js';
import crypto from 'crypto';

export class ProcessDocument {
  private readonly ensemble: EnsembleOrchestrator;

  constructor(
    private readonly preprocessor: IPreprocessor,
    private readonly classifier: ILayoutClassifier,
    engines: IOcrEngine[],
    private readonly translator: ITranslator,
  ) {
    this.ensemble = new EnsembleOrchestrator(engines);
  }

  async execute(
    imageBuffer: Buffer,
    originalImageUrl: string,
    targetLanguage: string,
  ): Promise<ProcessingResult> {
    const id = crypto.randomUUID();

    // 1. Preprocessing
    const processedImage = await this.preprocessor.process(imageBuffer);

    // 2. Classification
    const classification = await this.classifier.classify(processedImage);

    // 3. OCR Ensemble
    const ocrResults = await this.ensemble.run(processedImage);

    // 4. Consolidation + literal translation
    const consolidation = await this.translator.consolidateAndTranslate(
      processedImage,
      ocrResults,
      targetLanguage,
    );

    // 5. Polished translation
    const polishedTranslation = await this.translator.polish(
      consolidation.literalTranslation,
      targetLanguage,
    );

    return {
      id,
      originalImage: originalImageUrl,
      classification,
      ocrResults,
      consolidatedText: consolidation.consolidatedText,
      literalTranslation: consolidation.literalTranslation,
      polishedTranslation,
      detectedLanguage: 'neznámý',
      confidenceNotes: consolidation.notes,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/use-cases/__tests__/process-document.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/use-cases/process-document.ts apps/web/lib/use-cases/__tests__/process-document.test.ts
git commit -m "feat: přidej ProcessDocument use case pro orchestraci pipeline"
```

---

### Task 17: DI-wired process API route

**Files:**
- Modify: `apps/web/lib/infrastructure/container.ts`
- Create: `apps/web/app/api/process/route.ts`

- [ ] **Step 1: Add createPipeline factory to container.ts**

Append to `apps/web/lib/infrastructure/container.ts`:

```typescript
import type { OllamaConfig } from '@ai-sedlacek/shared';
import { OllamaVisionOcrEngine } from '../adapters/ocr/ollama-vision.js';
import { OllamaTranslator } from '../adapters/llm/ollama-translator.js';
import { OllamaLayoutClassifier } from '../adapters/llm/ollama-classifier.js';
import { ClaudeVisionOcrEngine } from '../adapters/ocr/claude-vision.js';
import { ClaudeTranslator } from '../adapters/llm/claude-translator.js';
import { ClaudeLayoutClassifier } from '../adapters/llm/claude-classifier.js';
import { TranskribusOcrEngine } from '../adapters/ocr/transkribus.js';
import { SharpPreprocessor } from '../adapters/preprocessing/sharp.js';
import { ProcessDocument } from '../use-cases/process-document.js';

function getOllamaConfig(): OllamaConfig {
  return {
    baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
    visionModel: process.env.OLLAMA_VISION_MODEL ?? 'llama3.2-vision:11b',
    textModel: process.env.OLLAMA_TEXT_MODEL ?? 'qwen2.5:14b',
    timeoutMs: 120000,
  };
}

export function createPipeline(): ProcessDocument {
  const preprocessor = new SharpPreprocessor();
  const provider = getLlmProvider();

  if (provider === 'ollama') {
    const config = getOllamaConfig();
    return new ProcessDocument(
      preprocessor,
      new OllamaLayoutClassifier(config),
      [new OllamaVisionOcrEngine(config)],
      new OllamaTranslator(config),
    );
  }

  // Claude provider
  return new ProcessDocument(
    preprocessor,
    new ClaudeLayoutClassifier(),
    [new ClaudeVisionOcrEngine(), new TranskribusOcrEngine()],
    new ClaudeTranslator(),
  );
}
```

- [ ] **Step 2: Create thin API route using DI**

```typescript
// apps/web/app/api/process/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { createPipeline } from '@/lib/infrastructure/container.js';
import fs from 'fs/promises';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const imageUrl: string = body.imageUrl;

    if (!imageUrl) {
      return NextResponse.json({ error: 'imageUrl je povinný' }, { status: 400 });
    }

    const imagePath = imageUrl.replace(/^\//, '');
    const imageBuffer = await fs.readFile(imagePath);

    const pipeline = createPipeline();
    const result = await pipeline.execute(imageBuffer, imageUrl, 'češtiny');

    return NextResponse.json(result);
  } catch (error) {
    console.error('[Process] Chyba:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Zpracování selhalo' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx turbo typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/infrastructure/container.ts apps/web/app/api/process/
git commit -m "feat: přidej DI-wired /api/process s přepínáním Ollama/Claude"
```

---

End of Chunk 6.

---

## Chunk 7: Result UI

### Task 17: TextColumn and ConfidenceHighlight components

**Files:**
- Create: `apps/web/components/TextColumn.tsx`
- Create: `apps/web/components/ConfidenceHighlight.tsx`

- [ ] **Step 1: Create ConfidenceHighlight**

```tsx
// apps/web/components/ConfidenceHighlight.tsx
'use client';

interface ConfidenceHighlightProps {
  text: string;
}

export function ConfidenceHighlight({ text }: ConfidenceHighlightProps): React.JSX.Element {
  // Highlight {?} uncertain markers and [...] unreadable markers
  const parts = text.split(/(\{\?\}|\[\.\.\.\]|\[\?.+?\?\])/g);

  return (
    <span>
      {parts.map((part, i) => {
        if (part === '{?}' || part.match(/\[\?.+?\?\]/)) {
          return (
            <span key={i} className="rounded bg-amber-100 px-0.5 text-amber-800" title="Nejisté čtení">
              {part}
            </span>
          );
        }
        if (part === '[...]') {
          return (
            <span key={i} className="rounded bg-red-100 px-0.5 text-red-700" title="Nečitelné">
              {part}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
```

- [ ] **Step 2: Create TextColumn**

```tsx
// apps/web/components/TextColumn.tsx

import { ConfidenceHighlight } from './ConfidenceHighlight';

interface TextColumnProps {
  title: string;
  text: string;
  highlight?: boolean;
}

export function TextColumn({ title, text, highlight = false }: TextColumnProps): React.JSX.Element {
  return (
    <div className="flex flex-col rounded-lg border border-stone-200 bg-white">
      <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
        <h3 className="text-sm font-medium text-stone-700">{title}</h3>
      </div>
      <div className="flex-1 whitespace-pre-wrap p-4 text-sm leading-relaxed">
        {highlight ? <ConfidenceHighlight text={text} /> : text}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create ResultViewer**

```tsx
// apps/web/components/ResultViewer.tsx

import type { ProcessingResult } from '@ai-sedlacek/shared';
import { TextColumn } from './TextColumn';

interface ResultViewerProps {
  result: ProcessingResult;
}

export function ResultViewer({ result }: ResultViewerProps): React.JSX.Element {
  const ocrText = result.ocrResults
    .filter((r) => r.role === 'recognizer')
    .map((r) => `--- ${r.engine.toUpperCase()} (${r.processingTimeMs}ms) ---\n${r.text}`)
    .join('\n\n');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-stone-500">
        <span>Tier: {result.classification.tier}</span>
        <span>·</span>
        <span>{result.classification.scriptType}</span>
        <span>·</span>
        <span>Spolehlivost: {Math.round(result.classification.confidence * 100)}%</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="flex flex-col rounded-lg border border-stone-200 bg-white">
          <div className="border-b border-stone-200 bg-stone-50 px-4 py-2">
            <h3 className="text-sm font-medium text-stone-700">Originál</h3>
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            <img
              src={result.originalImage}
              alt="Originální dokument"
              className="max-h-96 object-contain"
            />
          </div>
        </div>

        <TextColumn title="OCR výstup" text={ocrText} highlight />
        <TextColumn title="Doslovný překlad" text={result.literalTranslation} highlight />
        <TextColumn title="Učesaný překlad" text={result.polishedTranslation} />
      </div>

      {result.confidenceNotes.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h4 className="mb-2 text-sm font-medium text-amber-800">Poznámky</h4>
          <ul className="list-inside list-disc text-sm text-amber-700">
            {result.confidenceNotes.map((note, i) => (
              <li key={i}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create ProcessingStatus**

```tsx
// apps/web/components/ProcessingStatus.tsx
'use client';

interface ProcessingStatusProps {
  isProcessing: boolean;
  currentStep?: string;
}

export function ProcessingStatus({
  isProcessing,
  currentStep,
}: ProcessingStatusProps): React.JSX.Element | null {
  if (!isProcessing) return null;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
      <p className="text-sm text-blue-700">{currentStep ?? 'Zpracovávám...'}</p>
    </div>
  );
}
```

- [ ] **Step 5: Update page.tsx with full pipeline flow**

```tsx
// apps/web/app/page.tsx
'use client';

import { useState } from 'react';
import { FileUpload } from '@/components/FileUpload';
import { ProcessingStatus } from '@/components/ProcessingStatus';
import { ResultViewer } from '@/components/ResultViewer';
import type { ProcessingResult } from '@ai-sedlacek/shared';

export default function HomePage(): React.JSX.Element {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState<string>();
  const [result, setResult] = useState<ProcessingResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileUploaded = async (url: string): Promise<void> => {
    setIsProcessing(true);
    setError(null);
    setResult(null);
    setCurrentStep('Preprocessing a klasifikace...');

    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? 'Zpracování selhalo');
        return;
      }

      setResult(data as ProcessingResult);
    } catch {
      setError('Chyba při zpracování dokumentu');
    } finally {
      setIsProcessing(false);
      setCurrentStep(undefined);
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-stone-600">Nahrajte obrázek středověkého dokumentu pro OCR a překlad.</p>
      <FileUpload onFileUploaded={(url) => void handleFileUploaded(url)} />
      <ProcessingStatus isProcessing={isProcessing} currentStep={currentStep} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && <ResultViewer result={result} />}
    </div>
  );
}
```

- [ ] **Step 6: Run typecheck and verify in browser**

Run: `npx turbo typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ apps/web/app/page.tsx
git commit -m "feat: přidej ResultViewer se 4 sloupci a ProcessingStatus"
```

---

End of Chunk 7.

---

## Chunk 8: Claude & Transkribus Adapters (Production)

### Task 18: Claude Vision OCR adapter

**Files:**
- Create: `apps/web/lib/adapters/ocr/claude-vision.ts`
- Create: `apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeVisionOcrEngine } from '../claude-vision.js';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Přepis středověkého textu\n[?slovo?]' }],
      }),
    },
  })),
}));

describe('ClaudeVisionOcrEngine', () => {
  it('has correct name and role', () => {
    const engine = new ClaudeVisionOcrEngine();
    expect(engine.name).toBe('claude_vision');
    expect(engine.role).toBe('recognizer');
  });

  it('isAvailable returns true when ANTHROPIC_API_KEY is set', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    const engine = new ClaudeVisionOcrEngine();
    expect(await engine.isAvailable()).toBe(true);
    vi.unstubAllEnvs();
  });

  it('isAvailable returns false when ANTHROPIC_API_KEY is missing', async () => {
    const engine = new ClaudeVisionOcrEngine();
    expect(await engine.isAvailable()).toBe(false);
  });

  it('recognize calls Anthropic SDK with image and parses result', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    const engine = new ClaudeVisionOcrEngine();
    const result = await engine.recognize(Buffer.from('fake-image'));

    expect(result.engine).toBe('claude_vision');
    expect(result.text).toContain('Přepis středověkého textu');
    expect(result.uncertainMarkers).toEqual(['slovo']);
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 2: Implement ClaudeVisionOcrEngine**

```typescript
// apps/web/lib/adapters/ocr/claude-vision.ts

import type { IOcrEngine, OcrEngineResult, OcrOptions } from '@ai-sedlacek/shared';
import { OCR_TRANSCRIPTION_PROMPT } from '@ai-sedlacek/shared';
import Anthropic from '@anthropic-ai/sdk';

export class ClaudeVisionOcrEngine implements IOcrEngine {
  readonly name = 'claude_vision' as const;
  readonly role = 'recognizer' as const;

  async isAvailable(): Promise<boolean> {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  async recognize(image: Buffer, _options?: OcrOptions): Promise<OcrEngineResult> {
    const startTime = Date.now();
    const client = new Anthropic();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') },
            },
            { type: 'text', text: OCR_TRANSCRIPTION_PROMPT },
          ],
        },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const uncertainMarkers = [...text.matchAll(/\[\?(.+?)\?\]/g)].map((m) => m[1]);

    return {
      engine: this.name,
      role: this.role,
      text,
      uncertainMarkers,
      processingTimeMs: Date.now() - startTime,
    };
  }
}
```

- [ ] **Step 3: Run tests**

Run: `cd apps/web && npx vitest run lib/adapters/ocr/__tests__/claude-vision.test.ts`
Expected: All tests PASS (using mocked SDK)

- [ ] **Step 4: Install Anthropic SDK**

Run: `npm install @anthropic-ai/sdk -w apps/web`

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/adapters/ocr/claude-vision.ts apps/web/lib/adapters/ocr/__tests__/claude-vision.test.ts apps/web/package.json
git commit -m "feat: přidej ClaudeVisionOcrEngine adapter pro produkci"
```

---

### Task 19: Claude translator and classifier adapters

**Files:**
- Create: `apps/web/lib/adapters/llm/claude-translator.ts`
- Create: `apps/web/lib/adapters/llm/claude-classifier.ts`
- Create: `apps/web/lib/adapters/llm/__tests__/claude-translator.test.ts`
- Create: `apps/web/lib/adapters/llm/__tests__/claude-classifier.test.ts`

- [ ] **Step 1: Implement ClaudeTranslator (mirrors OllamaTranslator, uses Anthropic SDK)**

```typescript
// apps/web/lib/adapters/llm/claude-translator.ts

import type { ITranslator, ConsolidationResult, OcrEngineResult } from '@ai-sedlacek/shared';
import { buildConsolidationPrompt, buildPolishPrompt } from '@ai-sedlacek/shared';
import Anthropic from '@anthropic-ai/sdk';

export class ClaudeTranslator implements ITranslator {
  private readonly client = new Anthropic();

  async consolidateAndTranslate(
    image: Buffer,
    ocrResults: OcrEngineResult[],
    targetLanguage: string,
  ): Promise<ConsolidationResult> {
    const recognizers = ocrResults.filter((r) => r.role === 'recognizer');
    const ocrSection = recognizers
      .map((r) => `--- ${r.engine.toUpperCase()} ---\n${r.text}`)
      .join('\n\n');
    const engineNames = recognizers.map((r) => r.engine).join(', ');

    const prompt = buildConsolidationPrompt(ocrSection, targetLanguage, recognizers.length, engineNames);

    const response = await this.client.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') } },
            { type: 'text', text: prompt },
          ],
        },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    return this.parseResponse(text);
  }

  async polish(literalTranslation: string, targetLanguage: string): Promise<string> {
    const response = await this.client.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      messages: [
        { role: 'user', content: `${buildPolishPrompt(targetLanguage)}\n\n${literalTranslation}` },
      ],
    });

    return response.content[0]?.type === 'text' ? response.content[0].text : '';
  }

  private parseResponse(text: string): ConsolidationResult {
    const consolidatedMatch = text.match(/---KONSOLIDOVANÝ TEXT---\s*([\s\S]*?)(?=---DOSLOVNÝ PŘEKLAD---|$)/);
    const translationMatch = text.match(/---DOSLOVNÝ PŘEKLAD---\s*([\s\S]*?)(?=---POZNÁMKY---|$)/);
    const notesMatch = text.match(/---POZNÁMKY---\s*([\s\S]*?)$/);

    const notes = notesMatch
      ? notesMatch[1].trim().split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean)
      : [];

    return {
      consolidatedText: consolidatedMatch?.[1]?.trim() ?? text,
      literalTranslation: translationMatch?.[1]?.trim() ?? '',
      notes,
    };
  }
}
```

- [ ] **Step 2: Implement ClaudeLayoutClassifier**

```typescript
// apps/web/lib/adapters/llm/claude-classifier.ts

import type { ILayoutClassifier, DocumentClassification } from '@ai-sedlacek/shared';
import { CLASSIFY_LAYOUT_PROMPT } from '@ai-sedlacek/shared';
import Anthropic from '@anthropic-ai/sdk';

export class ClaudeLayoutClassifier implements ILayoutClassifier {
  private readonly client = new Anthropic();

  async classify(image: Buffer): Promise<DocumentClassification> {
    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') } },
            { type: 'text', text: CLASSIFY_LAYOUT_PROMPT },
          ],
        },
      ],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON');
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        tier: parsed.tier ?? 'tier1',
        scriptType: parsed.scriptType ?? 'print',
        layoutComplexity: parsed.layoutComplexity ?? 'simple',
        detectedFeatures: parsed.detectedFeatures ?? [],
        confidence: parsed.confidence ?? 0,
        reasoning: parsed.reasoning ?? '',
      };
    } catch {
      return { tier: 'tier1', scriptType: 'print', layoutComplexity: 'simple', detectedFeatures: [], confidence: 0, reasoning: 'Klasifikace se nezdařila' };
    }
  }
}
```

- [ ] **Step 3: Write mock tests for both**

```typescript
// apps/web/lib/adapters/llm/__tests__/claude-translator.test.ts

import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '---KONSOLIDOVANÝ TEXT---\nKonsolidovaný\n\n---DOSLOVNÝ PŘEKLAD---\nPřeklad\n\n---POZNÁMKY---\n- Poznámka 1' }],
      }),
    },
  })),
}));

import { ClaudeTranslator } from '../claude-translator.js';

describe('ClaudeTranslator', () => {
  it('parses consolidation response correctly', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    const translator = new ClaudeTranslator();
    const result = await translator.consolidateAndTranslate(
      Buffer.from('image'),
      [{ engine: 'tesseract', role: 'recognizer', text: 'OCR text', processingTimeMs: 0 }],
      'češtiny',
    );
    expect(result.consolidatedText).toBe('Konsolidovaný');
    expect(result.literalTranslation).toBe('Překlad');
    expect(result.notes).toEqual(['Poznámka 1']);
    vi.unstubAllEnvs();
  });
});
```

```typescript
// apps/web/lib/adapters/llm/__tests__/claude-classifier.test.ts

import { describe, it, expect, vi } from 'vitest';

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"tier":"tier1","scriptType":"print","layoutComplexity":"simple","detectedFeatures":["fraktur"],"confidence":0.9,"reasoning":"Test"}' }],
      }),
    },
  })),
}));

import { ClaudeLayoutClassifier } from '../claude-classifier.js';

describe('ClaudeLayoutClassifier', () => {
  it('parses classification JSON', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    const classifier = new ClaudeLayoutClassifier();
    const result = await classifier.classify(Buffer.from('image'));
    expect(result.tier).toBe('tier1');
    expect(result.detectedFeatures).toContain('fraktur');
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 4: Run all tests**

Run: `npx turbo test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/adapters/llm/claude-translator.ts apps/web/lib/adapters/llm/claude-classifier.ts apps/web/lib/adapters/llm/__tests__/claude-translator.test.ts apps/web/lib/adapters/llm/__tests__/claude-classifier.test.ts
git commit -m "feat: přidej Claude translator a classifier adaptéry pro produkci"
```

---

### Task 20: Transkribus OCR adapter (mock)

**Files:**
- Create: `apps/web/lib/adapters/ocr/transkribus.ts`
- Create: `apps/web/lib/adapters/ocr/__tests__/transkribus.test.ts`

- [ ] **Step 1: Implement TranskribusOcrEngine stub**

```typescript
// apps/web/lib/adapters/ocr/transkribus.ts

import type { IOcrEngine, OcrEngineResult, OcrOptions, TranskribusConfig } from '@ai-sedlacek/shared';

export class TranskribusOcrEngine implements IOcrEngine {
  readonly name = 'transkribus' as const;
  readonly role = 'recognizer' as const;

  constructor(private readonly config?: TranskribusConfig) {}

  async isAvailable(): Promise<boolean> {
    return !!(process.env.TRANSKRIBUS_EMAIL && process.env.TRANSKRIBUS_PASSWORD);
  }

  async recognize(image: Buffer, _options?: OcrOptions): Promise<OcrEngineResult> {
    const startTime = Date.now();

    // 1. Authenticate
    const token = await this.authenticate();

    // 2. Submit processing job
    const processId = await this.submitJob(token, image);

    // 3. Poll for result
    const text = await this.pollResult(token, processId);

    return {
      engine: this.name,
      role: this.role,
      text,
      processingTimeMs: Date.now() - startTime,
    };
  }

  private async authenticate(): Promise<string> {
    const response = await fetch(
      'https://account.readcoop.eu/auth/realms/readcoop/protocol/openid-connect/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          username: process.env.TRANSKRIBUS_EMAIL ?? '',
          password: process.env.TRANSKRIBUS_PASSWORD ?? '',
          client_id: 'processing-api-client',
        }),
      },
    );

    if (!response.ok) throw new Error('Transkribus autentizace selhala');
    const data = await response.json();
    return data.access_token;
  }

  private async submitJob(token: string, image: Buffer): Promise<string> {
    const response = await fetch('https://transkribus.eu/processing/v1/processes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        config: { textRecognition: { htrId: this.config?.modelId ?? process.env.TRANSKRIBUS_MODEL_ID } },
        image: { base64: image.toString('base64') },
      }),
    });

    if (!response.ok) throw new Error('Transkribus zpracování selhalo');
    const data = await response.json();
    return data.processId;
  }

  private async pollResult(token: string, processId: string): Promise<string> {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));

      const response = await fetch(
        `https://transkribus.eu/processing/v1/processes/${processId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!response.ok) continue;
      const data = await response.json();

      if (data.status === 'FINISHED') {
        return data.content ?? '';
      }
      if (data.status === 'FAILED') {
        throw new Error('Transkribus zpracování selhalo');
      }
    }

    throw new Error('Transkribus timeout');
  }
}
```

- [ ] **Step 2: Write test with mocked fetch**

```typescript
// apps/web/lib/adapters/ocr/__tests__/transkribus.test.ts

import { describe, it, expect, vi } from 'vitest';
import { TranskribusOcrEngine } from '../transkribus.js';

describe('TranskribusOcrEngine', () => {
  it('isAvailable returns false without credentials', async () => {
    const engine = new TranskribusOcrEngine();
    expect(await engine.isAvailable()).toBe(false);
  });

  it('isAvailable returns true with credentials', async () => {
    vi.stubEnv('TRANSKRIBUS_EMAIL', 'test@test.com');
    vi.stubEnv('TRANSKRIBUS_PASSWORD', 'pass');
    const engine = new TranskribusOcrEngine();
    expect(await engine.isAvailable()).toBe(true);
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd apps/web && npx vitest run lib/adapters/ocr/__tests__/transkribus.test.ts`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/adapters/ocr/transkribus.ts apps/web/lib/adapters/ocr/__tests__/transkribus.test.ts
git commit -m "feat: přidej TranskribusOcrEngine adapter s autentizací a pollingem"
```

---

End of Chunk 8.

---

## Chunk 9: TierSelector & Final Polish

### Task 21: TierSelector component

**Files:**
- Create: `apps/web/components/TierSelector.tsx`

- [ ] **Step 1: Create TierSelector**

```tsx
// apps/web/components/TierSelector.tsx
'use client';

import type { DocumentClassification } from '@ai-sedlacek/shared';

interface TierSelectorProps {
  classification: DocumentClassification | null;
}

export function TierSelector({ classification }: TierSelectorProps): React.JSX.Element | null {
  if (!classification) return null;

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-stone-700">
            Doporučený tier:{' '}
            <span className={classification.tier === 'tier1' ? 'text-green-600' : 'text-amber-600'}>
              {classification.tier.toUpperCase()}
            </span>
          </span>
          <p className="mt-1 text-xs text-stone-500">{classification.reasoning}</p>
        </div>
        {classification.tier === 'tier2' && (
          <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-700">
            Tier 2 vyžaduje VPS worker
          </span>
        )}
      </div>
      {classification.detectedFeatures.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {classification.detectedFeatures.map((feature) => (
            <span key={feature} className="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
              {feature}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/TierSelector.tsx
git commit -m "feat: přidej TierSelector komponentu s doporučením tieru"
```

---

### Task 22: Final validation and cleanup

- [ ] **Step 1: Run full validation pipeline**

Run: `npx turbo typecheck && npx turbo lint && npx turbo format:check && npx turbo test`
Expected: All 4 checks PASS. If format:check fails, run `npx turbo format` first.

- [ ] **Step 2: Fix any issues found**

Iterate until all checks pass.

- [ ] **Step 3: Verify dev server works end-to-end**

Run: `npx turbo dev`
Steps:
1. Open http://localhost:3000
2. Upload a test image
3. Verify upload succeeds and preview shows
4. Verify /api/process call starts (will fail without Ollama vision model, which is expected)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: dokončení Fáze 1 scaffolding a adaptérů"
```

---

End of Chunk 9.

---

## Deferred: Tesseract.js (spec step 1.4)

Tesseract.js adapter (`lib/client/tesseract-worker.ts`, `lib/adapters/ocr/tesseract.ts`) and the
`/api/process/[id]/tesseract-result` endpoint are **deferred** from this plan. Reasons:

1. Tesseract.js runs in the **browser** via Web Worker – requires full UI flow to test
2. The ensemble orchestrator already handles graceful degradation (1+ engine is enough)
3. Server-side receives the result via a separate POST from the client

**When to add:** After the full pipeline is working end-to-end with Ollama + UI. Tesseract.js
adds the second engine to the dev ensemble. Implementation pattern:
- Browser: `tesseract-worker.ts` runs OCR on upload, sends result to `/api/process/[id]/tesseract-result`
- Server: `adapters/ocr/tesseract.ts` is a passthrough that stores client-provided results
- Ensemble waits for Tesseract result with timeout before proceeding
