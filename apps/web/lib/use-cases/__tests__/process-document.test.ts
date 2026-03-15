import { describe, it, expect, vi } from 'vitest';
import type {
  IPreprocessor,
  ILayoutClassifier,
  IOcrEngine,
  ITranslator,
  DocumentClassification,
  OcrEngineResult,
} from '@ai-sedlacek/shared';
import { ProcessDocument } from '../process-document.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockClassification: DocumentClassification = {
  tier: 'tier1',
  scriptType: 'print',
  layoutComplexity: 'simple',
  detectedFeatures: ['fraktur'],
  confidence: 0.9,
  reasoning: 'Tištěný text',
};

const mockOcrResult: OcrEngineResult = {
  engine: 'ollama_vision',
  role: 'recognizer',
  text: 'Středověký přepsaný text',
  processingTimeMs: 100,
};

function makePreprocessor(): IPreprocessor {
  return {
    process: vi.fn().mockResolvedValue(Buffer.from('processed-image')),
  };
}

function makeClassifier(): ILayoutClassifier {
  return {
    classify: vi.fn().mockResolvedValue(mockClassification),
  };
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
  return {
    consolidateAndTranslate: vi.fn(),
    polish: vi.fn(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProcessDocument', () => {
  const imageBuffer = Buffer.from('original-image');
  const imageUrl = '/tmp/uploads/test-image.jpg';
  const targetLanguage = 'češtiny';

  it('runs preprocessing, classification and OCR', async () => {
    const preprocessor = makePreprocessor();
    const classifier = makeClassifier();
    const engine = makeOcrEngine();
    const translator = makeTranslator();

    const useCase = new ProcessDocument(preprocessor, classifier, [engine], translator);
    await useCase.execute(imageBuffer, imageUrl, targetLanguage);

    expect(preprocessor.process).toHaveBeenCalledWith(imageBuffer);
    expect(classifier.classify).toHaveBeenCalled();
    expect(engine.isAvailable).toHaveBeenCalled();
    expect(engine.recognize).toHaveBeenCalled();
  });

  it('passes original image to classifier', async () => {
    const classifier = makeClassifier();
    const useCase = new ProcessDocument(makePreprocessor(), classifier, [makeOcrEngine()], makeTranslator());
    await useCase.execute(imageBuffer, imageUrl, targetLanguage);

    expect(classifier.classify).toHaveBeenCalledWith(imageBuffer);
  });

  it('passes classification context to OCR engines', async () => {
    const engine = makeOcrEngine();
    const useCase = new ProcessDocument(makePreprocessor(), makeClassifier(), [engine], makeTranslator());
    await useCase.execute(imageBuffer, imageUrl, targetLanguage);

    expect(engine.recognize).toHaveBeenCalledWith(
      imageBuffer,
      expect.objectContaining({ context: expect.any(String) }),
    );
  });

  it('returns ProcessingResult with OCR results and empty translations (temporarily disabled)', async () => {
    const useCase = new ProcessDocument(
      makePreprocessor(),
      makeClassifier(),
      [makeOcrEngine()],
      makeTranslator(),
    );

    const result = await useCase.execute(imageBuffer, imageUrl, targetLanguage);

    expect(result.id).toBeTruthy();
    expect(result.originalImage).toBe(imageUrl);
    expect(result.classification).toEqual(mockClassification);
    expect(result.ocrResults).toHaveLength(1);
    // Translations temporarily disabled
    expect(result.consolidatedText).toBe('');
    expect(result.literalTranslation).toBe('');
    expect(result.polishedTranslation).toBe('');
    expect(result.confidenceNotes[0]).toContain('dočasně');
  });

  it('generates a unique id for each execution', async () => {
    const useCase = new ProcessDocument(
      makePreprocessor(),
      makeClassifier(),
      [makeOcrEngine()],
      makeTranslator(),
    );

    const result1 = await useCase.execute(imageBuffer, imageUrl, targetLanguage);
    const result2 = await useCase.execute(imageBuffer, imageUrl, targetLanguage);

    expect(result1.id).not.toBe(result2.id);
  });

  it('propagates errors from preprocessor', async () => {
    const preprocessor: IPreprocessor = {
      process: vi.fn().mockRejectedValue(new Error('Preprocessing failed')),
    };

    const useCase = new ProcessDocument(
      preprocessor,
      makeClassifier(),
      [makeOcrEngine()],
      makeTranslator(),
    );

    await expect(useCase.execute(imageBuffer, imageUrl, targetLanguage)).rejects.toThrow(
      'Preprocessing failed',
    );
  });
});
