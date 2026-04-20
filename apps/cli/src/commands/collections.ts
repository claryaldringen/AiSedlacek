import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import * as output from '../lib/output.js';

export const collectionsCommand = new Command('collections')
  .description('Správa kolekcí')
  .action(async () => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    try {
      const data = await api.get('/api/collections');
      const collections = data.collections ?? data;

      if (collections.length === 0) {
        output.info('Žádné kolekce.');
        return;
      }

      output.table(
        ['ID', 'Název', 'Stránek', 'Vytvořeno'],
        collections.map((c: any) => [
          c.id.slice(0, 8),
          c.name,
          String(c._count?.pages ?? c.pages?.length ?? 0),
          new Date(c.createdAt).toLocaleDateString('cs'),
        ]),
      );
    } catch (e: any) {
      output.error(e.message);
      process.exit(1);
    }
  });

collectionsCommand
  .command('create')
  .description('Vytvořit novou kolekci')
  .argument('<name>', 'Název kolekce')
  .option('-d, --description <text>', 'Popis kolekce')
  .action(async (name: string, options: { description?: string }) => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    try {
      const collection = await api.postJson('/api/collections', {
        name,
        description: options.description,
      });
      output.success(`Kolekce vytvořena: ${collection.id} — ${collection.name}`);
    } catch (e: any) {
      output.error(e.message);
      process.exit(1);
    }
  });

collectionsCommand
  .command('delete')
  .description('Smazat kolekci')
  .argument('<id>', 'ID kolekce')
  .action(async (id: string) => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    try {
      await api.delete(`/api/collections/${id}`);
      output.success(`Kolekce ${id} smazána.`);
    } catch (e: any) {
      output.error(e.message);
      process.exit(1);
    }
  });
