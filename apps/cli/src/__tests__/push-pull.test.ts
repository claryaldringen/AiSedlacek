import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ApiError } from '../lib/api-client.js';

// Integrační testy příkazů push/pull nad skutečným workspace v dočasném adresáři
// a mockovaným API (DAT-3: push nesmí tiše zahodit editaci překladu).

const api = vi.hoisted(() => ({
  get: vi.fn(),
  postJson: vi.fn(),
  patchJson: vi.fn(),
  delete: vi.fn(),
  postFormData: vi.fn(),
  getRaw: vi.fn(),
}));

vi.mock('../lib/require-auth.js', () => ({
  requireAuth: () => ({ token: 'test-token', api }),
}));

vi.mock('ora', () => ({
  default: () => {
    const spinner = { text: '', start: () => spinner, stop: () => spinner };
    return spinner;
  },
}));

const { pushCommand } = await import('../commands/push.js');
const { pullCommand } = await import('../commands/pull.js');

const PAGE_ID = 'page1';
const UPDATED_AT = '2026-10-01T10:00:00.000Z';

function serverPage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PAGE_ID,
    filename: 'scan.jpg',
    document: {
      id: 'doc-1',
      transcription: 'Přepis',
      context: 'Kontext',
      updatedAt: UPDATED_AT,
      translations: [
        { language: 'en', text: 'English', createdAt: '2026-09-02T00:00:00Z' },
        { language: 'cs', text: 'Český překlad', createdAt: '2026-09-01T00:00:00Z' },
      ],
      glossary: [],
      ...overrides,
    },
  };
}

let tmpDir: string;
let errors: string[];

function pageDir(): string {
  return path.join(tmpDir, '.ais-workspace', PAGE_ID);
}

function readMetaFile(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(pageDir(), '.meta.json'), 'utf-8'));
}

async function run(cmd: typeof pushCommand, args: string[]): Promise<void> {
  await cmd.parseAsync(args, { from: 'user' });
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-cli-test-'));
  vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
  errors = [];
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation((msg: string) => {
    errors.push(String(msg));
  });
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exitCode = undefined;
});

describe('ais pull', () => {
  it('stores the translation language deterministically in metadata', async () => {
    api.get.mockResolvedValue(serverPage());

    await run(pullCommand, [PAGE_ID]);

    expect(fs.readFileSync(path.join(pageDir(), 'translation.md'), 'utf-8')).toBe('Český překlad');
    expect(readMetaFile()).toMatchObject({
      translationLanguage: 'cs',
      serverUpdatedAt: UPDATED_AT,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('pulls the language requested via --lang', async () => {
    api.get.mockResolvedValue(serverPage());

    await run(pullCommand, [PAGE_ID, '--lang', 'en']);

    expect(fs.readFileSync(path.join(pageDir(), 'translation.md'), 'utf-8')).toBe('English');
    expect(readMetaFile()).toMatchObject({ translationLanguage: 'en' });
  });

  it('refuses to overwrite unpushed local changes without --force', async () => {
    api.get.mockResolvedValue(serverPage());
    await run(pullCommand, [PAGE_ID]);
    fs.writeFileSync(path.join(pageDir(), 'translation.md'), 'Lokální práce');

    await run(pullCommand, [PAGE_ID]);

    expect(fs.readFileSync(path.join(pageDir(), 'translation.md'), 'utf-8')).toBe('Lokální práce');
    expect(process.exitCode).toBe(1);

    process.exitCode = undefined;
    await run(pullCommand, [PAGE_ID, '--force']);
    expect(fs.readFileSync(path.join(pageDir(), 'translation.md'), 'utf-8')).toBe('Český překlad');
  });
});

describe('ais push', () => {
  async function pullAndEditTranslation(text: string): Promise<void> {
    api.get.mockResolvedValue(serverPage());
    await run(pullCommand, [PAGE_ID]);
    fs.writeFileSync(path.join(pageDir(), 'translation.md'), text);
    api.get.mockClear();
  }

  it('sends translationLanguage with the edited translation and marks it as pushed', async () => {
    await pullAndEditTranslation('Opravený překlad');
    api.get.mockResolvedValue(serverPage());
    api.patchJson.mockResolvedValue({
      ...(serverPage().document as object),
      translations: [{ language: 'cs', text: 'Opravený překlad' }],
    });
    const hashBefore = (readMetaFile().hashes as Record<string, string>)['translation.md'];

    await run(pushCommand, []);

    expect(api.patchJson).toHaveBeenCalledWith('/api/documents/doc-1', {
      translation: 'Opravený překlad',
      translationLanguage: 'cs',
    });
    expect((readMetaFile().hashes as Record<string, string>)['translation.md']).not.toBe(
      hashBefore,
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('keeps the change unpushed and reports an error on a non-2xx response', async () => {
    await pullAndEditTranslation('Opravený překlad');
    api.get.mockResolvedValue(serverPage());
    api.patchJson.mockRejectedValue(new ApiError(400, 'translationLanguage is required'));
    const metaBefore = readMetaFile();

    await run(pushCommand, []);

    expect(readMetaFile().hashes).toEqual(metaBefore.hashes);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('translationLanguage is required');
    expect(errors.join('\n')).toContain('NEBYLY odeslány');
  });

  it('keeps the change unpushed when the server silently ignores the translation', async () => {
    await pullAndEditTranslation('Opravený překlad');
    api.get.mockResolvedValue(serverPage());
    // Server vrátí 200, ale překlad neuložil (chování před opravou DAT-3).
    api.patchJson.mockResolvedValue(serverPage().document);
    const metaBefore = readMetaFile();

    await run(pushCommand, []);

    expect(readMetaFile().hashes).toEqual(metaBefore.hashes);
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('translation.md');
  });

  it('refuses to guess the language for a legacy workspace with several translations', async () => {
    await pullAndEditTranslation('Opravený překlad');
    // Simuluj workspace stažený starší verzí CLI (bez jazyka v metadatech).
    const meta = readMetaFile();
    delete meta.translationLanguage;
    fs.writeFileSync(path.join(pageDir(), '.meta.json'), JSON.stringify(meta));
    api.get.mockResolvedValue(serverPage());

    await run(pushCommand, []);

    expect(api.patchJson).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toContain('nelze určit jazyk překladu');
  });

  it('uses --lang for a legacy workspace', async () => {
    await pullAndEditTranslation('Opravený překlad');
    const meta = readMetaFile();
    delete meta.translationLanguage;
    fs.writeFileSync(path.join(pageDir(), '.meta.json'), JSON.stringify(meta));
    api.get.mockResolvedValue(serverPage());
    api.patchJson.mockResolvedValue({
      ...(serverPage().document as object),
      translations: [{ language: 'en', text: 'Opravený překlad' }],
    });

    await run(pushCommand, ['--lang', 'en']);

    expect(api.patchJson).toHaveBeenCalledWith('/api/documents/doc-1', {
      translation: 'Opravený překlad',
      translationLanguage: 'en',
    });
    expect(readMetaFile().translationLanguage).toBe('en');
    expect(process.exitCode).toBeUndefined();
  });
});
