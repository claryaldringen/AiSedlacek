import type { ImageMediaType, StructuredOcrResult } from './types';

export function detectMediaType(buffer: Buffer): ImageMediaType {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
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
    return JSON.parse(jsonStr) as StructuredOcrResult;
  } catch {
    // Fix common issues in Claude's JSON output:
    // 1. Unescaped newlines/tabs inside string values
    // 2. Unescaped ASCII quotes inside strings (e.g. Czech „A" where " is U+0022)
    //
    // Strategy: rebuild the JSON character by character, tracking whether we're
    // inside a string value, and escaping problematic characters.
    const fixed = fixJsonString(jsonStr);
    return JSON.parse(fixed) as StructuredOcrResult;
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
  let positionalIndex = 0;

  for (const line of lines) {
    if (maxResults !== undefined && results.length >= maxResults) break;
    try {
      const parsed = parseOcrJson(line);
      // Try to extract imageIndex from raw JSON
      let imageIndex: number | undefined;
      try {
        const rawObj = JSON.parse(line.trim().startsWith('{') ? line.trim() : '{}');
        if (typeof rawObj.imageIndex === 'number') {
          imageIndex = rawObj.imageIndex;
        }
      } catch {
        // ignore — use positional fallback
      }
      results.push({ index: imageIndex ?? positionalIndex, result: parsed });
      positionalIndex++;
    } catch {
      // Skip unparseable lines (e.g. extra text from model)
      console.warn('[Claude Batch] Skipping unparseable JSONL line:', line.slice(0, 80));
    }
  }

  return results;
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
