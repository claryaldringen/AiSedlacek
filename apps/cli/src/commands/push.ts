import { Command } from 'commander';
import ora from 'ora';
import { requireAuth } from '../lib/require-auth.js';
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
    const { api } = requireAuth();

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

      // Check for glossary changes (not pushable)
      const glossaryChanged = changed.some((c) => c.file === 'glossary.md');
      if (glossaryChanged) {
        spinner.stop();
        output.warn(
          `  ${pageId}: glossary.md byl změněn lokálně, ale glosář nelze pushovat (pouze read-only)`,
        );
        spinner.start();
      }

      const pushableChanges = changed.filter((c) => c.file !== 'glossary.md');
      if (pushableChanges.length === 0) continue;

      spinner.text = `Odesílám ${pageId} (${pushableChanges.length} změn)...`;

      try {
        // Conflict detection: check if server version changed since pull
        if (meta.serverUpdatedAt && !options.force) {
          const currentPage = await api.get(`/api/pages/${pageId}`);
          const serverUpdatedAt = currentPage.document?.updatedAt;
          if (serverUpdatedAt && serverUpdatedAt !== meta.serverUpdatedAt) {
            spinner.stop();
            output.error(
              `  ${pageId}: konflikt — dokument byl změněn na serveru od posledního pull`,
            );
            output.info(`    Použijte --force pro přepsání, nebo pull pro aktualizaci`);
            spinner.start();
            continue;
          }
        }

        const patch: Record<string, string> = {};
        for (const c of pushableChanges) {
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
        output.success(`  ${pageId}: ${pushableChanges.map((c) => c.file).join(', ')}`);
        spinner.start();
        pushed++;
      } catch (e: unknown) {
        spinner.stop();
        output.error(`  ${pageId}: ${(e as Error).message}`);
        spinner.start();
      }
    }

    spinner.stop();
    output.info(`Push dokončen: ${pushed} stránek aktualizováno.`);
  });
