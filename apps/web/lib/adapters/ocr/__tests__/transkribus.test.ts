import { describe, it, expect, vi, afterEach } from 'vitest';
import { TranskribusOcrEngine } from '../transkribus.js';

describe('TranskribusOcrEngine', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('name and role', () => {
    it('has correct name', () => {
      const engine = new TranskribusOcrEngine();
      expect(engine.name).toBe('transkribus');
    });

    it('has correct role', () => {
      const engine = new TranskribusOcrEngine();
      expect(engine.role).toBe('recognizer');
    });
  });

  describe('isAvailable()', () => {
    it('returns false when credentials are not set', async () => {
      vi.stubEnv('TRANSKRIBUS_EMAIL', '');
      vi.stubEnv('TRANSKRIBUS_PASSWORD', '');
      const engine = new TranskribusOcrEngine();
      const result = await engine.isAvailable();
      expect(result).toBe(false);
    });

    it('returns false when only email is set', async () => {
      vi.stubEnv('TRANSKRIBUS_EMAIL', 'user@example.com');
      vi.stubEnv('TRANSKRIBUS_PASSWORD', '');
      const engine = new TranskribusOcrEngine();
      const result = await engine.isAvailable();
      expect(result).toBe(false);
    });

    it('returns false when only password is set', async () => {
      vi.stubEnv('TRANSKRIBUS_EMAIL', '');
      vi.stubEnv('TRANSKRIBUS_PASSWORD', 'secret');
      const engine = new TranskribusOcrEngine();
      const result = await engine.isAvailable();
      expect(result).toBe(false);
    });

    it('returns true when both email and password are set', async () => {
      vi.stubEnv('TRANSKRIBUS_EMAIL', 'user@example.com');
      vi.stubEnv('TRANSKRIBUS_PASSWORD', 'secret');
      const engine = new TranskribusOcrEngine();
      const result = await engine.isAvailable();
      expect(result).toBe(true);
    });
  });
});
