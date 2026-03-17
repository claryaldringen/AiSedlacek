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
});
