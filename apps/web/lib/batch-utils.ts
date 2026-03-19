const TOKEN_BYTES_RATIO = 750;
const IMAGE_OVERHEAD_TOKENS = 258;
const CHARS_PER_TOKEN = 4;

export function estimateImageTokens(fileSizeBytes: number): number {
  return fileSizeBytes / TOKEN_BYTES_RATIO + IMAGE_OVERHEAD_TOKENS;
}

interface BatchablePage {
  id: string;
  fileSize: number;
}

interface BatchOptions {
  inputTokenBudget: number;
  maxOutputTokens: number;
  avgOutputPerPage: number;
}

export function createBatches<T extends BatchablePage>(
  pages: T[],
  options: BatchOptions,
): T[][] {
  if (pages.length === 0) return [];

  const { inputTokenBudget, maxOutputTokens, avgOutputPerPage } = options;
  const maxPagesByOutput = Math.max(1, Math.floor(maxOutputTokens / avgOutputPerPage));

  const batches: T[][] = [];
  let currentBatch: T[] = [];
  let currentInputTokens = 0;

  for (const page of pages) {
    const pageTokens = estimateImageTokens(page.fileSize);
    const wouldExceedInput = currentBatch.length > 0 && currentInputTokens + pageTokens > inputTokenBudget;
    const wouldExceedOutput = currentBatch.length >= maxPagesByOutput;

    if (wouldExceedInput || wouldExceedOutput) {
      batches.push(currentBatch);
      currentBatch = [];
      currentInputTokens = 0;
    }

    currentBatch.push(page);
    currentInputTokens += pageTokens;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

/**
 * Truncate context text to an approximate token limit.
 * Uses ~4 chars/token heuristic. Returns undefined for empty input.
 */
export function truncateContext(
  text: string | undefined,
  maxTokens: number,
): string | undefined {
  if (!text || text.trim().length === 0) return undefined;
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '…';
}
