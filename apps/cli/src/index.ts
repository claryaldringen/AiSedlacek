import { Command } from 'commander';
import { loginCommand } from './commands/login.js';

export const program = new Command()
  .name('ais')
  .description('CLI klient pro čtečku starých textů')
  .version('0.0.0');

program.addCommand(loginCommand);
