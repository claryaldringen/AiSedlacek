import type { ImageMediaType, StructuredOcrResult } from './types';

/**
 * Rozpozná podle magic bytes formát obrázku, který přijímá Claude API
 * (JPEG, PNG, WebP, GIF). Pro cokoli jiného (TIFF, HEIC, neznámá data) vrací null.
 */
export function sniffMediaType(buffer: Buffer): ImageMediaType | null {
  const ascii = (start: number, end: number): string =>
    buffer.subarray(start, end).toString('latin1');
  if (buffer.length >= 4 && buffer[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (buffer.length >= 4 && ascii(0, 4) === 'GIF8') return 'image/gif';
  return null;
}

/**
 * Media type obrázku pro Claude API. Pro nepodporovaný formát vyhodí chybu – dřív
 * tiše vracel `image/jpeg`, takže např. TIFF odešel s chybným typem a API odmítlo
 * celou dávku (LLM-1). Nepodporované formáty převádí `prepareImage`.
 */
export function detectMediaType(buffer: Buffer): ImageMediaType {
  const mediaType = sniffMediaType(buffer);
  if (!mediaType) {
    throw new Error(
      'Nepodporovaný formát obrázku pro Claude API (podporované: JPEG, PNG, WebP, GIF)',
    );
  }
  return mediaType;
}

/**
 * Coerce an arbitrary parsed object into a well-formed StructuredOcrResult.
 * Missing/typed-wrong fields get safe defaults so downstream consumers never
 * crash on e.g. `result.glossary.map(...)` when the model omits glossary.
 */
export function normalizeOcrResult(obj: unknown): StructuredOcrResult {
  const o = (obj ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const glossary = Array.isArray(o.glossary)
    ? (o.glossary as unknown[]).filter(
        (g): g is { term: string; definition: string } =>
          !!g &&
          typeof (g as { term?: unknown }).term === 'string' &&
          typeof (g as { definition?: unknown }).definition === 'string',
      )
    : [];
  return {
    transcription: str(o.transcription),
    detectedLanguage: str(o.detectedLanguage),
    translation: str(o.translation),
    translationLanguage: str(o.translationLanguage),
    context: str(o.context),
    glossary,
  };
}

export function parseOcrJson(raw: string): StructuredOcrResult {
  return normalizeOcrResult(parseJsonObjectLenient(raw));
}

/**
 * Naparsuje JSON objekt z výstupu modelu (odstraní ```json ploty a okolní text,
 * opraví neescapované znaky). Vrací surový objekt – včetně polí mimo
 * StructuredOcrResult, např. `imageIndex`.
 */
function parseJsonObjectLenient(raw: string): unknown {
  let jsonStr = raw.trim();
  // Strip ```json ... ``` fences
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1] ?? jsonStr;
  }
  // Extract JSON object if surrounded by extra text
  if (!jsonStr.startsWith('{')) {
    const braceStart = jsonStr.indexOf('{');
    const braceEnd = jsonStr.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd !== -1) {
      jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
    }
  }
  // Try parsing as-is first
  try {
    return JSON.parse(jsonStr);
  } catch {
    // Fix common issues in Claude's JSON output:
    // 1. Unescaped newlines/tabs inside string values
    // 2. Unescaped ASCII quotes inside strings (e.g. Czech „A" where " is U+0022)
    //
    // Strategy: rebuild the JSON character by character, tracking whether we're
    // inside a string value, and escaping problematic characters.
    const fixed = fixJsonString(jsonStr);
    return JSON.parse(fixed);
  }
}

export interface OcrBatchParseResult {
  results: { index: number; result: StructuredOcrResult }[];
  /**
   * Proč výstup nešlo jednoznačně přiřadit ke stránkám (pak je `results` prázdné),
   * jinak null. Chybějící výsledky jednotlivých stránek problémem nejsou.
   */
  problem: string | null;
}

interface BatchEntry {
  declaredIndex: number | undefined;
  result: StructuredOcrResult;
}

/** `imageIndex` z objektu výstupu – celé číslo (i jako řetězec „2"), jinak undefined. */
function readImageIndex(obj: unknown): number | undefined {
  const raw = (obj as { imageIndex?: unknown } | null)?.imageIndex;
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return undefined;
}

/**
 * Rozparsuje JSONL výstup dávky a přiřadí výsledky k obrázkům.
 *
 * LLM-3: dřív se `imageIndex` bral, jen když byl v rozsahu a volný, jinak se použilo
 * pořadí řádku – model číslující od 1, úvodní řádek nebo chybějící index tak tiše
 * uložil přepis jedné stránky k jiné. Nově se výsledky přijmou jen při
 * jednoznačném přiřazení:
 *  - indexy jsou unikátní, v rozsahu 0..n-1 a obsahují 0 (číslování od 0; chybějící
 *    stránky – např. při useknutí výstupu – skončí jako stránky bez výsledku),
 *  - nebo jsou přesně 1..n (model číslo od 1) → posun o -1,
 *  - nebo model indexy neuvedl vůbec a počet výsledků přesně odpovídá počtu obrázků
 *    (pořadí podle instrukce „in the same order as the images").
 * Řádky bez indexu mezi řádky s indexem se zahodí (jejich stránka zůstane bez
 * výsledku). Cokoli jiného (duplicity, indexy mimo rozsah, 1..k u neúplného výstupu)
 * je nejednoznačné → žádné výsledky a `problem` s popisem.
 *
 * @param expectedCount počet obrázků v dávce (bez něj se neověřuje horní mez)
 */
export function parseOcrJsonBatchChecked(raw: string, expectedCount?: number): OcrBatchParseResult {
  let text = raw.trim();

  // Strip markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1] ?? text;
  }

  const entries: BatchEntry[] = [];
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  for (const line of lines) {
    try {
      const obj = parseJsonObjectLenient(line);
      entries.push({ declaredIndex: readImageIndex(obj), result: normalizeOcrResult(obj) });
    } catch {
      // Skip unparseable lines (e.g. extra text from model, truncated last line)
      console.warn('[Claude Batch] Skipping unparseable JSONL line:', line.slice(0, 80));
    }
  }

  // Fallback: line-based parsing found nothing, but the model may have returned a
  // single pretty-printed JSON array/object instead of JSONL. Parse the whole
  // block so the batch isn't silently lost (while still having been billed).
  if (entries.length === 0) {
    try {
      const parsed = JSON.parse(extractJsonBlock(text)) as unknown;
      const arr: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { results?: unknown[] })?.results)
          ? (parsed as { results: unknown[] }).results
          : [parsed];
      for (const obj of arr) {
        entries.push({ declaredIndex: readImageIndex(obj), result: normalizeOcrResult(obj) });
      }
    } catch {
      // genuinely unparseable — return the empty result set
    }
  }

  return assignBatchIndices(entries, expectedCount);
}

function assignBatchIndices(entries: BatchEntry[], n: number | undefined): OcrBatchParseResult {
  if (entries.length === 0) return { results: [], problem: null };

  const reject = (problem: string): OcrBatchParseResult => {
    console.warn(`[Claude Batch] Rejecting batch output: ${problem}`);
    return { results: [], problem };
  };
  const expected = n !== undefined ? ` pro ${n} obrázků` : '';

  const declared = entries.filter((e) => e.declaredIndex !== undefined);

  if (declared.length === 0) {
    if (n === undefined || entries.length === n) {
      return { results: entries.map((e, i) => ({ index: i, result: e.result })), problem: null };
    }
    return reject(
      `Model neuvedl imageIndex a vrátil ${entries.length} výsledků${expected} – nelze je jednoznačně přiřadit ke stránkám`,
    );
  }

  if (declared.length < entries.length) {
    console.warn(
      `[Claude Batch] Dropping ${entries.length - declared.length} result(s) without imageIndex`,
    );
  }

  const indices = declared.map((e) => e.declaredIndex!);
  if (new Set(indices).size !== indices.length) {
    return reject(
      `Model vrátil duplicitní imageIndex (${indices.join(', ')}) – výsledky nelze jednoznačně přiřadit ke stránkám`,
    );
  }

  const zeroBased =
    indices.includes(0) && indices.every((i) => i >= 0 && (n === undefined || i < n));
  if (zeroBased) {
    return {
      results: declared.map((e) => ({ index: e.declaredIndex!, result: e.result })),
      problem: null,
    };
  }

  // Číslování od 1 přijmeme jen v úplné podobě 1..n – u neúplného výstupu (1..k)
  // nejde odlišit od číslování od 0 s chybějící první stránkou.
  const oneBased =
    n !== undefined && indices.length === n && indices.every((i) => i >= 1 && i <= n);
  if (oneBased) {
    console.warn('[Claude Batch] Model numbered images from 1 – remapping imageIndex to 0-based');
    return {
      results: declared.map((e) => ({ index: e.declaredIndex! - 1, result: e.result })),
      problem: null,
    };
  }

  return reject(
    `Model vrátil imageIndex mimo očekávané číslování (${indices.join(', ')})${expected} – výsledky nelze jednoznačně přiřadit ke stránkám`,
  );
}

/**
 * Zpětně kompatibilní varianta `parseOcrJsonBatchChecked` – vrací jen přiřazené
 * výsledky (při nejednoznačném výstupu prázdné pole).
 */
export function parseOcrJsonBatch(
  raw: string,
  expectedCount?: number,
): { index: number; result: StructuredOcrResult }[] {
  return parseOcrJsonBatchChecked(raw, expectedCount).results;
}

/** Extract the first {...} or [...] block from text (else return text as-is). */
function extractJsonBlock(text: string): string {
  const firstObj = text.indexOf('{');
  const firstArr = text.indexOf('[');
  let start = -1;
  let isArray = false;
  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    start = firstArr;
    isArray = true;
  } else if (firstObj !== -1) {
    start = firstObj;
  }
  if (start === -1) return text;
  const end = isArray ? text.lastIndexOf(']') : text.lastIndexOf('}');
  return end > start ? text.slice(start, end + 1) : text;
}

/**
 * Fix broken JSON from LLM output by escaping unescaped characters inside string values.
 * Handles: literal newlines, tabs, and unescaped ASCII quotes (e.g. Czech „A" uses U+0022).
 */
function fixJsonString(json: string): string {
  const out: string[] = [];
  let inString = false;
  let i = 0;

  while (i < json.length) {
    const ch = json[i]!;

    if (!inString) {
      out.push(ch);
      if (ch === '"') inString = true;
      i++;
      continue;
    }

    // Inside a string
    if (ch === '\\') {
      // Escaped character — pass through both chars
      out.push(ch);
      i++;
      if (i < json.length) {
        out.push(json[i]!);
        i++;
      }
      continue;
    }

    if (ch === '"') {
      // Is this the real end of the string, or an unescaped quote inside it?
      // Look ahead: if after optional whitespace we see a structural JSON token,
      // it's a real string terminator. For comma, require it to be followed by
      // another JSON value start (", [, {, digit) — not plain text like ", tj."
      const rest = json.slice(i + 1);
      const afterQuote = rest.match(/^\s*([:}\]\n]|,\s*["{\[\d]|$)/);
      if (afterQuote) {
        // Real end of string
        out.push(ch);
        inString = false;
        i++;
        continue;
      }
      // Unescaped quote inside string — escape it
      out.push('\\"');
      i++;
      continue;
    }

    if (ch === '\n') {
      out.push('\\n');
      i++;
      continue;
    }
    if (ch === '\r') {
      out.push('\\r');
      i++;
      continue;
    }
    if (ch === '\t') {
      out.push('\\t');
      i++;
      continue;
    }

    out.push(ch);
    i++;
  }

  return out.join('');
}
