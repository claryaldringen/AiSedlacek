import { Command } from 'commander';
import ora from 'ora';
import { requireAuth } from '../lib/require-auth.js';
import { writePageFiles, getChangedFiles, readMeta } from '../lib/workspace.js';
import { pickTranslation } from '../lib/document-sync.js';
import * as output from '../lib/output.js';

type PullOptions = { collection?: string; lang?: string; force?: boolean };

export const pullCommand = new Command('pull')
  .description('Stáhnout dokumenty do lokálního workspace')
  .argument('[pageIds...]', 'ID stránek')
  .option('-c, --collection <id>', 'Stáhnout celou kolekci')
  .option(
    '--lang <code>',
    'Jazyk překladu do translation.md (výchozí: jazyk z předchozího pull, jinak původní překlad)',
  )
  .option('-f, --force', 'Přepsat i lokálně změněné (neodeslané) soubory')
  .action(async (pageIds: string[], options: PullOptions) => {
    const { api } = requireAuth();

    let ids = pageIds;
    if (options.collection) {
      try {
        const collection = await api.get(`/api/collections/${options.collection}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ids = collection.pages.filter((p: any) => p.status === 'done').map((p: any) => p.id);
      } catch (e: unknown) {
        output.error(`Kolekci ${options.collection} nelze načíst: ${(e as Error).message}`);
        process.exit(1);
      }
    }

    if (ids.length === 0) {
      output.warn('Žádné stránky ke stažení.');
      return;
    }

    let hadError = false;
    const spinner = ora('Stahuji...').start();

    for (let i = 0; i < ids.length; i++) {
      const pageId = ids[i] as string;
      spinner.text = `[${i + 1}/${ids.length}] ${pageId}`;

      try {
        // Neodeslané lokální změny nepřepisuj – pull by je jinak tiše zahodil.
        // glossary.md je jen pro čtení (push ho neodesílá), jeho přepsání jen ohlásíme.
        if (!options.force) {
          let localChanges: string[];
          try {
            localChanges = getChangedFiles(pageId).map((c) => c.file);
          } catch (e: unknown) {
            spinner.stop();
            output.error(
              `  ${pageId}: nelze přečíst lokální metadata (${(e as Error).message}) – přeskakuji`,
            );
            output.info(`    Stránku znovu stáhnete přes --force (přepíše lokální soubory)`);
            spinner.start();
            hadError = true;
            continue;
          }

          const blocking = localChanges.filter((f) => f !== 'glossary.md');
          if (blocking.length > 0) {
            spinner.stop();
            output.error(
              `  ${pageId}: lokálně změněné soubory (${blocking.join(', ')}) – přeskakuji, aby se nepřepsaly`,
            );
            output.info(`    Nejdřív je odešlete (ais push), nebo použijte --force pro přepsání`);
            spinner.start();
            hadError = true;
            continue;
          }
          if (localChanges.includes('glossary.md')) {
            spinner.stop();
            output.warn(
              `  ${pageId}: lokální úpravy glossary.md se přepíšou (glosář nelze pushovat)`,
            );
            spinner.start();
          }
        }

        const page = await api.get(`/api/pages/${pageId}`);
        if (!page.document) {
          spinner.stop();
          output.warn(`  ${pageId}: není zpracována, přeskakuji`);
          spinner.start();
          continue;
        }

        const doc = page.document;
        // Jazyk překladu volíme deterministicky a ukládáme do metadat, aby ho push
        // mohl poslat serveru (bez něj server překlad neuloží).
        const preferredLanguage = options.lang ?? readPreviousLanguage(pageId);
        const translation = pickTranslation(doc.translations, preferredLanguage);

        const glossaryText = (doc.glossary ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((g: any) => `**${g.term}**: ${g.definition}`)
          .join('\n');

        writePageFiles({
          pageId,
          documentId: doc.id,
          transcription: doc.transcription ?? '',
          translation: translation.text,
          translationLanguage: translation.language,
          context: doc.context ?? '',
          glossary: glossaryText,
          serverUpdatedAt: doc.updatedAt,
        });

        spinner.stop();
        output.success(
          `  ${page.displayName ?? page.filename ?? pageId} → .ais-workspace/${pageId}/` +
            (translation.language ? ` (překlad: ${translation.language})` : ''),
        );
        if (translation.language && !translation.available.includes(translation.language)) {
          output.warn(
            `    Překlad v jazyce ${translation.language} zatím neexistuje – translation.md je prázdný`,
          );
        } else if (translation.available.length > 1) {
          output.info(
            `    Dostupné překlady: ${translation.available.join(', ')} (jiný zvolte přes --lang)`,
          );
        }
        spinner.start();
      } catch (e: unknown) {
        spinner.stop();
        output.error(`  ${pageId}: ${(e as Error).message}`);
        spinner.start();
        hadError = true;
      }
    }

    spinner.stop();
    output.info('Pull dokončen.');
    if (hadError) process.exitCode = 1;
  });

function readPreviousLanguage(pageId: string): string | undefined {
  try {
    return readMeta(pageId)?.translationLanguage;
  } catch {
    // Poškozená metadata – pull je přepíše (bez --force se k tomu ani nedostaneme).
    return undefined;
  }
}
