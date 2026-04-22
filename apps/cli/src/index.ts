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

export const program = new Command()
  .name('ais')
  .description('CLI klient pro čtečku starých textů')
  .version('0.0.0');

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
