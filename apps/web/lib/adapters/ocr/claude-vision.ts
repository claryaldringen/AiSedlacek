import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

export function detectMediaType(buffer: Buffer): ImageMediaType {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return 'image/webp';
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
  return 'image/jpeg';
}

const SYSTEM_PROMPT = `You are an expert in paleography and historical manuscripts. Transcribe the text from this manuscript. Use your knowledge of historical orthography to disambiguate unclear characters (e.g. long ſ looks like f — always transcribe it as s). Then translate the transcribed text fully into the modern standard form of the language the user writes in. Do not summarize — translate the complete text. Preserve all references and citations. Use square brackets to clarify archaic terms or add context a modern reader would need. Then add a brief contextual explanation and a glossary. Respond in the user's language.

IMPORTANT: Return your response as valid JSON with this exact structure:
{
  "transcription": "the transcribed original text in markdown (preserve line breaks, use headings, bold for initials etc.)",
  "detectedLanguage": "ISO language code of the original, e.g. cs-old, de-old, la",
  "translation": "full translation in markdown (preserve structure, headings, line breaks matching the original)",
  "translationLanguage": "ISO code of translation language, e.g. cs, en, de",
  "context": "brief contextual explanation in markdown",
  "glossary": [
    {"term": "term", "definition": "definition"}
  ]
}

Use \\n for newlines inside JSON strings. Return ONLY the JSON object, no markdown fences, no extra text.`;

export interface StructuredOcrResult {
  transcription: string;
  detectedLanguage: string;
  translation: string;
  translationLanguage: string;
  context: string;
  glossary: { term: string; definition: string }[];
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
      // Look ahead: if after optional whitespace we see : , ] } or end-of-string,
      // it's a real string terminator.
      const rest = json.slice(i + 1);
      const afterQuote = rest.match(/^\s*([,:\]}\n]|$)/);
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

async function prepareImage(image: Buffer): Promise<{ buffer: Buffer; mediaType: ImageMediaType }> {
  const MAX_BYTES = 5 * 1024 * 1024;
  let imageToSend = image;

  if (image.length > MAX_BYTES) {
    console.log(`[Claude] Image too large (${(image.length / 1024 / 1024).toFixed(1)} MB), resizing…`);
    imageToSend = await sharp(image)
      .resize({ width: 3000, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    if (imageToSend.length > MAX_BYTES) {
      imageToSend = await sharp(image)
        .resize({ width: 2000, withoutEnlargement: true })
        .jpeg({ quality: 75 })
        .toBuffer();
    }
    console.log(`[Claude] Resized to ${(imageToSend.length / 1024 / 1024).toFixed(1)} MB`);
  }

  return { buffer: imageToSend, mediaType: detectMediaType(imageToSend) };
}

export async function processWithClaude(
  image: Buffer,
  userPrompt: string,
  onProgress?: (outputTokens: number, estimatedTotal: number) => void,
  estimatedOutputTokens?: number,
): Promise<{
  result: StructuredOcrResult;
  rawResponse: string;
  processingTimeMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const startTime = Date.now();
  const client = new Anthropic();
  const { buffer: imageToSend, mediaType } = await prepareImage(image);

  const estimated = estimatedOutputTokens ?? 1500;
  let currentTokens = 0;
  let fullText = '';

  const stream = client.messages.stream({
    model: 'claude-opus-4-6',
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: imageToSend.toString('base64'),
            },
          },
          {
            type: 'text',
            text: userPrompt,
          },
        ],
      },
    ],
  });

  stream.on('text', (text) => {
    fullText += text;
    // Rough estimate: ~4 chars per token
    currentTokens = Math.round(fullText.length / 4);
    onProgress?.(currentTokens, estimated);
  });

  const finalMessage = await stream.finalMessage();

  console.log(
    '[Claude] Done:',
    JSON.stringify({
      id: finalMessage.id,
      model: finalMessage.model,
      usage: finalMessage.usage,
      stop_reason: finalMessage.stop_reason,
    }),
  );

  const text = fullText || (finalMessage.content[0]?.type === 'text' ? finalMessage.content[0].text : '');

  let parsed: StructuredOcrResult;
  try {
    parsed = parseOcrJson(text);
  } catch (err) {
    console.error('[Claude] JSON parse failed. Raw response saved to /tmp/claude-raw-response.txt');
    const fs = await import('fs/promises');
    await fs.writeFile('/tmp/claude-raw-response.txt', text, 'utf-8');
    throw err;
  }

  return {
    result: parsed,
    rawResponse: text,
    processingTimeMs: Date.now() - startTime,
    model: finalMessage.model,
    inputTokens: finalMessage.usage.input_tokens,
    outputTokens: finalMessage.usage.output_tokens,
  };
}
