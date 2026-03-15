import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to declare mock functions before vi.mock hoisting
const { mockRecognize, mockSetParameters, mockTerminate, mockCreateWorker } = vi.hoisted(() => {
  const mockRecognize = vi.fn();
  const mockSetParameters = vi.fn();
  const mockTerminate = vi.fn();
  const mockCreateWorker = vi.fn().mockResolvedValue({
    recognize: mockRecognize,
    setParameters: mockSetParameters,
    terminate: mockTerminate,
  });
  return { mockRecognize, mockSetParameters, mockTerminate, mockCreateWorker };
});

vi.mock('tesseract.js', () => ({
  createWorker: mockCreateWorker,
  PSM: {
    AUTO: '3',
  },
}));

import { TesseractOcrEngine } from '../tesseract.js';
import { createWorker } from 'tesseract.js';

describe('TesseractOcrEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockRecognize.mockResolvedValue({
      data: {
        text: 'Erkannter Text aus dem Bild\nZweite Zeile',
        confidence: 75,
      },
    });
    mockCreateWorker.mockResolvedValue({
      recognize: mockRecognize,
      setParameters: mockSetParameters,
      terminate: mockTerminate,
    });
  });

  it('has correct name and role', () => {
    const engine = new TesseractOcrEngine();
    expect(engine.name).toBe('tesseract');
    expect(engine.role).toBe('recognizer');
  });

  it('isAvailable always returns true', async () => {
    const engine = new TesseractOcrEngine();
    expect(await engine.isAvailable()).toBe(true);
  });

  it('creates worker with configured language', async () => {
    const engine = new TesseractOcrEngine('deu_frak');
    await engine.recognize(Buffer.from('test'));
    expect(createWorker).toHaveBeenCalledWith('deu_frak', undefined, undefined);
  });

  it('uses TESSERACT_LANG env var as default', async () => {
    vi.stubEnv('TESSERACT_LANG', 'lat');
    const engine = new TesseractOcrEngine();
    await engine.recognize(Buffer.from('test'));
    expect(createWorker).toHaveBeenCalledWith('lat', undefined, undefined);
  });

  it('falls back to deu+ces+lat when no config', async () => {
    const engine = new TesseractOcrEngine();
    await engine.recognize(Buffer.from('test'));
    expect(createWorker).toHaveBeenCalledWith('deu+ces+lat', undefined, undefined);
  });

  it('accepts TesseractConfig object', async () => {
    const engine = new TesseractOcrEngine({ language: 'frk', label: 'Fraktur', psm: '6' as never });
    await engine.recognize(Buffer.from('test'));
    expect(createWorker).toHaveBeenCalledWith('frk', undefined, undefined);
    expect(engine.label).toBe('Fraktur');
  });

  it('recognize returns OcrEngineResult with text and confidence', async () => {
    const engine = new TesseractOcrEngine();
    const result = await engine.recognize(Buffer.from('fake-image'));

    expect(result.engine).toBe('tesseract');
    expect(result.role).toBe('recognizer');
    expect(result.text).toBe('Erkannter Text aus dem Bild\nZweite Zeile');
    expect(result.confidence).toBe(0.75); // normalized from 75
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('sets correct Tesseract parameters', async () => {
    const engine = new TesseractOcrEngine();
    await engine.recognize(Buffer.from('test'));

    expect(mockSetParameters).toHaveBeenCalledWith({
      tessedit_pageseg_mode: '3', // PSM.AUTO
      preserve_interword_spaces: '1',
    });
  });

  it('terminates worker after recognition', async () => {
    const engine = new TesseractOcrEngine();
    await engine.recognize(Buffer.from('test'));
    expect(mockTerminate).toHaveBeenCalled();
  });
});
