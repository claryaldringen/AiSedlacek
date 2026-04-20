import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { whoamiCommand } from './commands/whoami.js';
import { uploadCommand } from './commands/upload.js';
import { processCommand } from './commands/process.js';

export const program = new Command()
  .name('ais')
  .description('CLI klient pro čtečku starých textů')
  .version('0.0.0');

program.addCommand(loginCommand);
program.addCommand(logoutCommand);
program.addCommand(whoamiCommand);
program.addCommand(uploadCommand);
program.addCommand(processCommand);
