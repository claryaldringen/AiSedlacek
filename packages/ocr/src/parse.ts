import type { ImageMediaType, StructuredOcrResult } from './types';

export function detectMediaType(buffer: Buffer): ImageMediaType {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
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
    return normalizeOcrResult(JSON.parse(jsonStr));
  } catch {
    // Fix common issues in Claude's JSON output:
    // 1. Unescaped newlines/tabs inside string values
    // 2. Unescaped ASCII quotes inside strings (e.g. Czech „A" where " is U+0022)
    //
    // Strategy: rebuild the JSON character by character, tracking whether we're
    // inside a string value, and escaping problematic characters.
    const fixed = fixJsonString(jsonStr);
    return normalizeOcrResult(JSON.parse(fixed));
  }
}

export function parseOcrJsonBatch(
  raw: string,
  maxResults?: number,
): { index: number; result: StructuredOcrResult }[] {
  let text = raw.trim();

  // Strip markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    text = fenceMatch[1] ?? text;
  }

  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  const results: { index: number; result: StructuredOcrResult }[] = [];
  const usedIndices = new Set<number>();
  let positionalIndex = 0;

  const indexIsUsable = (n: number): boolean =>
    Number.isInteger(n) &&
    n >= 0 &&
    (maxResults === undefined || n < maxResults) &&
    !usedIndices.has(n);

  for (const line of lines) {
    if (maxResults !== undefined && results.length >= maxResults) break;
    // Advance the positional counter for EVERY line, even ones that fail to parse,
    // so a single bad line doesn't shift every subsequent page onto the wrong index.
    const pos = positionalIndex;
    positionalIndex++;
    try {
      const parsed = parseOcrJson(line);
      // Trust the model's imageIndex only if it's a valid, in-range, not-yet-used
      // slot; otherwise fall back to position. A bogus/duplicate index would
      // otherwise save one page's result onto another page.
      let imageIndex: number | undefined;
      try {
        const rawObj = JSON.parse(line.trim().startsWith('{') ? line.trim() : '{}');
        if (typeof rawObj.imageIndex === 'number' && indexIsUsable(rawObj.imageIndex)) {
          imageIndex = rawObj.imageIndex;
        }
      } catch {
        // ignore — use positional fallback
      }
      const idx = imageIndex ?? pos;
      usedIndices.add(idx);
      results.push({ index: idx, result: parsed });
    } catch {
      // Skip unparseable lines (e.g. extra text from model)
      console.warn('[Claude Batch] Skipping unparseable JSONL line:', line.slice(0, 80));
    }
  }

  // Fallback: line-based parsing found nothing, but the model may have returned a
  // single pretty-printed JSON array/object instead of JSONL. Parse the whole
  // block so the batch isn't silently lost (while still having been billed).
  if (results.length === 0) {
    try {
      const parsed = JSON.parse(extractJsonBlock(text)) as unknown;
      const arr: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { results?: unknown[] })?.results)
          ? (parsed as { results: unknown[] }).results
          : [parsed];
      arr.forEach((obj, i) => {
        if (maxResults !== undefined && results.length >= maxResults) return;
        const rawIdx = (obj as { imageIndex?: unknown })?.imageIndex;
        const idx = typeof rawIdx === 'number' && indexIsUsable(rawIdx) ? rawIdx : i;
        usedIndices.add(idx);
        results.push({ index: idx, result: normalizeOcrResult(obj) });
      });
    } catch {
      // genuinely unparseable — return the empty result set
    }
  }

  return results;
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
