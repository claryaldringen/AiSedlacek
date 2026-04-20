import { Command } from 'commander';
import { requireAuth } from '../lib/require-auth.js';
import * as output from '../lib/output.js';

export const whoamiCommand = new Command('whoami')
  .description('Zobrazit přihlášeného uživatele')
  .action(async () => {
    const { api } = requireAuth();

    try {
      const user = await api.get('/api/auth/cli/me');
      console.log(`Email: ${user.email}`);
      if (user.name) console.log(`Jméno: ${user.name}`);
      console.log(`ID: ${user.id}`);
    } catch (e: unknown) {
      output.error((e as Error).message);
      process.exit(1);
    }
  });
