import { describe, it, expect } from 'vitest';
import {
  pickTranslation,
  buildDocumentPatch,
  findUnconfirmedFiles,
  resolvePushLanguage,
  type ServerTranslation,
} from '../lib/document-sync.js';
import type { ChangedFile, WorkspaceFile } from '../lib/workspace.js';

const FILES: Record<WorkspaceFile, string> = {
  'transcription.md': 'Přepis',
  'translation.md': 'Překlad',
  'context.md': 'Kontext',
  'glossary.md': '',
};

function changed(...files: WorkspaceFile[]): ChangedFile[] {
  return files.map((file) => ({ file, oldHash: 'a', newHash: 'b' }));
}

describe('pickTranslation', () => {
  const translations: ServerTranslation[] = [
    { language: 'en', text: 'English', createdAt: '2026-02-01T00:00:00Z' },
    { language: 'cs', text: 'Česky', createdAt: '2026-01-01T00:00:00Z' },
  ];

  it('picks the oldest translation regardless of array order', () => {
    expect(pickTranslation(translations)).toEqual({
      language: 'cs',
      text: 'Česky',
      available: ['cs', 'en'],
    });
    expect(pickTranslation([...translations].reverse()).language).toBe('cs');
  });

  it('falls back to language code when createdAt is missing', () => {
    const picked = pickTranslation([
      { language: 'la', text: 'L' },
      { language: 'de', text: 'D' },
    ]);
    expect(picked.language).toBe('de');
  });

  it('honours an explicitly preferred language', () => {
    expect(pickTranslation(translations, 'en')).toMatchObject({ language: 'en', text: 'English' });
  });

  it('keeps a preferred language that does not exist yet with empty text', () => {
    expect(pickTranslation(translations, 'de')).toEqual({
      language: 'de',
      text: '',
      available: ['cs', 'en'],
    });
  });

  it('returns no language when the document has no translation', () => {
    expect(pickTranslation(undefined)).toEqual({ language: undefined, text: '', available: [] });
  });
});

describe('buildDocumentPatch', () => {
  it('sends translation together with its language', () => {
    expect(buildDocumentPatch(changed('translation.md'), FILES, 'cs')).toEqual({
      translation: 'Překlad',
      translationLanguage: 'cs',
    });
  });

  it('throws instead of sending translation without language', () => {
    expect(() => buildDocumentPatch(changed('translation.md'), FILES, undefined)).toThrow(
      /translationLanguage/,
    );
  });

  it('does not require language when translation did not change', () => {
    expect(buildDocumentPatch(changed('transcription.md', 'context.md'), FILES, undefined)).toEqual(
      { transcription: 'Přepis', context: 'Kontext' },
    );
  });
});

describe('findUnconfirmedFiles', () => {
  const patch = {
    transcription: 'Přepis',
    context: 'Kontext',
    translation: 'Překlad',
    translationLanguage: 'cs',
  };

  it('returns nothing when the server echoes all values', () => {
    expect(
      findUnconfirmedFiles(patch, {
        transcription: 'Přepis',
        context: 'Kontext',
        translations: [
          { language: 'en', text: 'x' },
          { language: 'cs', text: 'Překlad' },
        ],
      }),
    ).toEqual([]);
  });

  it('detects a translation the server ignored', () => {
    expect(
      findUnconfirmedFiles(patch, {
        transcription: 'Přepis',
        context: 'Kontext',
        translations: [{ language: 'cs', text: 'Starý překlad' }],
      }),
    ).toEqual(['translation.md']);
  });

  it('treats an empty response as unconfirmed', () => {
    expect(findUnconfirmedFiles(patch, null)).toEqual([
      'transcription.md',
      'context.md',
      'translation.md',
    ]);
  });
});

describe('resolvePushLanguage', () => {
  it('uses the language from metadata', () => {
    expect(resolvePushLanguage('cs', undefined, undefined)).toEqual({ ok: true, language: 'cs' });
  });

  it('warns and ignores --lang that differs from metadata', () => {
    expect(resolvePushLanguage('cs', 'en', undefined)).toMatchObject({
      ok: true,
      language: 'cs',
      warning: expect.stringContaining('--lang en'),
    });
  });

  it('accepts --lang for a legacy workspace only when the translation exists', () => {
    expect(resolvePushLanguage(undefined, 'en', ['cs', 'en'])).toEqual({
      ok: true,
      language: 'en',
    });
    expect(resolvePushLanguage(undefined, 'cz', ['cs', 'en'])).toMatchObject({ ok: false });
  });

  it('infers the only server translation and refuses to guess between several', () => {
    expect(resolvePushLanguage(undefined, undefined, ['de'])).toMatchObject({
      ok: true,
      language: 'de',
    });
    expect(resolvePushLanguage(undefined, undefined, ['cs', 'en'])).toMatchObject({ ok: false });
    expect(resolvePushLanguage(undefined, undefined, [])).toMatchObject({ ok: false });
  });
});
