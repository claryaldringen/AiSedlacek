#!/usr/bin/env node
import { program } from './index.js';
import * as output from './lib/output.js';

// Async akce: neodchycená chyba nesmí skončit nečitelným stack trace (unhandled
// rejection) – vypiš ji a skonči nenulovým kódem.
program.parseAsync().catch((e: unknown) => {
  output.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
