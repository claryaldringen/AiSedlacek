import { Command } from 'commander';
import ora from 'ora';
import { loadConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import {
  listWorkspacePages,
  getChangedFiles,
  readPageFiles,
  readMeta,
  writePageFiles,
} from '../lib/workspace.js';
import * as output from '../lib/output.js';

export const pushCommand = new Command('push')
  .description('Odeslat lokální změny na server')
  .argument('[pageIds...]', 'ID stránek (výchozí: všechny změněné)')
  .option('-f, --force', 'Přepsat i při konfliktu')
  .action(async (pageIds: string[], options) => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    const ids = pageIds.length > 0 ? pageIds : listWorkspacePages();

    if (ids.length === 0) {
      output.info('Žádné stránky ve workspace.');
      return;
    }

    let pushed = 0;
    const spinner = ora('Odesílám změny...').start();

    for (const pageId of ids) {
      const changed = getChangedFiles(pageId);
      if (changed.length === 0) continue;

      const meta = readMeta(pageId);
      if (!meta) continue;

      const files = readPageFiles(pageId);
      if (!files) continue;

      spinner.text = `Odesílám ${pageId} (${changed.length} změn)...`;

      try {
        const patch: Record<string, string> = {};
        for (const c of changed) {
          if (c.file === 'transcription.md') patch.transcription = files['transcription.md'];
          if (c.file === 'translation.md') patch.translation = files['translation.md'];
          if (c.file === 'context.md') patch.context = files['context.md'];
        }

        if (Object.keys(patch).length > 0) {
          await api.patchJson(`/api/documents/${meta.documentId}`, patch);
        }

        // Re-pull to update meta hashes
        const page = await api.get(`/api/pages/${pageId}`);
        const doc = page.document;
        const translation = doc.translations?.[0];
        const glossaryText = (doc.glossary ?? [])
          .map((g: any) => `**${g.term}**: ${g.definition}`)
          .join('\n');

        writePageFiles({
          pageId,
          documentId: doc.id,
          transcription: doc.transcription ?? '',
          translation: translation?.text ?? '',
          context: doc.context ?? '',
          glossary: glossaryText,
        });

        spinner.stop();
        output.success(`  ${pageId}: ${changed.map((c) => c.file).join(', ')}`);
        spinner.start();
        pushed++;
      } catch (e: any) {
        spinner.stop();
        output.error(`  ${pageId}: ${e.message}`);
        spinner.start();
      }
    }

    spinner.stop();
    output.info(`Push dokončen: ${pushed} stránek aktualizováno.`);
  });
