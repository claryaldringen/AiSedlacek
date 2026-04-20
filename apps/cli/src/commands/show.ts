import { Command } from 'commander';
import chalk from 'chalk';
import { requireAuth } from '../lib/require-auth.js';
import * as output from '../lib/output.js';

export const showCommand = new Command('show')
  .description('Zobrazit detail stránky')
  .argument('<pageId>', 'ID stránky')
  .action(async (pageId: string) => {
    const { api } = requireAuth();

    try {
      const page = await api.get(`/api/pages/${pageId}`);

      console.log(chalk.bold(`\n=== ${page.displayName ?? page.filename} ===`));
      console.log(`Status: ${output.statusBadge(page.status)}`);
      console.log(`ID: ${page.id}`);
      if (page.collection) console.log(`Kolekce: ${page.collection.name}`);
      console.log();

      if (!page.document) {
        output.warn('Stránka ještě nebyla zpracována.');
        return;
      }

      const doc = page.document;

      console.log(chalk.bold.underline('Transkripce'));
      console.log(`(${doc.detectedLanguage})\n`);
      console.log(doc.transcription);
      console.log();

      if (doc.translations?.length > 0) {
        for (const t of doc.translations) {
          console.log(chalk.bold.underline(`Překlad (${t.language})`));
          console.log(t.text);
          console.log();
        }
      }

      if (doc.context) {
        console.log(chalk.bold.underline('Kontext'));
        console.log(doc.context);
        console.log();
      }

      if (doc.glossary?.length > 0) {
        console.log(chalk.bold.underline('Glosář'));
        for (const g of doc.glossary) {
          console.log(`  ${chalk.bold(g.term)}: ${g.definition}`);
        }
        console.log();
      }
    } catch (e: unknown) {
      output.error((e as Error).message);
      process.exit(1);
    }
  });
