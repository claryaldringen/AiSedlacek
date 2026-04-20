import { Command } from 'commander';
import ora from 'ora';
import { processWithClaudeCli, prepareImage } from '@ai-sedlacek/ocr';
import { requireAuth } from '../lib/require-auth.js';
import * as output from '../lib/output.js';

export const processCommand = new Command('process')
  .description('Zpracovat stránky lokálním OCR (claude CLI)')
  .argument('[pageIds...]', 'ID stránek ke zpracování')
  .option('-c, --collection <id>', 'Zpracovat celou kolekci')
  .option('-a, --all', 'Zpracovat všechny pending stránky')
  .option('-l, --language <lang>', 'Cílový jazyk překladu', 'cs')
  .action(async (pageIds: string[], options) => {
    const { api } = requireAuth();

    // Resolve page IDs
    let ids = pageIds;
    if (options.collection) {
      const collection = await api.get(`/api/collections/${options.collection}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ids = collection.pages.filter((p: any) => p.status === 'pending').map((p: any) => p.id);
    } else if (options.all) {
      const pages = await api.get('/api/pages?status=pending');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ids = (pages.pages ?? pages).map((p: any) => p.id);
    }

    if (ids.length === 0) {
      output.warn('Žádné stránky ke zpracování.');
      return;
    }

    output.info(`Zpracovávám ${ids.length} stránek...`);

    for (let i = 0; i < ids.length; i++) {
      const pageId = ids[i];
      const spinner = ora(`[${i + 1}/${ids.length}] Stránka ${pageId}...`).start();

      try {
        // Get page info
        const page = await api.get(`/api/pages/${pageId}`);
        if (page.status === 'done') {
          spinner.succeed(`[${i + 1}/${ids.length}] Stránka ${pageId} — již zpracována`);
          continue;
        }

        // Download image
        spinner.text = `[${i + 1}/${ids.length}] Stahuji obrázek...`;
        const imageUrl = page.imageUrl.replace(/^\/uploads\//, '');
        const imageRes = await api.getRaw(`/api/images/${imageUrl}`);
        if (!imageRes.ok) throw new Error('Nelze stáhnout obrázek');
        const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

        // Prepare image (resize if needed)
        spinner.text = `[${i + 1}/${ids.length}] Zpracovávám přes Claude CLI...`;
        const { buffer: prepared } = await prepareImage(imageBuffer);

        // Run local OCR
        const { result, processingTimeMs, model } = await processWithClaudeCli(
          prepared,
          'Přepiš text z tohoto rukopisu.',
          undefined,
          undefined,
          undefined,
          'transcribe+translate',
          options.language,
        );

        // Upload results to server
        spinner.text = `[${i + 1}/${ids.length}] Odesílám výsledky...`;
        await api.postJson(`/api/pages/${pageId}/result`, {
          ...result,
          model,
          processingTimeMs,
        });

        spinner.succeed(
          `[${i + 1}/${ids.length}] ${page.filename} — hotovo (${result.detectedLanguage} → ${result.translationLanguage})`,
        );
      } catch (e: unknown) {
        spinner.fail(`[${i + 1}/${ids.length}] Stránka ${pageId} — ${(e as Error).message}`);
      }
    }

    output.info('Zpracování dokončeno.');
  });
