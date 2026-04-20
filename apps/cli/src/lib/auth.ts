import * as fs from 'node:fs';
import * as path from 'node:path';
import { getConfigDir } from './config.js';

function getAuthPath(): string {
  return path.join(getConfigDir(), 'auth.json');
}

export function getToken(): string | null {
  const authPath = getAuthPath();
  if (!fs.existsSync(authPath)) return null;
  try {
    const raw = fs.readFileSync(authPath, 'utf-8');
    const data = JSON.parse(raw);
    return data.token ?? null;
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getAuthPath(), JSON.stringify({ token }, null, 2), {
    mode: 0o600,
  });
}

export function deleteToken(): void {
  const authPath = getAuthPath();
  if (fs.existsSync(authPath)) {
    fs.unlinkSync(authPath);
  }
}
