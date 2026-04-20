import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToken, saveToken, deleteToken } from '../lib/auth.js';
import * as fs from 'node:fs';
import * as os from 'node:os';

vi.mock('node:fs');
vi.mock('node:os');

describe('auth', () => {
  beforeEach(() => {
    vi.mocked(os.homedir).mockReturnValue('/home/test');
  });

  it('returns null when no token file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(getToken()).toBeNull();
  });

  it('reads token from file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ token: 'test-token-123' }),
    );
    expect(getToken()).toBe('test-token-123');
  });

  it('saves token to file', () => {
    const writeSpy = vi.mocked(fs.writeFileSync);
    saveToken('new-token');
    expect(writeSpy).toHaveBeenCalledWith(
      '/home/test/.config/ai-sedlacek/auth.json',
      JSON.stringify({ token: 'new-token' }, null, 2),
    );
  });

  it('deletes token file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const unlinkSpy = vi.mocked(fs.unlinkSync);
    deleteToken();
    expect(unlinkSpy).toHaveBeenCalled();
  });
});
