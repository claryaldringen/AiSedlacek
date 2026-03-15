import { describe, it, expect, vi } from 'vitest';
import type {
  IPreprocessor,
  ILayoutClassifier,
  IOcrEngine,
  ITranslator,
  OcrEngineResult,
} from '@ai-sedlacek/shared';
import { ProcessDocument } from '../process-document.js';

const mockOcrResult: OcrEngineResult = {
  engine: 'ollama_vision',
  role: 'recognizer',
  text: 'Středověký přepsaný text',
  processingTimeMs: 100,
};

function makePreprocessor(): IPreprocessor {
  return { process: vi.fn().mockResolvedValue(Buffer.from('processed-image')) };
}

function makeClassifier(): ILayoutClassifier {
  return { classify: vi.fn() };
}

function makeOcrEngine(available = true): IOcrEngine {
  return {
    name: 'ollama_vision',
    role: 'recognizer',
    isAvailable: vi.fn().mockResolvedValue(available),
    recognize: vi.fn().mockResolvedValue(mockOcrResult),
  };
}

function makeTranslator(): ITranslator {
  return { consolidateAndTranslate: vi.fn(), polish: vi.fn() };
}

describe('ProcessDocument', () => {
  const imageBuffer = Buffer.from('original-image');
  const imageUrl = '/tmp/uploads/test-image.jpg';

  it('runs preprocessing and OCR (classification skipped)', async () => {
    const preprocessor = makePreprocessor();
    const engine = makeOcrEngine();

    const useCase = new ProcessDocument(preprocessor, makeClassifier(), [engine], makeTranslator());
    await useCase.execute(imageBuffer, imageUrl, 'češtiny');

    expect(preprocessor.process).toHaveBeenCalledWith(imageBuffer);
    expect(engine.recognize).toHaveBeenCalled();
  });

  it('does not call classifier', async () => {
    const classifier = makeClassifier();
    const useCase = new ProcessDocument(makePreprocessor(), classifier, [makeOcrEngine()], makeTranslator());
    await useCase.execute(imageBuffer, imageUrl, 'češtiny');

    expect(classifier.classify).not.toHaveBeenCalled();
  });

  it('returns ProcessingResult with OCR results', async () => {
    const useCase = new ProcessDocument(makePreprocessor(), makeClassifier(), [makeOcrEngine()], makeTranslator());
    const result = await useCase.execute(imageBuffer, imageUrl, 'češtiny');

    expect(result.id).toBeTruthy();
    expect(result.originalImage).toBe(imageUrl);
    expect(result.ocrResults).toHaveLength(1);
    expect(result.ocrResults[0].text).toBe('Středověký přepsaný text');
    expect(result.consolidatedText).toBe('');
    expect(result.confidenceNotes[0]).toContain('dočasně');
  });

  it('generates unique ids', async () => {
    const useCase = new ProcessDocument(makePreprocessor(), makeClassifier(), [makeOcrEngine()], makeTranslator());
    const r1 = await useCase.execute(imageBuffer, imageUrl, 'češtiny');
    const r2 = await useCase.execute(imageBuffer, imageUrl, 'češtiny');
    expect(r1.id).not.toBe(r2.id);
  });

  it('propagates preprocessing errors', async () => {
    const preprocessor: IPreprocessor = {
      process: vi.fn().mockRejectedValue(new Error('Preprocessing failed')),
    };
    const useCase = new ProcessDocument(preprocessor, makeClassifier(), [makeOcrEngine()], makeTranslator());
    await expect(useCase.execute(imageBuffer, imageUrl, 'češtiny')).rejects.toThrow('Preprocessing failed');
  });
});
