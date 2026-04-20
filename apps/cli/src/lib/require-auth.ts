import { getToken } from './auth.js';
import { loadConfig } from './config.js';
import { createApiClient, type ApiClient } from './api-client.js';
import * as output from './output.js';

export function requireAuth(): { token: string; api: ApiClient } {
  const token = getToken();
  if (!token) {
    output.error('Nejste přihlášen. Spusťte `ais login`.');
    process.exit(1);
  }

  const config = loadConfig();
  const api = createApiClient(config.server, token);
  return { token, api };
}
