import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { getToken, deleteToken } from '../lib/auth.js';
import { createApiClient } from '../lib/api-client.js';
import * as output from '../lib/output.js';

export const logoutCommand = new Command('logout')
  .description('Odhlásit se a revokovat token')
  .action(async () => {
    const token = getToken();
    if (!token) {
      output.warn('Nejste přihlášen.');
      return;
    }

    try {
      const config = loadConfig();
      const api = createApiClient(config.server, token);
      await api.delete('/api/auth/cli/token');
    } catch {
      // Token revocation failed, but still delete locally
    }

    deleteToken();
    output.success('Odhlášení úspěšné.');
  });
