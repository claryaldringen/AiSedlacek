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
import {
  buildDocumentPatch,
  findUnconfirmedFiles,
  type ServerDocument,
} from '../lib/document-sync.js';
import * as output from '../lib/output.js';

export const pushCommand = new Command('push')
  .description('Odeslat lokální změny na server')
  .argument('[pageIds...]', 'ID stránek (výchozí: všechny změněné)')
  .option('-f, --force', 'Přepsat i při konfliktu')
  .option(
    '--lang <code>',
    'Jazyk překladu pro stránky stažené starší verzí CLI (metadata jazyk neobsahují)',
  )
  .action(async (pageIds: string[], options: { force?: boolean; lang?: string }) => {
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
        let currentDoc: ServerDocument | undefined;
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
          currentDoc = currentPage?.document ?? undefined;
          const serverUpdatedAt = currentDoc?.updatedAt;
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

        // Jazyk překladu: z metadat pull. Workspace ze starší verze CLI ho nemají –
        // pak --lang, případně jediný existující překlad na serveru. Při nejednoznačnosti
        // raději neodesíláme nic, než abychom přepsali překlad v jiném jazyce.
        let translationLanguage = meta.translationLanguage;
        const translationChanged = pushableChanges.some((c) => c.file === 'translation.md');
        if (translationChanged && !translationLanguage) {
          translationLanguage = options.lang;
          if (!translationLanguage) {
            if (!currentDoc) {
              const currentPage = await api.get(`/api/pages/${pageId}`);
              currentDoc = currentPage?.document ?? undefined;
            }
            const languages = [...new Set((currentDoc?.translations ?? []).map((t) => t.language))];
            if (languages.length === 1) {
              translationLanguage = languages[0];
              spinner.stop();
              output.info(`  ${pageId}: jazyk překladu převzat ze serveru: ${translationLanguage}`);
              spinner.start();
            } else {
              spinner.stop();
              output.error(
                `  ${pageId}: nelze určit jazyk překladu (${
                  languages.length === 0
                    ? 'dokument nemá žádný překlad'
                    : `dostupné: ${languages.sort().join(', ')}`
                }) – stránka NEBYLA odeslána`,
              );
              output.info(
                `    Zadejte jazyk přes --lang <kód>, např. ais push ${pageId} --lang cs`,
              );
              spinner.start();
              hadError = true;
              continue;
            }
          }
        }

        const patch = buildDocumentPatch(pushableChanges, files, translationLanguage);
        if (Object.keys(patch).length === 0) continue;

        const updated: ServerDocument | null = await api.patchJson(
          `/api/documents/${meta.documentId}`,
          patch,
        );

        // Ověř, že server změny opravdu uložil – jinak by se soubor označil jako odeslaný
        // a příští pull by lokální práci přepsal (DAT-3). Jako odeslané označíme jen
        // soubory, jejichž obsah server v odpovědi potvrdil.
        const sentFiles = pushableChanges.map((c) => c.file);
        const unconfirmed = findUnconfirmedFiles(patch, updated);
        const confirmed = sentFiles.filter((f) => !unconfirmed.includes(f));

        // Aktualizuj jen metadata reálně uložených polí. Plný re-pull záměrně neděláme,
        // ať se nepřepíše lokální obsah ostatních souborů (zejm. glossary.md) a neztratí
        // se lokální editace. serverUpdatedAt bereme z odpovědi PATCHe.
        if (confirmed.length > 0) {
          const newServerUpdatedAt = updated?.updatedAt ?? meta.serverUpdatedAt;
          updateMetaAfterPush(
            pageId,
            confirmed,
            newServerUpdatedAt,
            confirmed.includes('translation.md') ? translationLanguage : undefined,
          );
        }

        spinner.stop();
        if (confirmed.length > 0) output.success(`  ${pageId}: ${confirmed.join(', ')}`);
        if (unconfirmed.length > 0) {
          output.error(
            `  ${pageId}: server nepotvrdil uložení ${unconfirmed.join(', ')} – tyto změny NEBYLY odeslány`,
          );
          hadError = true;
        }
        spinner.start();
        if (unconfirmed.length === 0) pushed++;
      } catch (e: unknown) {
        spinner.stop();
        output.error(`  ${pageId}: ${(e as Error).message} – změny NEBYLY odeslány`);
        spinner.start();
        hadError = true;
      }
    }

    spinner.stop();
    output.info(`Push dokončen: ${pushed} stránek aktualizováno.`);
    if (hadError) process.exitCode = 1;
  });
