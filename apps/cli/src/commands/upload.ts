import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ora from 'ora';
import { requireAuth } from '../lib/require-auth.js';
import * as output from '../lib/output.js';

export const uploadCommand = new Command('upload')
  .description('Nahrát obrázky (URL nebo lokální soubory)')
  .argument('<sources...>', 'URL adresy, lokální soubory, nebo .txt soubor se seznamem URL')
  .option('-c, --collection <id>', 'ID kolekce')
  .action(async (sources: string[], options: { collection?: string }) => {
    const { api } = requireAuth();

    const expanded = expandSources(sources);

    const urls: string[] = [];
    const localFiles: string[] = [];

    for (const src of expanded) {
      if (src.startsWith('http://') || src.startsWith('https://')) {
        urls.push(src);
      } else if (fs.existsSync(src)) {
        localFiles.push(src);
      } else {
        output.warn(`Přeskakuji: ${src} (soubor nenalezen)`);
      }
    }

    const spinner = ora('Nahrávám...').start();
    let totalPages = 0;
    let totalErrors = 0;

    if (urls.length > 0) {
      spinner.text = `Nahrávám ${urls.length} URL...`;
      try {
        const result = await api.postJson('/api/pages/upload-url', {
          urls,
          collectionId: options.collection,
        });
        totalPages += result.pages.length;
        totalErrors += result.errors.length;

        for (const page of result.pages) {
          spinner.stop();
          output.success(`  ${page.filename} → stránka ${page.id}`);
          spinner.start();
        }
        for (const err of result.errors) {
          spinner.stop();
          output.error(`  ${err.url}: ${err.error}`);
          spinner.start();
        }
      } catch (e: unknown) {
        spinner.stop();
        output.error((e as Error).message);
        process.exit(1);
      }
    }

    for (const filePath of localFiles) {
      spinner.text = `Nahrávám ${path.basename(filePath)}...`;
      try {
        const formData = new FormData();
        const buffer = fs.readFileSync(filePath);
        const blob = new Blob([buffer]);
        formData.append('files', blob, path.basename(filePath));
        if (options.collection) {
          formData.append('collectionId', options.collection);
        }

        const result = await api.postFormData('/api/pages/upload', formData);
        totalPages += result.pages.length;

        for (const page of result.pages) {
          spinner.stop();
          output.success(`  ${page.filename} → stránka ${page.id}`);
          spinner.start();
        }
        if (result.errors) {
          totalErrors += result.errors.length;
          for (const err of result.errors) {
            spinner.stop();
            output.error(`  ${err.filename}: ${err.error}`);
            spinner.start();
          }
        }
      } catch (e: unknown) {
        spinner.stop();
        output.error(`  ${filePath}: ${(e as Error).message}`);
        spinner.start();
        totalErrors++;
      }
    }

    spinner.stop();
    output.info(`Nahráno: ${totalPages} stránek, ${totalErrors} chyb`);
  });

function expandSources(sources: string[]): string[] {
  const result: string[] = [];
  for (const src of sources) {
    if (src.endsWith('.txt') && fs.existsSync(src)) {
      const lines = fs
        .readFileSync(src, 'utf-8')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      result.push(...lines);
    } else {
      result.push(src);
    }
  }
  return result;
}
