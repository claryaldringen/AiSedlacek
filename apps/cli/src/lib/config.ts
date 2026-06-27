import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface CliConfig {
  server: string;
}

const DEFAULT_CONFIG: CliConfig = {
  server: 'https://aisedlacek.com',
};

export function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'ai-sedlacek');
}

export function loadConfig(): CliConfig {
  const configPath = path.join(getConfigDir(), 'config.json');
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    // Poškozený konfigurační soubor nesmí shodit CLI — varuj a použij výchozí nastavení.
    console.error(
      `Varování: konfigurační soubor ${configPath} je poškozený, používám výchozí nastavení.`,
    );
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: CliConfig): void {
  const dir = getConfigDir();
  // Adresář jen pro vlastníka (0o700) — obsahuje i auth.json s tokenem.
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
}
