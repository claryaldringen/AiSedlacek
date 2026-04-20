import { Command } from 'commander';
import ora from 'ora';
import { requireAuth } from '../lib/require-auth.js';
import { writePageFiles } from '../lib/workspace.js';
import * as output from '../lib/output.js';

export const pullCommand = new Command('pull')
  .description('Stáhnout dokumenty do lokálního workspace')
  .argument('[pageIds...]', 'ID stránek')
  .option('-c, --collection <id>', 'Stáhnout celou kolekci')
  .action(async (pageIds: string[], options) => {
    const { api } = requireAuth();

    let ids = pageIds;
    if (options.collection) {
      const collection = await api.get(`/api/collections/${options.collection}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ids = collection.pages.filter((p: any) => p.status === 'done').map((p: any) => p.id);
    }

    if (ids.length === 0) {
      output.warn('Žádné stránky ke stažení.');
      return;
    }

    const spinner = ora('Stahuji...').start();

    for (let i = 0; i < ids.length; i++) {
      const pageId = ids[i] as string;
      spinner.text = `[${i + 1}/${ids.length}] ${pageId}`;

      try {
        const page = await api.get(`/api/pages/${pageId}`);
        if (!page.document) {
          spinner.stop();
          output.warn(`  ${pageId}: není zpracována, přeskakuji`);
          spinner.start();
          continue;
        }

        const doc = page.document;
        const translation = doc.translations?.[0];

        const glossaryText = (doc.glossary ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((g: any) => `**${g.term}**: ${g.definition}`)
          .join('\n');

        writePageFiles({
          pageId,
          documentId: doc.id,
          transcription: doc.transcription ?? '',
          translation: translation?.text ?? '',
          context: doc.context ?? '',
          glossary: glossaryText,
          serverUpdatedAt: doc.updatedAt,
        });

        spinner.stop();
        output.success(
          `  ${page.displayName ?? page.filename ?? pageId} → .ais-workspace/${pageId}/`,
        );
        spinner.start();
      } catch (e: unknown) {
        spinner.stop();
        output.error(`  ${pageId}: ${(e as Error).message}`);
        spinner.start();
      }
    }

    spinner.stop();
    output.info('Pull dokončen.');
  });
