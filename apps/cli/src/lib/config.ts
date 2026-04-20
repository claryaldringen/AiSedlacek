import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface CliConfig {
  server: string;
}

const DEFAULT_CONFIG: CliConfig = {
  server: 'https://sedlacek.ai',
};

export function getConfigDir(): string {
  return path.join(os.homedir(), '.config', 'ai-sedlacek');
}

export function loadConfig(): CliConfig {
  const configPath = path.join(getConfigDir(), 'config.json');
  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
}

export function saveConfig(config: CliConfig): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
}
