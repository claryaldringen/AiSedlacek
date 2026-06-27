import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { whoamiCommand } from './commands/whoami.js';
import { uploadCommand } from './commands/upload.js';
import { listCommand } from './commands/list.js';
import { showCommand } from './commands/show.js';
import { pullCommand } from './commands/pull.js';
import { pushCommand } from './commands/push.js';
import { diffCommand } from './commands/diff.js';
import { collectionsCommand } from './commands/collections.js';
import { promptCommand } from './commands/prompt.js';
import { submitCommand } from './commands/submit.js';

export const program = new Command()
  .name('ais')
  .description('CLI klient pro čtečku starých textů')
  .version('0.0.0')
  .addHelpText(
    'after',
    `
Postup pro AI agenta (rozpoznávání bez placených API tokenů):
  OCR rozpoznávání skenů NESPOUŠTĚJ přes web UI ani worker — ty volají
  Anthropic API a pálí placené tokeny. Agent (Claude) má rozpoznání udělat
  SÁM v rámci své subscription a do aplikace jen uložit hotový výsledek:

    1. ais prompt                   zjisti SYSTEM_PROMPT, podle kterého pracovat
    2. ais list -c <collectionId>   najdi stránky se statusem 'pending'
    3. ais show <pageId>            detail vč. řádku "Obrázek: <imageUrl>"
                                    → stáhni sken z <server><imageUrl> a přečti ho
    4. (sám) přepiš + přelož + sestav kontext a glosář podle promptu
    5. ais submit <pageId> -f out.json   ulož výsledek (stránka → done)

  Příkaz 'submit' nevolá žádné LLM API; jen ukládá hotový JSON.
`,
  );

program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(whoamiCommand);
program.addCommand(uploadCommand);
program.addCommand(listCommand);
program.addCommand(showCommand);
program.addCommand(pullCommand);
program.addCommand(pushCommand);
program.addCommand(diffCommand);
program.addCommand(collectionsCommand);
program.addCommand(promptCommand);
program.addCommand(submitCommand);
