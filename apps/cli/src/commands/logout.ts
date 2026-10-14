import { Command } from 'commander';
import { getToken, deleteToken } from '../lib/auth.js';
import { loadConfig } from '../lib/config.js';
import { ApiError, createApiClient } from '../lib/api-client.js';
import * as output from '../lib/output.js';

export const logoutCommand = new Command('logout')
  .description('Odhlásit se a revokovat token')
  .action(async () => {
    const token = getToken();
    if (!token) {
      output.warn('Nejste přihlášen.');
      return;
    }

    let revokeError: string | null = null;
    try {
      const config = loadConfig();
      const api = createApiClient(config.server, token);
      await api.delete('/api/auth/cli/token');
    } catch (e: unknown) {
      // 401 = token už na serveru neplatí → revokace není potřeba.
      if (!(e instanceof ApiError && e.status === 401)) {
        revokeError = (e as Error).message;
      }
    }

    // Lokálně token smažeme vždy, i když revokace na serveru selhala.
    deleteToken();

    if (revokeError) {
      output.error(`Token se nepodařilo zneplatnit na serveru: ${revokeError}`);
      output.warn('Lokální kopie tokenu byla smazána, na serveru ale token zůstává platný.');
      process.exitCode = 1;
      return;
    }
    output.success('Odhlášení úspěšné.');
  });
