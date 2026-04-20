import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { getToken } from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import * as output from '../lib/output.js';

export const whoamiCommand = new Command('whoami')
  .description('Zobrazit přihlášeného uživatele')
  .action(async () => {
    const token = getToken();
    if (!token) {
      output.error('Nejste přihlášen. Spusťte `ais login`.');
      process.exit(1);
    }

    const config = loadConfig();
    const api = createApiClient(config.server, token);

    try {
      const user = await api.get('/api/auth/cli/me');
      console.log(`Email: ${user.email}`);
      if (user.name) console.log(`Jméno: ${user.name}`);
      console.log(`ID: ${user.id}`);
    } catch (e: any) {
      output.error(e.message);
      process.exit(1);
    }
  });
