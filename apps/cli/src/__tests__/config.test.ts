import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getConfigDir, loadConfig } from '../lib/config.js';
import * as fs from 'node:fs';
import * as os from 'node:os';

vi.mock('node:fs');
vi.mock('node:os');

describe('config', () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue('/home/test');
  });

  it('returns config dir path', () => {
    expect(getConfigDir()).toBe('/home/test/.config/ai-sedlacek');
  });

  it('loads config from file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ server: 'https://sedlacek.ai' }));
    const config = loadConfig();
    expect(config.server).toBe('https://sedlacek.ai');
  });

  it('returns defaults when no config file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const config = loadConfig();
    expect(config.server).toBe('https://sedlacek.ai');
  });
});
