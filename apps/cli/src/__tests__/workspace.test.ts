import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import {
  getWorkspaceDir,
  getPageDir,
  writePageFiles,
  getChangedFiles,
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
    expect(mkdirSpy).toHaveBeenCalledWith(
      expect.stringContaining('/.ais-workspace/42'),
      { recursive: true },
    );
  });

  it('detects changed files', () => {
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
    expect(changed.length).toBeGreaterThan(0);
  });
});
