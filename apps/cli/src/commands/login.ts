import { Command } from 'commander';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import open from 'open';
import ora from 'ora';
import { loadConfig } from '../lib/config.js';
import { saveToken, getToken } from '../lib/auth.js';
import {
  buildAuthUrl,
  createPkcePair,
  exchangeCode,
  parseCallback,
  type CallbackResult,
} from '../lib/login-flow.js';
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
    // PKCE: prohlížeč předá jen jednorázový kód, token si CLI vyzvedne POSTem
    // s ověřovačem – v adrese ani historii prohlížeče se token neobjeví.
    const pkce = createPkcePair();

    const { port, resultPromise, server } = await startCallbackServer(state);

    // Callback server poslouchá jen na 127.0.0.1, proto redirect míří přímo na tuto adresu
    // ("localhost" se v prohlížeči může přeložit na ::1, kde nikdo neposlouchá). Stránka
    // /auth/cli povoluje jen http: na loopback s explicitním portem a cestou /callback.
    const redirect = `http://127.0.0.1:${port}/callback`;
    const authUrl = buildAuthUrl(config.server, state, redirect, pkce.challenge);

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
      const result = await Promise.race([resultPromise, timeout]);
      clearTimeout(timeoutId!);

      const token =
        result.kind === 'code'
          ? await exchangeCode(config.server, result.code, pkce.verifier)
          : result.token;
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

type Credential = Extract<CallbackResult, { kind: 'code' } | { kind: 'token' }>;

function startCallbackServer(
  expectedState: string,
): Promise<{ port: number; resultPromise: Promise<Credential>; server: http.Server }> {
  return new Promise((resolveSetup) => {
    let resolveResult: (result: Credential) => void;
    let rejectResult: (err: Error) => void;
    const resultPromise = new Promise<Credential>((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      const result = parseCallback(url, expectedState);

      // Cizí požadavek (jiný lokální proces, skenování portů z webové stránky) nesmí
      // přihlášení shodit – odmítni ho a čekej dál na skutečný callback nebo timeout.
      if (result.kind === 'ignore') {
        res.writeHead(400);
        res.end('Neplatný state parametr');
        return;
      }

      if (result.kind === 'missing') {
        res.writeHead(400);
        res.end('Přihlašovací údaje chybí');
        rejectResult(new Error('Token missing'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<html><body><h1>Přihlášení úspěšné!</h1><p>Můžete zavřít tuto stránku.</p></body></html>',
      );
      resolveResult(result);
    });

    // Bindni jen na loopback (127.0.0.1), ať kód z callbacku nemůže zachytit nikdo v síti.
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolveSetup({ port: addr.port, resultPromise, server });
    });
  });
}
