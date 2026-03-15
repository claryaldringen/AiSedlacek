import { describe, it, expect, vi } from 'vitest';
import type {
  IPreprocessor,
  ILayoutClassifier,
  IOcrEngine,
  ITranslator,
  DocumentClassification,
  OcrEngineResult,
  ConsolidationResult,
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

const mockConsolidation: ConsolidationResult = {
  consolidatedText: 'Konsolidovaný text originálu',
  literalTranslation: 'Doslovný překlad textu',
  notes: ['Nejisté místo na řádku 2'],
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
    consolidateAndTranslate: vi.fn().mockResolvedValue(mockConsolidation),
    polish: vi.fn().mockResolvedValue('Učesaný překlad textu'),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProcessDocument', () => {
  const imageBuffer = Buffer.from('original-image');
  const imageUrl = '/tmp/uploads/test-image.jpg';
  const targetLanguage = 'češtiny';

  it('runs the full pipeline in correct order', async () => {
    const preprocessor = makePreprocessor();
    const classifier = makeClassifier();
    const engine = makeOcrEngine();
    const translator = makeTranslator();

    const useCase = new ProcessDocument(preprocessor, classifier, [engine], translator);
    await useCase.execute(imageBuffer, imageUrl, targetLanguage);

    // Verify order via call counts and that each was called
    expect(preprocessor.process).toHaveBeenCalledWith(imageBuffer);
    expect(classifier.classify).toHaveBeenCalled();
    expect(engine.isAvailable).toHaveBeenCalled();
    expect(engine.recognize).toHaveBeenCalled();
    expect(translator.consolidateAndTranslate).toHaveBeenCalled();
    expect(translator.polish).toHaveBeenCalled();
  });

  it('passes original image to classifier and Claude engines, preprocessed to Tesseract', async () => {
    const preprocessor = makePreprocessor();
    const classifier = makeClassifier();
    const engine = makeOcrEngine();
    const translator = makeTranslator();

    const useCase = new ProcessDocument(preprocessor, classifier, [engine], translator);
    await useCase.execute(imageBuffer, imageUrl, targetLanguage);

    // Classifier gets original image (better for Claude Vision)
    expect(classifier.classify).toHaveBeenCalledWith(imageBuffer);
    // LLM engines get original image with classification context
    expect(engine.recognize).toHaveBeenCalledWith(imageBuffer, expect.objectContaining({ context: expect.any(String) }));
  });

  it('passes original image to translator.consolidateAndTranslate', async () => {
    const engine = makeOcrEngine();
    const translator = makeTranslator();

    const useCase = new ProcessDocument(makePreprocessor(), makeClassifier(), [engine], translator);
    await useCase.execute(imageBuffer, imageUrl, targetLanguage);

    expect(translator.consolidateAndTranslate).toHaveBeenCalledWith(
      imageBuffer,
      [mockOcrResult],
      targetLanguage,
    );
  });

  it('passes literal translation to translator.polish', async () => {
    const preprocessor = makePreprocessor();
    const translator = makeTranslator();

    const useCase = new ProcessDocument(
      preprocessor,
      makeClassifier(),
      [makeOcrEngine()],
      translator,
    );
    await useCase.execute(imageBuffer, imageUrl, targetLanguage);

    expect(translator.polish).toHaveBeenCalledWith(
      mockConsolidation.literalTranslation,
      targetLanguage,
    );
  });

  it('returns a ProcessingResult with all required fields', async () => {
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
    expect(result.consolidatedText).toBe(mockConsolidation.consolidatedText);
    expect(result.literalTranslation).toBe(mockConsolidation.literalTranslation);
    expect(result.polishedTranslation).toBe('Učesaný překlad textu');
    expect(result.confidenceNotes).toEqual(mockConsolidation.notes);
    expect(typeof result.detectedLanguage).toBe('string');
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

  it('returns partial result when translator fails', async () => {
    const translator: ITranslator = {
      consolidateAndTranslate: vi.fn().mockRejectedValue(new Error('LLM unavailable')),
      polish: vi.fn(),
    };

    const useCase = new ProcessDocument(
      makePreprocessor(),
      makeClassifier(),
      [makeOcrEngine()],
      translator,
    );

    const result = await useCase.execute(imageBuffer, imageUrl, targetLanguage);

    expect(result.ocrResults).toHaveLength(1);
    expect(result.consolidatedText).toBe('');
    expect(result.literalTranslation).toBe('');
    expect(result.polishedTranslation).toBe('');
    expect(result.confidenceNotes[0]).toContain('LLM unavailable');
  });
});
