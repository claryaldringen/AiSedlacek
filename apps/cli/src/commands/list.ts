import { Command } from 'commander';
import { requireAuth } from '../lib/require-auth.js';
import * as output from '../lib/output.js';

export const listCommand = new Command('list')
  .description('Zobrazit seznam stránek')
  .option('-c, --collection <id>', 'Filtrovat podle kolekce')
  .action(async (options) => {
    const { api } = requireAuth();

    try {
      let url = '/api/pages';
      if (options.collection) url += `?collectionId=${options.collection}`;
      const data = await api.get(url);
      const pages = data.pages ?? data;

      if (pages.length === 0) {
        output.info('Žádné stránky.');
        return;
      }

      output.table(
        ['ID', 'Soubor', 'Status', 'Kolekce', 'Vytvořeno'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pages.map((p: any) => [
          p.id.slice(0, 8),
          p.displayName ?? p.filename,
          output.statusBadge(p.status),
          p.collection?.name ?? '—',
          new Date(p.createdAt).toLocaleDateString('cs'),
        ]),
      );
    } catch (e: unknown) {
      output.error((e as Error).message);
      process.exit(1);
    }
  });
