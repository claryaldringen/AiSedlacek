import { Command } from 'commander';
import ora from 'ora';
import { requireAuth } from '../lib/require-auth.js';
import {
  listWorkspacePages,
  getChangedFiles,
  readPageFiles,
  readMeta,
  updateMetaAfterPush,
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
    let hadError = false;
    const spinner = ora('Odesílám změny...').start();

    for (const pageId of ids) {
      try {
        const changed = getChangedFiles(pageId);
        if (changed.length === 0) continue;

        const meta = readMeta(pageId);
        if (!meta) continue;

        const files = readPageFiles(pageId);
        if (!files) continue;

        // Změny glosáře nelze pushovat (glossary.md je read-only)
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

        // Detekce konfliktu: ověř, že se serverová verze nezměnila od posledního pull.
        // Pozn.: mezi tímto GET a následným PATCH stále zbývá malé okno (TOCTOU,
        // last-write-wins), ale chybějící referenční verzi bereme jako potenciální konflikt.
        if (!options.force) {
          if (!meta.serverUpdatedAt) {
            spinner.stop();
            output.error(
              `  ${pageId}: chybí referenční verze ze serveru (serverUpdatedAt) — nelze ověřit konflikt`,
            );
            output.info(`    Použijte --force pro přepsání, nebo pull pro aktualizaci`);
            spinner.start();
            hadError = true;
            continue;
          }

          const currentPage = await api.get(`/api/pages/${pageId}`);
          const serverUpdatedAt = currentPage.document?.updatedAt;
          // Chybějící updatedAt ze serveru = nelze ověřit → bereme jako potenciální konflikt.
          if (!serverUpdatedAt || serverUpdatedAt !== meta.serverUpdatedAt) {
            spinner.stop();
            output.error(
              `  ${pageId}: konflikt — dokument byl změněn na serveru (nebo verzi nelze ověřit) od posledního pull`,
            );
            output.info(`    Použijte --force pro přepsání, nebo pull pro aktualizaci`);
            spinner.start();
            hadError = true;
            continue;
          }
        }

        const patch: Record<string, string> = {};
        for (const c of pushableChanges) {
          if (c.file === 'transcription.md') patch.transcription = files['transcription.md'];
          if (c.file === 'translation.md') patch.translation = files['translation.md'];
          if (c.file === 'context.md') patch.context = files['context.md'];
        }

        if (Object.keys(patch).length === 0) continue;

        const updated = await api.patchJson(`/api/documents/${meta.documentId}`, patch);

        // Aktualizuj jen metadata reálně pushnutých polí. Plný re-pull záměrně neděláme,
        // ať se nepřepíše lokální obsah ostatních souborů (zejm. glossary.md) a neztratí
        // se lokální editace. serverUpdatedAt bereme z odpovědi PATCHe.
        const pushedFiles = pushableChanges.map((c) => c.file);
        const newServerUpdatedAt = updated?.updatedAt ?? meta.serverUpdatedAt;
        updateMetaAfterPush(pageId, pushedFiles, newServerUpdatedAt);

        spinner.stop();
        output.success(`  ${pageId}: ${pushedFiles.join(', ')}`);
        spinner.start();
        pushed++;
      } catch (e: unknown) {
        spinner.stop();
        output.error(`  ${pageId}: ${(e as Error).message}`);
        spinner.start();
        hadError = true;
      }
    }

    spinner.stop();
    output.info(`Push dokončen: ${pushed} stránek aktualizováno.`);
    if (hadError) process.exitCode = 1;
  });
