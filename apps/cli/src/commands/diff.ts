import { Command } from 'commander';
import chalk from 'chalk';
import { listWorkspacePages, getChangedFiles } from '../lib/workspace.js';
import * as output from '../lib/output.js';

export const diffCommand = new Command('diff')
  .description('Zobrazit lokální změny oproti serveru')
  .argument('[pageIds...]', 'ID stránek (výchozí: všechny)')
  .action(async (pageIds: string[]) => {
    const ids = pageIds.length > 0 ? pageIds : listWorkspacePages();

    if (ids.length === 0) {
      output.info('Žádné stránky ve workspace.');
      return;
    }

    let totalChanged = 0;

    for (const pageId of ids) {
      const changed = getChangedFiles(pageId);
      if (changed.length === 0) continue;

      console.log(chalk.bold(`\nStránka ${pageId}:`));
      for (const c of changed) {
        console.log(`  ${chalk.yellow('M')} ${c.file}`);
      }
      totalChanged += changed.length;
    }

    if (totalChanged === 0) {
      output.info('Žádné lokální změny.');
    } else {
      output.info(`\nCelkem: ${totalChanged} změněných souborů.`);
    }
  });
