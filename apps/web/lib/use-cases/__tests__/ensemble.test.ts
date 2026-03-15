import { describe, it, expect, vi } from 'vitest';
import type { IOcrEngine, OcrEngineResult, OcrOptions } from '@ai-sedlacek/shared';
import { EnsembleOrchestrator } from '../ensemble.js';

function makeEngineResult(engine: string, text: string): OcrEngineResult {
  return {
    engine: engine as OcrEngineResult['engine'],
    role: 'recognizer',
    text,
    processingTimeMs: 10,
  };
}

function makeMockEngine(
  name: string,
  available: boolean,
  result?: OcrEngineResult,
  shouldFail = false,
): IOcrEngine {
  return {
    name: name as IOcrEngine['name'],
    role: 'recognizer',
    isAvailable: vi.fn().mockResolvedValue(available),
    recognize: shouldFail
      ? vi.fn().mockRejectedValue(new Error(`${name} failed`))
      : vi.fn().mockResolvedValue(result ?? makeEngineResult(name, `text from ${name}`)),
  };
}

describe('EnsembleOrchestrator', () => {
  const imageBuffer = Buffer.from('test-image');

  describe('runs available engines in parallel', () => {
    it('runs all engines when all are available', async () => {
      const engine1 = makeMockEngine('ollama_vision', true);
      const engine2 = makeMockEngine('claude_vision', true);
      const orchestrator = new EnsembleOrchestrator([engine1, engine2]);

      const results = await orchestrator.run(imageBuffer);

      expect(results).toHaveLength(2);
      expect(engine1.recognize).toHaveBeenCalledWith(imageBuffer, undefined);
      expect(engine2.recognize).toHaveBeenCalledWith(imageBuffer, undefined);
    });

    it('passes options to engines', async () => {
      const engine = makeMockEngine('ollama_vision', true);
      const orchestrator = new EnsembleOrchestrator([engine]);
      const options: OcrOptions = { language: 'deu' };

      await orchestrator.run(imageBuffer, undefined, options);

      expect(engine.recognize).toHaveBeenCalledWith(imageBuffer, options);
    });

    it('checks isAvailable on all engines before running', async () => {
      const engine1 = makeMockEngine('ollama_vision', true);
      const engine2 = makeMockEngine('claude_vision', true);
      const orchestrator = new EnsembleOrchestrator([engine1, engine2]);

      await orchestrator.run(imageBuffer);

      expect(engine1.isAvailable).toHaveBeenCalled();
      expect(engine2.isAvailable).toHaveBeenCalled();
    });
  });

  describe('skips unavailable engines', () => {
    it('does not call recognize on unavailable engine', async () => {
      const available = makeMockEngine('ollama_vision', true);
      const unavailable = makeMockEngine('claude_vision', false);
      const orchestrator = new EnsembleOrchestrator([available, unavailable]);

      const results = await orchestrator.run(imageBuffer);

      expect(results).toHaveLength(1);
      expect(available.recognize).toHaveBeenCalled();
      expect(unavailable.recognize).not.toHaveBeenCalled();
    });

    it('returns empty results when no engines are available and none produce results', async () => {
      const unavailable = makeMockEngine('ollama_vision', false);
      const orchestrator = new EnsembleOrchestrator([unavailable]);

      await expect(orchestrator.run(imageBuffer)).rejects.toThrow();
    });
  });

  describe('graceful degradation', () => {
    it('continues when one engine fails, returns results from successful engines', async () => {
      const goodEngine = makeMockEngine('ollama_vision', true);
      const failingEngine = makeMockEngine('claude_vision', true, undefined, true);
      const orchestrator = new EnsembleOrchestrator([goodEngine, failingEngine]);

      const results = await orchestrator.run(imageBuffer);

      expect(results).toHaveLength(1);
      expect(results[0]?.engine).toBe('ollama_vision');
    });

    it('does not throw when one engine fails out of multiple', async () => {
      const goodEngine = makeMockEngine('ollama_vision', true);
      const failingEngine = makeMockEngine('claude_vision', true, undefined, true);
      const orchestrator = new EnsembleOrchestrator([goodEngine, failingEngine]);

      await expect(orchestrator.run(imageBuffer)).resolves.toBeDefined();
    });
  });

  describe('throws when no engines produce results', () => {
    it('throws when all available engines fail', async () => {
      const failing1 = makeMockEngine('ollama_vision', true, undefined, true);
      const failing2 = makeMockEngine('claude_vision', true, undefined, true);
      const orchestrator = new EnsembleOrchestrator([failing1, failing2]);

      await expect(orchestrator.run(imageBuffer)).rejects.toThrow();
    });

    it('throws when no engines are available', async () => {
      const unavailable = makeMockEngine('ollama_vision', false);
      const orchestrator = new EnsembleOrchestrator([unavailable]);

      await expect(orchestrator.run(imageBuffer)).rejects.toThrow();
    });

    it('throws with empty engine list', async () => {
      const orchestrator = new EnsembleOrchestrator([]);

      await expect(orchestrator.run(imageBuffer)).rejects.toThrow();
    });
  });

  describe('measures processing time', () => {
    it('returns results with processingTimeMs', async () => {
      const engine = makeMockEngine('ollama_vision', true);
      const orchestrator = new EnsembleOrchestrator([engine]);

      const results = await orchestrator.run(imageBuffer);

      expect(typeof results[0]?.processingTimeMs).toBe('number');
      expect(results[0]?.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('with single engine', () => {
    it('returns result from single engine', async () => {
      const engineResult = makeEngineResult('ollama_vision', 'středověký text');
      const engine = makeMockEngine('ollama_vision', true, engineResult);
      const orchestrator = new EnsembleOrchestrator([engine]);

      const results = await orchestrator.run(imageBuffer);

      expect(results).toHaveLength(1);
      expect(results[0]?.text).toBe('středověký text');
    });
  });
});
