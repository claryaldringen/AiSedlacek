import { Command, Option } from 'commander';
import { requireAuth } from '../lib/require-auth.js';
import * as output from '../lib/output.js';

export const promptCommand = new Command('prompt')
  .description('Zobrazit system prompt používaný pro OCR zpracování')
  .addOption(
    new Option('-m, --mode <mode>', 'Režim zpracování')
      .choices(['transcribe+translate', 'translate', 'batch'])
      .default('transcribe+translate'),
  )
  .action(async (options) => {
    const { api } = requireAuth();

    try {
      const data = await api.get(`/api/prompts?mode=${encodeURIComponent(options.mode)}`);
      output.info(`Režim: ${data.mode}`);
      output.info(`Dostupné režimy: ${data.availableModes.join(', ')}`);
      console.log('');
      console.log(data.prompt);
    } catch (e: unknown) {
      output.error((e as Error).message);
      process.exit(1);
    }
  });
