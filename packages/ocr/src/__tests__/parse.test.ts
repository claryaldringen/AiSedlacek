import { describe, it, expect } from 'vitest';
import {
  detectMediaType,
  sniffMediaType,
  parseOcrJson,
  parseOcrJsonBatch,
  parseOcrJsonBatchChecked,
} from '../parse.js';

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
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(detectMediaType(buf)).toBe('image/jpeg');
  });

  it('detects PNG from magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectMediaType(buf)).toBe('image/png');
  });

  it('detects WebP from magic bytes', () => {
    const buf = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP', 'latin1'),
    ]);
    expect(detectMediaType(buf)).toBe('image/webp');
  });

  it('detects GIF from magic bytes', () => {
    const buf = Buffer.from('GIF89a', 'latin1');
    expect(detectMediaType(buf)).toBe('image/gif');
  });

  // LLM-1: dřív se pro neznámý formát tiše vracelo image/jpeg
  it('throws for TIFF instead of claiming image/jpeg', () => {
    const littleEndian = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
    const bigEndian = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);
    expect(() => detectMediaType(littleEndian)).toThrow(/Nepodporovaný formát/);
    expect(() => detectMediaType(bigEndian)).toThrow(/Nepodporovaný formát/);
  });

  it('throws for unknown magic bytes', () => {
    expect(() => detectMediaType(Buffer.from([0x00, 0x00, 0x00, 0x00]))).toThrow();
  });

  it('does not treat a non-WebP RIFF file (e.g. WAV) as WebP', () => {
    const wav = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WAVE', 'latin1'),
    ]);
    expect(sniffMediaType(wav)).toBeNull();
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

describe('parseOcrJsonBatch', () => {
  const makeResult = (index: number) => ({
    imageIndex: index,
    transcription: `text ${index}`,
    detectedLanguage: 'la',
    translation: `překlad ${index}`,
    translationLanguage: 'cs',
    context: `kontext ${index}`,
    glossary: [{ term: 'foo', definition: 'bar' }],
  });

  it('parses valid JSONL with multiple lines', () => {
    const input = `${JSON.stringify(makeResult(0))}\n${JSON.stringify(makeResult(1))}`;
    const results = parseOcrJsonBatch(input);
    expect(results).toHaveLength(2);
    expect(results[0]!.index).toBe(0);
    expect(results[1]!.index).toBe(1);
    expect(results[0]!.result.transcription).toBe('text 0');
  });

  it('skips invalid lines and parses the rest', () => {
    const input = `${JSON.stringify(makeResult(0))}\nNOT VALID JSON\n${JSON.stringify(makeResult(2))}`;
    const results = parseOcrJsonBatch(input);
    expect(results).toHaveLength(2);
    expect(results[0]!.index).toBe(0);
    expect(results[1]!.index).toBe(2);
  });

  it('falls back to positional index if imageIndex is missing', () => {
    const noIndex = {
      transcription: 'text',
      detectedLanguage: 'la',
      translation: 'překlad',
      translationLanguage: 'cs',
      context: '',
      glossary: [],
    };
    const input = `${JSON.stringify(noIndex)}\n${JSON.stringify(noIndex)}`;
    const results = parseOcrJsonBatch(input);
    expect(results[0]!.index).toBe(0);
    expect(results[1]!.index).toBe(1);
  });

  it('handles markdown fences around JSONL', () => {
    const input =
      '```json\n' + JSON.stringify(makeResult(0)) + '\n' + JSON.stringify(makeResult(1)) + '\n```';
    const results = parseOcrJsonBatch(input);
    expect(results).toHaveLength(2);
  });

  it('handles single result (1-page batch)', () => {
    const input = JSON.stringify(makeResult(0));
    const results = parseOcrJsonBatch(input);
    expect(results).toHaveLength(1);
  });

  it('returns empty array for completely invalid input', () => {
    const results = parseOcrJsonBatch('totally broken');
    expect(results).toHaveLength(0);
  });

  // LLM-3: víc výsledků než obrázků (index mimo rozsah) je podezřelé – dřív se
  // výsledky tiše ořízly, nově se dávka odmítne
  it('rejects more results than images (index out of range)', () => {
    const input = `${JSON.stringify(makeResult(0))}\n${JSON.stringify(makeResult(1))}\n${JSON.stringify(makeResult(2))}`;
    const { results, problem } = parseOcrJsonBatchChecked(input, 2);
    expect(results).toHaveLength(0);
    expect(problem).toMatch(/nelze jednoznačně přiřadit/);
  });

  // LLM-3: bez imageIndex a s nečitelným řádkem nejde poznat, které stránce který
  // výsledek patří (rozbitý řádek může být i jedna stránka rozdělená na dva řádky)
  it('rejects unindexed results when their count does not match the image count', () => {
    const noIndex = {
      transcription: 'a',
      detectedLanguage: 'la',
      translation: 'b',
      translationLanguage: 'cs',
      context: '',
      glossary: [],
    };
    const input = `${JSON.stringify(noIndex)}\nBROKEN\n${JSON.stringify(noIndex)}`;
    const { results, problem } = parseOcrJsonBatchChecked(input, 3);
    expect(results).toHaveLength(0);
    expect(problem).toMatch(/neuvedl imageIndex/);
  });

  it('rejects an out-of-range imageIndex instead of falling back to position', () => {
    const bad = { ...makeResult(0), imageIndex: 99 };
    const { results, problem } = parseOcrJsonBatchChecked(JSON.stringify(bad), 3);
    expect(results).toHaveLength(0);
    expect(problem).toMatch(/mimo očekávané číslování/);
  });

  it('rejects duplicate imageIndex instead of falling back to position', () => {
    const a = makeResult(0);
    const b = { ...makeResult(0), transcription: 'jiná stránka' }; // also imageIndex 0
    const { results, problem } = parseOcrJsonBatchChecked(
      `${JSON.stringify(a)}\n${JSON.stringify(b)}`,
      2,
    );
    expect(results).toHaveLength(0);
    expect(problem).toMatch(/duplicitní imageIndex/);
  });

  it('remaps a complete 1-based numbering (1..n) to 0..n-1', () => {
    // Model číslující od 1: dřív se přepis stránky A uložil ke stránce B
    const lines = [1, 2, 3].map((i) =>
      JSON.stringify({ ...makeResult(i), transcription: `stránka ${i - 1}` }),
    );
    const { results, problem } = parseOcrJsonBatchChecked(lines.join('\n'), 3);
    expect(problem).toBeNull();
    expect(results.map((r) => [r.index, r.result.transcription])).toEqual([
      [0, 'stránka 0'],
      [1, 'stránka 1'],
      [2, 'stránka 2'],
    ]);
  });

  it('rejects an incomplete 1-based numbering (1..k, k < n) as ambiguous', () => {
    // {1, 2} pro 3 obrázky: číslování od 1 bez poslední stránky, nebo od 0 bez první?
    const input = `${JSON.stringify(makeResult(1))}\n${JSON.stringify(makeResult(2))}`;
    const { results, problem } = parseOcrJsonBatchChecked(input, 3);
    expect(results).toHaveLength(0);
    expect(problem).not.toBeNull();
  });

  it('accepts a 0-based prefix when the output is incomplete (e.g. truncated)', () => {
    const input = `${JSON.stringify(makeResult(0))}\n${JSON.stringify(makeResult(1))}\n{"imageIndex": 2, "transcr`;
    const { results, problem } = parseOcrJsonBatchChecked(input, 3);
    expect(problem).toBeNull();
    expect(results.map((r) => r.index)).toEqual([0, 1]);
  });

  it('is not shifted by an introductory text line', () => {
    const input = `Zde jsou výsledky:\n${JSON.stringify(makeResult(0))}\n${JSON.stringify(makeResult(1))}`;
    const { results, problem } = parseOcrJsonBatchChecked(input, 2);
    expect(problem).toBeNull();
    expect(results.map((r) => [r.index, r.result.transcription])).toEqual([
      [0, 'text 0'],
      [1, 'text 1'],
    ]);
  });

  it('drops a line without imageIndex among indexed lines instead of guessing its page', () => {
    const { imageIndex: _omit, ...noIndex } = makeResult(1);
    void _omit;
    const input = [makeResult(0), noIndex, makeResult(2)].map((o) => JSON.stringify(o)).join('\n');
    const { results, problem } = parseOcrJsonBatchChecked(input, 3);
    expect(problem).toBeNull();
    // Stránka 1 zůstane bez výsledku (chyba), nikdo nedostane dva výsledky
    expect(results.map((r) => r.index)).toEqual([0, 2]);
  });

  it('keeps imageIndex of a line that needed JSON repair (unescaped quote)', () => {
    // Dřív se index zjišťoval druhým JSON.parse bez opravy → ztratil se a použila se
    // pozice řádku; tady by se tak výsledky stránek 0 a 1 prohodily
    const repaired =
      '{"imageIndex": 1, "transcription": "Řekl: "Ahoj".", "detectedLanguage": "la", "translation": "t", "translationLanguage": "cs", "context": "", "glossary": []}';
    const input = `${repaired}\n${JSON.stringify(makeResult(0))}`;
    const { results, problem } = parseOcrJsonBatchChecked(input, 2);
    expect(problem).toBeNull();
    expect(results.find((r) => r.index === 1)?.result.transcription).toContain('Ahoj');
    expect(results.find((r) => r.index === 0)?.result.transcription).toBe('text 0');
    expect(results).toHaveLength(2);
  });

  it('accepts unindexed results only when their count matches the image count', () => {
    const { imageIndex: _a, ...p0 } = makeResult(0);
    const { imageIndex: _b, ...p1 } = makeResult(1);
    void _a;
    void _b;
    const { results, problem } = parseOcrJsonBatchChecked(
      `${JSON.stringify(p0)}\n${JSON.stringify(p1)}`,
      2,
    );
    expect(problem).toBeNull();
    expect(results.map((r) => [r.index, r.result.transcription])).toEqual([
      [0, 'text 0'],
      [1, 'text 1'],
    ]);
  });

  it('parseOcrJsonBatch returns no results for ambiguous output', () => {
    const a = makeResult(0);
    expect(parseOcrJsonBatch(`${JSON.stringify(a)}\n${JSON.stringify(a)}`, 2)).toEqual([]);
  });

  it('falls back to parsing a pretty-printed JSON array (not JSONL)', () => {
    const arr = [makeResult(0), makeResult(1)];
    const input = JSON.stringify(arr, null, 2); // multi-line array, not one-object-per-line
    const results = parseOcrJsonBatch(input);
    expect(results).toHaveLength(2);
    expect(results[0]!.result.transcription).toBe('text 0');
  });
});

describe('parseOcrJson normalization', () => {
  it('defaults a missing glossary to an empty array', () => {
    const raw = JSON.stringify({
      transcription: 't',
      detectedLanguage: 'la',
      translation: 'x',
      translationLanguage: 'cs',
      context: 'c',
      // glossary omitted
    });
    const result = parseOcrJson(raw);
    expect(result.glossary).toEqual([]);
  });

  it('drops malformed glossary entries', () => {
    const raw = JSON.stringify({
      transcription: 't',
      detectedLanguage: 'la',
      translation: 'x',
      translationLanguage: 'cs',
      context: 'c',
      glossary: [{ term: 'ok', definition: 'd' }, { term: 'bad' }, null],
    });
    const result = parseOcrJson(raw);
    expect(result.glossary).toEqual([{ term: 'ok', definition: 'd' }]);
  });
});
