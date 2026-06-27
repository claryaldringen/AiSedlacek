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
  serverUpdatedAt?: string;
}

export interface PageMeta {
  documentId: string;
  pageId: string;
  pulledAt: string;
  serverUpdatedAt?: string;
  hashes: Record<string, string>;
}

function sha256(content: string): string {
  return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex');
}

export function getWorkspaceDir(): string {
  return path.join(process.cwd(), WORKSPACE_DIR);
}

export function getPageDir(pageId: string): string {
  // Sanitizace ID stránky — zabraňuje path traversal v cestách workspace.
  if (!/^[A-Za-z0-9_-]+$/.test(pageId)) {
    throw new Error(`Neplatné ID stránky: "${pageId}"`);
  }
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
    serverUpdatedAt: data.serverUpdatedAt,
    hashes,
  };
  fs.writeFileSync(path.join(dir, '.meta.json'), JSON.stringify(meta, null, 2));
}

/**
 * Aktualizuje pouze metadata reálně pushnutých polí — přepočítá hash z aktuálního
 * lokálního obsahu daných souborů a uloží novou serverUpdatedAt. Lokální obsah souborů
 * (zejm. glossary.md, který je read-only/nepushovatelný) se NEPŘEPISUJE.
 */
export function updateMetaAfterPush(
  pageId: string,
  pushedFiles: WorkspaceFile[],
  serverUpdatedAt?: string,
): void {
  const meta = readMeta(pageId);
  if (!meta) return;

  const dir = getPageDir(pageId);
  for (const file of pushedFiles) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    meta.hashes[file] = sha256(content);
  }

  if (serverUpdatedAt !== undefined) {
    meta.serverUpdatedAt = serverUpdatedAt;
  }
  meta.pulledAt = new Date().toISOString();

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
