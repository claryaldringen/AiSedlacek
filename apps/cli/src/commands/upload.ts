import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ora from 'ora';
import { requireAuth } from '../lib/require-auth.js';
import { detectImageMimeType } from '../lib/mime.js';
import * as output from '../lib/output.js';

/** Počet URL v jednom requestu na /api/pages/upload-url (server jich přijme víc). */
const URL_BATCH_SIZE = 50;

export const uploadCommand = new Command('upload')
  .description('Nahrát obrázky (URL nebo lokální soubory)')
  .argument('<sources...>', 'URL adresy, lokální soubory, nebo .txt soubor se seznamem URL')
  .option('-c, --collection <id>', 'ID kolekce')
  .action(async (sources: string[], options: { collection?: string }) => {
    const { api } = requireAuth();

    const expanded = expandSources(sources);

    const urls: string[] = [];
    const localFiles: string[] = [];
    let totalErrors = 0;

    for (const src of expanded) {
      if (src.startsWith('http://') || src.startsWith('https://')) {
        urls.push(src);
      } else if (fs.existsSync(src)) {
        localFiles.push(src);
      } else {
        output.error(`Přeskakuji: ${src} (soubor nenalezen)`);
        totalErrors++;
      }
    }

    const spinner = ora('Nahrávám...').start();
    let totalPages = 0;

    // Server přijme v jednom requestu omezený počet URL – posílat po dávkách.
    for (let start = 0; start < urls.length; start += URL_BATCH_SIZE) {
      const batch = urls.slice(start, start + URL_BATCH_SIZE);
      spinner.text = `Nahrávám URL ${start + 1}–${start + batch.length} z ${urls.length}...`;
      try {
        const result = await api.postJson('/api/pages/upload-url', {
          urls: batch,
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
        const buffer = fs.readFileSync(filePath);
        // Klientský pre-check: nepodporovaný soubor selže hned, bez zbytečného uploadu.
        // Autoritou je server – formát pozná z obsahu a `type` Blobu ignoruje.
        // Typ určujeme z obsahu, ne z přípony.
        const type = detectImageMimeType(buffer);
        if (!type) {
          spinner.stop();
          output.error(`  ${filePath}: nepodporovaný formát – obsah není JPEG, PNG, WebP ani TIFF`);
          spinner.start();
          totalErrors++;
          continue;
        }

        const formData = new FormData();
        const blob = new Blob([buffer], { type });
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
    // Chyby jednotlivých souborů nesmí skončit úspěšným exit kódem (skripty/agenti).
    if (totalErrors > 0) process.exitCode = 1;
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
