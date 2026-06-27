import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { requireAuth } from '../lib/require-auth.js';
import * as output from '../lib/output.js';

interface OcrResult {
  transcription?: unknown;
  translation?: unknown;
  detectedLanguage?: unknown;
  translationLanguage?: unknown;
  context?: unknown;
  glossary?: unknown;
  model?: unknown;
  processingTimeMs?: unknown;
}

export const submitCommand = new Command('submit')
  .description('Uložit výsledek OCR rozpoznání pro pending stránku (vytvoří dokument)')
  .argument('<pageId>', 'ID stránky se statusem pending')
  .option('-f, --file <path>', 'Soubor s JSON výsledkem (jinak se čte ze stdin)')
  .addHelpText(
    'after',
    `
Tento příkaz NEVOLÁ žádné LLM/OCR API — rozpoznání udělej sám (v rámci
subscription) a sem jen ulož hotový výsledek. Tím se nepálí placené API tokeny.

Formát JSON (transcription a translation jsou povinné):
  {
    "transcription": "...",
    "translation": "...",
    "detectedLanguage": "la",
    "translationLanguage": "cs",
    "context": "...",
    "glossary": [{ "term": "...", "definition": "..." }]
  }

Příklady:
  ais submit <pageId> -f result.json
  cat result.json | ais submit <pageId>
`,
  )
  .action(async (pageId: string, options: { file?: string }) => {
    const { api } = requireAuth();

    let raw: string;
    try {
      // fd 0 = stdin, když není zadán soubor
      raw = readFileSync(options.file ?? 0, 'utf8');
    } catch (e: unknown) {
      output.error(`Nepodařilo se načíst vstup: ${(e as Error).message}`);
      process.exit(1);
    }

    let parsed: OcrResult;
    try {
      parsed = JSON.parse(raw) as OcrResult;
    } catch {
      output.error('Vstup není platný JSON.');
      process.exit(1);
    }

    if (typeof parsed.transcription !== 'string' || parsed.transcription.trim() === '') {
      output.error('JSON musí obsahovat neprázdné "transcription".');
      process.exit(1);
    }
    if (typeof parsed.translation !== 'string' || parsed.translation.trim() === '') {
      output.error('JSON musí obsahovat neprázdné "translation".');
      process.exit(1);
    }

    try {
      const res = await api.postJson(`/api/pages/${pageId}/result`, {
        transcription: parsed.transcription,
        translation: parsed.translation,
        detectedLanguage: parsed.detectedLanguage,
        translationLanguage: parsed.translationLanguage,
        context: parsed.context,
        glossary: parsed.glossary,
        model: typeof parsed.model === 'string' ? parsed.model : 'claude-agent-cli',
        processingTimeMs: parsed.processingTimeMs,
      });
      output.success(`Uloženo — dokument ${res.documentId}, stránka ${pageId} → ${res.status}.`);
    } catch (e: unknown) {
      output.error((e as Error).message);
      process.exit(1);
    }
  });
