import { Command } from 'commander';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import open from 'open';
import ora from 'ora';
import { loadConfig } from '../lib/config.js';
import { saveToken, getToken } from '../lib/auth.js';
import * as output from '../lib/output.js';

export const loginCommand = new Command('login')
  .description('Přihlásit se k serveru přes prohlížeč')
  .action(async () => {
    if (getToken()) {
      output.warn('Už jste přihlášen. Použijte `ais logout` pro odhlášení.');
      return;
    }

    const config = loadConfig();
    const state = crypto.randomBytes(16).toString('hex');

    const { port, tokenPromise, server } = await startCallbackServer(state);

    const authUrl = `${config.server}/auth/cli?state=${state}&redirect=${encodeURIComponent(`http://localhost:${port}/callback`)}`;

    const spinner = ora('Otevírám prohlížeč pro přihlášení...').start();

    try {
      await open(authUrl);
      spinner.text = 'Čekám na autorizaci v prohlížeči...';

      let timeoutId: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Timeout — autorizace nebyla dokončena do 5 minut')),
          5 * 60 * 1000,
        );
      });
      const token = await Promise.race([tokenPromise, timeout]);
      clearTimeout(timeoutId!);
      saveToken(token);

      spinner.stop();
      output.success('Přihlášení úspěšné!');
    } catch (e: unknown) {
      spinner.stop();
      output.error((e as Error).message ?? 'Přihlášení selhalo');
      process.exit(1);
    } finally {
      server.close();
    }
  });

function startCallbackServer(
  expectedState: string,
): Promise<{ port: number; tokenPromise: Promise<string>; server: http.Server }> {
  return new Promise((resolveSetup) => {
    let resolveToken: (token: string) => void;
    let rejectToken: (err: Error) => void;
    const tokenPromise = new Promise<string>((res, rej) => {
      resolveToken = res;
      rejectToken = rej;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const token = url.searchParams.get('token');
      const state = url.searchParams.get('state');

      if (state !== expectedState) {
        res.writeHead(400);
        res.end('Neplatný state parametr');
        rejectToken(new Error('State mismatch'));
        return;
      }

      if (!token) {
        res.writeHead(400);
        res.end('Token chybí');
        rejectToken(new Error('Token missing'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<html><body><h1>Přihlášení úspěšné!</h1><p>Můžete zavřít tuto stránku.</p></body></html>',
      );
      resolveToken(token);
    });

    // Bindni jen na loopback (127.0.0.1), ať token z callbacku nemůže zachytit nikdo v síti.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolveSetup({ port: addr.port, tokenPromise, server });
    });
  });
}
