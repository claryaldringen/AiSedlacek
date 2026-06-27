import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import {
  getWorkspaceDir,
  getPageDir,
  writePageFiles,
  getChangedFiles,
  updateMetaAfterPush,
  type PageData,
} from '../lib/workspace.js';

vi.mock('node:fs');

describe('workspace', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

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
    expect(mkdirSpy).toHaveBeenCalledWith(expect.stringContaining('/.ais-workspace/42'), {
      recursive: true,
    });
  });

  it('detects changed files', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    expect(changed.length).toBeGreaterThan(0);
  });

  it('rejects page ids that could traverse the filesystem', () => {
    expect(() => getPageDir('../../etc')).toThrow(/Neplatné ID stránky/);
    expect(() => getPageDir('foo/bar')).toThrow(/Neplatné ID stránky/);
  });

  it('updateMetaAfterPush updates only pushed fields and preserves the rest', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      if (filePath.toString().endsWith('.meta.json')) {
        return JSON.stringify({
          documentId: 'doc-1',
          pageId: '42',
          pulledAt: '2026-04-20T10:00:00Z',
          serverUpdatedAt: 'OLD',
          hashes: {
            'transcription.md': 'sha256:old-transcription',
            'translation.md': 'sha256:keep-translation',
            'context.md': 'sha256:keep-context',
            'glossary.md': 'sha256:keep-glossary',
          },
        });
      }
      if (filePath.toString().endsWith('transcription.md')) return 'nový obsah transkripce';
      return 'jiný obsah';
    });
    const writeSpy = vi.mocked(fs.writeFileSync);

    updateMetaAfterPush('42', ['transcription.md'], 'NEW');

    const metaWrite = writeSpy.mock.calls.find((c) => c[0].toString().endsWith('.meta.json'));
    expect(metaWrite).toBeDefined();
    const written = JSON.parse(metaWrite![1] as string);

    // serverUpdatedAt se aktualizuje na novou hodnotu
    expect(written.serverUpdatedAt).toBe('NEW');
    // hash pushnutého pole se přepočítá
    expect(written.hashes['transcription.md']).not.toBe('sha256:old-transcription');
    // ostatní hashe (vč. glossary.md) zůstávají beze změny — lokální obsah se nepřepisuje
    expect(written.hashes['translation.md']).toBe('sha256:keep-translation');
    expect(written.hashes['context.md']).toBe('sha256:keep-context');
    expect(written.hashes['glossary.md']).toBe('sha256:keep-glossary');

    // updateMetaAfterPush zapisuje pouze .meta.json, žádné obsahové soubory
    const contentWrites = writeSpy.mock.calls.filter(
      (c) => !c[0].toString().endsWith('.meta.json'),
    );
    expect(contentWrites).toHaveLength(0);
  });
});
