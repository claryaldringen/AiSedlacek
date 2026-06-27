import { Command } from 'commander';
import { requireAuth } from '../lib/require-auth.js';
import * as output from '../lib/output.js';

export const collectionsCommand = new Command('collections')
  .description('Správa kolekcí')
  .option('-w, --workspace <id>', 'ID workspace (jinak se použije home workspace)')
  .action(async (options: { workspace?: string }) => {
    const { api } = requireAuth();

    try {
      // /api/collections vyžaduje workspaceId — když není zadán, vyřeš home workspace.
      let workspaceId = options.workspace;
      if (!workspaceId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const workspaces: any[] = await api.get('/api/workspaces');
        const home = workspaces.find((w) => w.type === 'home') ?? workspaces[0];
        if (!home) {
          output.error('Nenalezen žádný workspace.');
          process.exit(1);
        }
        workspaceId = home.id;
      }

      const data = await api.get(`/api/collections?workspaceId=${workspaceId}`);
      const collections = data.collections ?? data;

      if (collections.length === 0) {
        output.info('Žádné kolekce.');
        return;
      }

      output.table(
        ['ID', 'Název', 'Stránek', 'Vytvořeno'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        collections.map((c: any) => [
          c.id.slice(0, 8),
          c.name,
          String(c._count?.pages ?? c.pages?.length ?? 0),
          new Date(c.createdAt).toLocaleDateString('cs'),
        ]),
      );
    } catch (e: unknown) {
      output.error((e as Error).message);
      process.exit(1);
    }
  });

collectionsCommand
  .command('create')
  .description('Vytvořit novou kolekci')
  .argument('<name>', 'Název kolekce')
  .option('-d, --description <text>', 'Popis kolekce')
  .action(async (name: string, options: { description?: string }) => {
    const { api } = requireAuth();

    try {
      const collection = await api.postJson('/api/collections', {
        name,
        description: options.description,
      });
      output.success(`Kolekce vytvořena: ${collection.id} — ${collection.name}`);
    } catch (e: unknown) {
      output.error((e as Error).message);
      process.exit(1);
    }
  });

collectionsCommand
  .command('delete')
  .description('Smazat kolekci')
  .argument('<id>', 'ID kolekce')
  .action(async (id: string) => {
    const { api } = requireAuth();

    try {
      await api.delete(`/api/collections/${id}`);
      output.success(`Kolekce ${id} smazána.`);
    } catch (e: unknown) {
      output.error((e as Error).message);
      process.exit(1);
    }
  });
