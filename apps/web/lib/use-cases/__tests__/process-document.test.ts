import { describe, it, expect, vi } from 'vitest';
import type { IOcrEngine, OcrEngineResult } from '@ai-sedlacek/shared';
import { ProcessDocument } from '../process-document.js';

const mockOcrResult: OcrEngineResult = {
  engine: 'claude_vision',
  role: 'recognizer',
  text: 'Přepis středověkého textu s překladem a slovníčkem.',
  processingTimeMs: 5000,
};

function makeEngine(): IOcrEngine {
  return {
    name: 'claude_vision',
    role: 'recognizer',
    isAvailable: vi.fn().mockResolvedValue(true),
    recognize: vi.fn().mockResolvedValue(mockOcrResult),
  };
}

describe('ProcessDocument', () => {
  const imageBuffer = Buffer.from('original-image');
  const imageUrl = '/api/images/test.jpg';

  it('calls engine.recognize with image buffer', async () => {
    const engine = makeEngine();
    const useCase = new ProcessDocument(engine);
    await useCase.execute(imageBuffer, imageUrl);

    expect(engine.recognize).toHaveBeenCalledWith(imageBuffer);
  });

  it('returns ProcessingResult with OCR output', async () => {
    const useCase = new ProcessDocument(makeEngine());
    const result = await useCase.execute(imageBuffer, imageUrl);

    expect(result.id).toBeTruthy();
    expect(result.originalImage).toBe(imageUrl);
    expect(result.ocrResults).toHaveLength(1);
    expect(result.consolidatedText).toBe(mockOcrResult.text);
  });

  it('generates unique ids', async () => {
    const useCase = new ProcessDocument(makeEngine());
    const r1 = await useCase.execute(imageBuffer, imageUrl);
    const r2 = await useCase.execute(imageBuffer, imageUrl);
    expect(r1.id).not.toBe(r2.id);
  });

  it('propagates engine errors', async () => {
    const engine: IOcrEngine = {
      name: 'claude_vision',
      role: 'recognizer',
      isAvailable: vi.fn().mockResolvedValue(true),
      recognize: vi.fn().mockRejectedValue(new Error('API error')),
    };
    const useCase = new ProcessDocument(engine);
    await expect(useCase.execute(imageBuffer, imageUrl)).rejects.toThrow('API error');
  });
});
