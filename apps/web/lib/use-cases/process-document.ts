import type {
  IPreprocessor,
  ILayoutClassifier,
  IOcrEngine,
  ITranslator,
  ProcessingResult,
} from '@ai-sedlacek/shared';
import crypto from 'crypto';
import { EnsembleOrchestrator } from './ensemble';

export class ProcessDocument {
  private readonly ensemble: EnsembleOrchestrator;

  constructor(
    private readonly preprocessor: IPreprocessor,
    private readonly classifier: ILayoutClassifier,
    engines: IOcrEngine[],
    private readonly translator: ITranslator,
  ) {
    this.ensemble = new EnsembleOrchestrator(engines);
  }

  async execute(
    imageBuffer: Buffer,
    originalImageUrl: string,
    targetLanguage: string,
  ): Promise<ProcessingResult> {
    // Step 1: Preprocess image
    const processedImage = await this.preprocessor.process(imageBuffer);

    // Step 2: Classify layout
    const classification = await this.classifier.classify(processedImage);

    // Step 3: Run OCR ensemble
    const ocrResults = await this.ensemble.run(processedImage);

    // Step 4: Consolidate and translate
    const consolidation = await this.translator.consolidateAndTranslate(
      processedImage,
      ocrResults,
      targetLanguage,
    );

    // Step 5: Polish translation
    const polishedTranslation = await this.translator.polish(
      consolidation.literalTranslation,
      targetLanguage,
    );

    // Step 6: Detect language from OCR results (use first recognizer engine output)
    const detectedLanguage = this.detectLanguage(ocrResults);

    return {
      id: crypto.randomUUID(),
      originalImage: originalImageUrl,
      classification,
      ocrResults,
      consolidatedText: consolidation.consolidatedText,
      literalTranslation: consolidation.literalTranslation,
      polishedTranslation,
      detectedLanguage,
      confidenceNotes: consolidation.notes,
    };
  }

  private detectLanguage(ocrResults: ProcessingResult['ocrResults']): string {
    const recognizerResult = ocrResults.find((r) => r.role === 'recognizer');
    if (!recognizerResult) {
      return 'neznámý';
    }
    // Basic heuristic: use engine name as language hint placeholder.
    // A real implementation would parse OCR output for language markers.
    return 'středověká čeština/němčina/latina';
  }
}
