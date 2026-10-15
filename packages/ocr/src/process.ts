import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaFallbackBlock,
  BetaFallbackMessageIterationUsage,
  BetaMessage,
  BetaMessageIterationUsage,
  BetaMessageParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import {
  BATCH_OCR_INSTRUCTION,
  TRANSLATE_ONLY_SYSTEM_PROMPT,
  OCR_EFFORT,
  OCR_MODEL,
} from '@ai-sedlacek/shared';
import { parseOcrJson, parseOcrJsonBatchChecked } from './parse';
import { prepareImage } from './prepare-image';
import type { ImageMediaType, ProcessingMode, StructuredOcrResult } from './types';

export const SYSTEM_PROMPT = `You are an expert in paleography and historical manuscripts. Transcribe the text from this manuscript. Use your knowledge of historical orthography to disambiguate unclear characters (e.g. long ſ looks like f — always transcribe it as s). Then translate the transcribed text fully into the modern standard form of the language the user writes in. Do not summarize — translate the complete text. Preserve all references and citations. Use square brackets to clarify archaic terms or add context a modern reader would need. Then add a brief contextual explanation and a glossary. Respond in the user's language.

IMPORTANT: Return your response as valid JSON with this exact structure:
{
  "transcription": "the transcribed original text in markdown (use headings, bold for initials etc.). Rejoin words broken by line-end hyphens (e.g. 'prá-\\nvem' → 'právem'). Use paragraph breaks, not line-for-line breaks from the source layout.",
  "detectedLanguage": "ISO language code of the original, e.g. cs-old, de-old, la",
  "translation": "full translation in markdown (preserve structure and headings, use paragraph breaks, not line-for-line breaks)",
  "translationLanguage": "ISO code of translation language, e.g. cs, en, de",
  "context": "page-specific context only: identify biblical quotes, literary references, named persons, places, or events mentioned on THIS page. Do NOT repeat general information about the work (author, date, genre) — that is already known from the collection context. Focus on what helps the reader understand this specific page.",
  "glossary": [
    {"term": "term", "definition": "definition"}
  ]
}

Use \\n for newlines inside JSON strings. Return ONLY the JSON object, no markdown fences, no extra text.`;

/**
 * Rezerva výstupních tokenů na jednu stránku dávky. Hustá stránka (přepis, překlad,
 * kontext, glosář) má typicky 2 500–3 500 tokenů; 8 000 pokryje i výjimečně dlouhé
 * stránky. Platí se jen skutečně vygenerované tokeny, štědrý limit nic nestojí.
 */
export const BATCH_OUTPUT_TOKENS_PER_PAGE = 8_000;

/**
 * Rezerva na thinking. Opus 5.5 uvažuje vždy (adaptive) a thinking se počítá do
 * `max_tokens`, i když se jeho text nevrací – bez rezervy by se odpověď ořízla.
 */
export const THINKING_TOKENS_RESERVE = 16_000;

/**
 * Strop `max_tokens` dávky. Opus 5.5 umí až 128k výstupních tokenů (jen se
 * streamingem, který používáme). Dávka má podle `createBatches` ve workeru
 * max. ~6 stránek (16k + 6 × 8k = 64k) – výstup nad 96k by spíš znamenal
 * zacyklení modelu než legitimní obsah.
 */
export const BATCH_MAX_OUTPUT_TOKENS = 96_000;

/** `max_tokens` odvozený od skutečného počtu stránek v dávce (LLM-2) + rezerva na thinking. */
export function batchMaxTokens(pageCount: number): number {
  return Math.min(
    BATCH_MAX_OUTPUT_TOKENS,
    THINKING_TOKENS_RESERVE + BATCH_OUTPUT_TOKENS_PER_PAGE * Math.max(1, pageCount),
  );
}

/** Spotřeba jednoho odmítnutého pokusu volání (model, který ho skutečně zpracoval). */
export interface OcrAttemptUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * Kategorie odmítnutí (`bio`, `cyber`, …; `null` = bez kategorie). Podle ní se
   * rozhoduje, zda se účtuje odmítnutí před výstupem – viz `isRefusalBilled`.
   */
  category: string | null;
}

/** Model požadavek odmítl (safety klasifikátor) a odmítl ho i fallback model. */
export class OcrRefusalError extends Error {
  constructor(
    readonly category: string | null,
    /**
     * Spotřeba pokusu, jehož odmítnutí API vrátilo (top-level `usage` – poslední
     * pokus řetězce, kategorie ze `stop_details`).
     */
    readonly usage: OcrAttemptUsage,
    /** Dřívější odmítnuté pokusy řetězce fallbacku – viz `declinedAttempts()`. */
    readonly declinedAttempts: OcrAttemptUsage[] = [],
  ) {
    super(
      `Model odmítl stránku zpracovat (bezpečnostní filtr${category ? `: ${category}` : ''}). ` +
        'Zkuste to znovu, případně stránku přepište ručně.',
    );
    this.name = 'OcrRefusalError';
  }
}

/**
 * Odmítnuté pokusy serverového fallbacku, které top-level `usage` nepokrývá.
 *
 * Top-level `usage` obsahuje jen pokus, který vrátil zprávu; per-pokus pravdou
 * je `usage.iterations`. Odmítnutý pokus je položka `message` (`model: null`
 * = požadovaný model), pokus fallback modelu, jehož výstup je vrácená zpráva,
 * je `fallback_message`. Vrácenou zprávu vždy vytvoří poslední pokus řetězce –
 * i když odmítnou všechny modely (vrátí se odmítnutí posledního) nebo když se
 * fallback pokus kvůli limitům vůbec neprovede (vrátí se předchozí odmítnutí).
 * OCR nepoužívá serverové nástroje, takže iterace jsou jen pokusy řetězce:
 * všechny položky kromě poslední jsou odmítnuté pokusy, poslední odpovídá
 * top-level `usage`. Platí pro úspěch i pro odmítnutí celého řetězce.
 *
 * Kategorii odmítnutí nese blok `fallback` v `content` (`trigger.category`) –
 * jeden na každý hop, kde model běžel a odmítl, ve stejném pořadí jako iterace.
 */
export function declinedAttempts(message: BetaMessage): OcrAttemptUsage[] {
  const attempts = (message.usage.iterations ?? []).filter(
    (it): it is BetaMessageIterationUsage | BetaFallbackMessageIterationUsage =>
      it.type === 'message' || it.type === 'fallback_message',
  );
  const last = attempts.at(-1);
  if (
    last &&
    (last.input_tokens !== message.usage.input_tokens ||
      last.output_tokens !== message.usage.output_tokens)
  ) {
    // Jen pro diagnostiku – kdyby API přestalo dodržovat popsanou sémantiku.
    console.warn(
      '[Claude] usage.iterations: poslední pokus neodpovídá top-level usage',
      JSON.stringify({ iterations: message.usage.iterations, usage: message.usage }),
    );
  }
  const declined = attempts.slice(0, -1);
  const fallbackBlocks = message.content.filter(
    (block): block is BetaFallbackBlock => block.type === 'fallback',
  );
  if (fallbackBlocks.length !== declined.length) {
    // Bez kategorie se odmítnutí před výstupem neúčtuje (konzervativně vůči uživateli)
    console.warn(
      `[Claude] Počet bloků fallback (${fallbackBlocks.length}) neodpovídá odmítnutým pokusům (${declined.length})`,
    );
  }
  return declined.map((it, i) => ({
    model: it.model ?? OCR_MODEL,
    inputTokens: it.input_tokens,
    outputTokens: it.output_tokens,
    // Veřejná dokumentace blok popisuje jen jako {type, from, to} – `trigger`
    // nemusí přijít (typ pro zpětné posílání ho má jako unknown/null).
    category:
      (fallbackBlocks[i]?.trigger as BetaFallbackBlock['trigger'] | null | undefined)?.category ??
      null,
  }));
}

/** Text odpovědi – jen textové bloky (odpověď Opus 5.5 začíná bloky `thinking`). */
function responseText(message: BetaMessage): string {
  return message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
}

/**
 * Streamovaný OCR požadavek na `OCR_MODEL`. Opus 5.5 má thinking vždy zapnutý
 * (řídí se `effort`) a odmítá `temperature`. Při odmítnutí bezpečnostním
 * klasifikátorem (např. středověké herbáře a receptáře mohou narazit na `bio`)
 * API samo zopakuje požadavek na doporučeném fallback modelu – `finalMessage.model`
 * pak nese model, který skutečně odpověděl (podle něj se účtuje top-level usage),
 * a spotřebu odmítnutých pokusů vrací `declinedAttempts` (účtuje je volající).
 */
async function streamOcrRequest(params: {
  system: string;
  messages: BetaMessageParam[];
  maxTokens: number;
  onText: (text: string) => void;
}): Promise<{ message: BetaMessage; text: string; declinedAttempts: OcrAttemptUsage[] }> {
  const client = new Anthropic();
  let streamed = '';
  const stream = client.beta.messages.stream({
    model: OCR_MODEL,
    max_tokens: params.maxTokens,
    output_config: { effort: OCR_EFFORT },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: params.system,
    messages: params.messages,
  });
  stream.on('text', (text) => {
    streamed += text;
    params.onText(text);
  });
  const message = await stream.finalMessage();
  // Diagnostika fallbacku nesmí zahodit hotový (Anthropicu už zaplacený) výstup.
  let declined: OcrAttemptUsage[] = [];
  try {
    declined = declinedAttempts(message);
  } catch (err) {
    console.error('[Claude] Nelze vyhodnotit odmítnuté pokusy fallbacku:', err);
  }

  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category ?? null;
    throw new OcrRefusalError(
      category,
      {
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        category,
      },
      declined,
    );
  }
  return { message, text: streamed || responseText(message), declinedAttempts: declined };
}

export async function processWithClaude(
  image: Buffer,
  userPrompt: string,
  onProgress?: (outputTokens: number, estimatedTotal: number) => void,
  estimatedOutputTokens?: number,
  previousContext?: string,
  mode: ProcessingMode = 'transcribe+translate',
  language?: string,
): Promise<{
  result: StructuredOcrResult;
  rawResponse: string;
  processingTimeMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Odmítnuté pokusy serverového fallbacku (účtují se zvlášť, viz `declinedAttempts()`). */
  declinedAttempts: OcrAttemptUsage[];
}> {
  const startTime = Date.now();
  const { buffer: imageToSend, mediaType } = await prepareImage(image);

  const estimated = estimatedOutputTokens ?? 1500;
  let streamedLength = 0;

  const {
    message: finalMessage,
    text,
    declinedAttempts: declined,
  } = await streamOcrRequest({
    // Thinking (vždy zapnutý) se počítá do max_tokens – rezerva navíc k odpovědi.
    maxTokens: THINKING_TOKENS_RESERVE + BATCH_OUTPUT_TOKENS_PER_PAGE,
    system: mode === 'translate' ? TRANSLATE_ONLY_SYSTEM_PROMPT : SYSTEM_PROMPT,
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
          ...(previousContext
            ? [
                {
                  type: 'text' as const,
                  text: `${language === 'en' ? 'Context from previous pages of the manuscript:' : 'Kontext z předchozích stránek rukopisu:'}\n${previousContext}`,
                },
              ]
            : []),
          {
            type: 'text',
            text: userPrompt,
          },
        ],
      },
    ],
    onText: (delta) => {
      streamedLength += delta.length;
      onProgress?.(Math.round(streamedLength / 4), estimated);
    },
  });

  console.log(
    '[Claude] Done:',
    JSON.stringify({
      id: finalMessage.id,
      model: finalMessage.model,
      usage: finalMessage.usage,
      stop_reason: finalMessage.stop_reason,
    }),
  );

  const parsed = parseOcrJson(text);

  return {
    result: parsed,
    rawResponse: text,
    processingTimeMs: Date.now() - startTime,
    model: finalMessage.model,
    inputTokens: finalMessage.usage.input_tokens,
    outputTokens: finalMessage.usage.output_tokens,
    declinedAttempts: declined,
  };
}

export async function processWithClaudeBatch(
  images: { buffer: Buffer; pageId: string; index: number }[],
  userPrompt: string,
  options?: {
    previousContext?: string;
    onProgress?: (outputTokens: number, estimatedTotal: number) => void;
    estimatedOutputTokens?: number;
    mode?: ProcessingMode;
    language?: string;
  },
): Promise<{
  results: { index: number; result: StructuredOcrResult }[];
  rawResponse: string;
  processingTimeMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** `stop_reason` odpovědi API (např. `end_turn`, `max_tokens`). */
  stopReason: string | null;
  /** Výstup byl useknut limitem `max_tokens` – chybějící stránky nejsou kompletní. */
  truncated: boolean;
  /** Proč výstup nešlo jednoznačně přiřadit ke stránkám (pak `results` = []), jinak null. */
  parseProblem: string | null;
  /** Odmítnuté pokusy serverového fallbacku (účtují se zvlášť, viz `declinedAttempts()`). */
  declinedAttempts: OcrAttemptUsage[];
}> {
  const startTime = Date.now();

  // Obrázky se připravují postupně, ne paralelně – sharp dekóduje celý obrázek
  // do paměti a několik velkých skenů najednou zbytečně zvedá špičku (PERF-1).
  const preparedImages: ((typeof images)[number] & { mediaType: ImageMediaType })[] = [];
  for (const img of images) {
    const { buffer, mediaType } = await prepareImage(img.buffer);
    preparedImages.push({ ...img, buffer, mediaType });
  }

  // Build content blocks: images first, then text contexts, then prompt
  const content: Array<
    | { type: 'image'; source: { type: 'base64'; media_type: ImageMediaType; data: string } }
    | { type: 'text'; text: string }
  > = [];

  for (const [i, img] of preparedImages.entries()) {
    // Popisek s indexem před každým obrázkem – model nemusí pořadí odvozovat (LLM-3)
    content.push({ type: 'text', text: `imageIndex ${i}:` });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.mediaType,
        data: img.buffer.toString('base64'),
      },
    });
  }

  if (options?.previousContext) {
    const prefix =
      options?.language === 'en'
        ? 'Context from previous pages of the manuscript:'
        : 'Kontext z předchozích stránek rukopisu:';
    content.push({
      type: 'text',
      text: `${prefix}\n${options.previousContext}`,
    });
  }

  content.push({ type: 'text', text: userPrompt });

  const estimated = options?.estimatedOutputTokens ?? 2500 * images.length;
  let streamedLength = 0;
  const maxTokens = batchMaxTokens(images.length);

  const {
    message: finalMessage,
    text,
    declinedAttempts: declined,
  } = await streamOcrRequest({
    maxTokens,
    system:
      (options?.mode === 'translate' ? TRANSLATE_ONLY_SYSTEM_PROMPT : SYSTEM_PROMPT) +
      '\n\n' +
      BATCH_OCR_INSTRUCTION,
    messages: [{ role: 'user', content }],
    onText: (delta) => {
      streamedLength += delta.length;
      options?.onProgress?.(Math.round(streamedLength / 4), estimated);
    },
  });

  console.log(
    '[Claude Batch] Done:',
    JSON.stringify({
      id: finalMessage.id,
      model: finalMessage.model,
      usage: finalMessage.usage,
      stop_reason: finalMessage.stop_reason,
      imageCount: images.length,
      maxTokens,
    }),
  );

  const truncated = finalMessage.stop_reason === 'max_tokens';
  if (truncated) {
    console.warn(
      `[Claude Batch] Output truncated at max_tokens=${maxTokens} (${images.length} images) – incomplete pages will be reported as errors`,
    );
  }

  // Useknutý poslední řádek JSONL se nenaparsuje a parser ho zahodí – vrácené
  // výsledky jsou tedy jen kompletní stránky; o zbytku rozhodne volající.
  const { results, problem: parseProblem } = parseOcrJsonBatchChecked(text, images.length);

  return {
    results,
    rawResponse: text,
    processingTimeMs: Date.now() - startTime,
    model: finalMessage.model,
    inputTokens: finalMessage.usage.input_tokens,
    outputTokens: finalMessage.usage.output_tokens,
    stopReason: finalMessage.stop_reason ?? null,
    truncated,
    parseProblem,
    declinedAttempts: declined,
  };
}
