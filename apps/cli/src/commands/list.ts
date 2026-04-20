import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import * as output from '../lib/output.js';

export const listCommand = new Command('list')
  .description('Zobrazit seznam stránek')
  .option('-c, --collection <id>', 'Filtrovat podle kolekce')
  .action(async (options) => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

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
        pages.map((p: any) => [
          p.id.slice(0, 8),
          p.displayName ?? p.filename,
          output.statusBadge(p.status),
          p.collection?.name ?? '—',
          new Date(p.createdAt).toLocaleDateString('cs'),
        ]),
      );
    } catch (e: any) {
      output.error(e.message);
      process.exit(1);
    }
  });
