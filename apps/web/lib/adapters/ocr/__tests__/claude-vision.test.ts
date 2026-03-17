import { describe, it, expect } from 'vitest';
import { detectMediaType, parseOcrJson } from '../claude-vision.js';

const VALID_JSON = {
  transcription: 'Starý text',
  detectedLanguage: 'cs-old',
  translation: 'Moderní text',
  translationLanguage: 'cs',
  context: 'Kontext',
  glossary: [{ term: 'slovo', definition: 'význam' }],
};

describe('detectMediaType', () => {
  it('detects JPEG from magic bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0x00, 0x00]);
    expect(detectMediaType(buf)).toBe('image/jpeg');
  });

  it('detects PNG from magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x00, 0x00]);
    expect(detectMediaType(buf)).toBe('image/png');
  });

  it('detects WebP from magic bytes', () => {
    const buf = Buffer.from([0x52, 0x49, 0x00, 0x00]);
    expect(detectMediaType(buf)).toBe('image/webp');
  });

  it('detects GIF from magic bytes', () => {
    const buf = Buffer.from([0x47, 0x49, 0x00, 0x00]);
    expect(detectMediaType(buf)).toBe('image/gif');
  });

  it('defaults to image/jpeg for unknown magic bytes', () => {
    const buf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    expect(detectMediaType(buf)).toBe('image/jpeg');
  });
});

describe('parseOcrJson', () => {
  it('parses clean JSON string', () => {
    const raw = JSON.stringify(VALID_JSON);
    expect(parseOcrJson(raw)).toEqual(VALID_JSON);
  });

  it('parses JSON wrapped in ```json fences', () => {
    const raw = '```json\n' + JSON.stringify(VALID_JSON) + '\n```';
    expect(parseOcrJson(raw)).toEqual(VALID_JSON);
  });

  it('parses JSON wrapped in plain ``` fences', () => {
    const raw = '```\n' + JSON.stringify(VALID_JSON) + '\n```';
    expect(parseOcrJson(raw)).toEqual(VALID_JSON);
  });

  it('parses JSON with surrounding text', () => {
    const raw = 'Here is the result:\n' + JSON.stringify(VALID_JSON) + '\nHope this helps!';
    expect(parseOcrJson(raw)).toEqual(VALID_JSON);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseOcrJson('not json at all')).toThrow();
  });

  it('parses JSON with extra whitespace', () => {
    const raw = '   \n\n  ' + JSON.stringify(VALID_JSON) + '  \n\n  ';
    expect(parseOcrJson(raw)).toEqual(VALID_JSON);
  });

  it('fixes unescaped newlines inside JSON string values', () => {
    // Simulate Claude returning literal newlines inside a JSON string
    const raw = `{"transcription": "line one\nline two\nline three", "detectedLanguage": "cs-old", "translation": "řádek\ndruhý", "translationLanguage": "cs", "context": "ctx", "glossary": []}`;
    const result = parseOcrJson(raw);
    expect(result.transcription).toBe('line one\nline two\nline three');
    expect(result.translation).toBe('řádek\ndruhý');
  });

  it('fixes unescaped ASCII quotes inside JSON string values', () => {
    // Claude uses Czech „A" where closing " is ASCII U+0022 — breaks JSON
    // The „ is U+201E (ok) but " is U+0022 (ASCII double quote = breaks JSON)
    const raw =
      '{"transcription": "text", "detectedLanguage": "cs-old", "translation": "text", "translationLanguage": "cs", "context": "pojm\u016f za\u010d\u00ednaj\u00edc\u00edch p\u00edsmenem \u201eA". Dal\u0161\u00ed text.", "glossary": []}';
    const result = parseOcrJson(raw);
    expect(result.context).toContain('písmenem');
    expect(result.context).toContain('Další text');
  });

  it('fixes multiple unescaped quotes in a single value', () => {
    const raw =
      '{"transcription": "Řekl: "Ahoj" a pak "Sbohem".", "detectedLanguage": "cs", "translation": "t", "translationLanguage": "cs", "context": "c", "glossary": []}';
    const result = parseOcrJson(raw);
    expect(result.transcription).toContain('Ahoj');
    expect(result.transcription).toContain('Sbohem');
  });
});
