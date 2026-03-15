import type { IOcrEngine, OcrEngineResult, OcrOptions } from '@ai-sedlacek/shared';
import { createWorker, PSM } from 'tesseract.js';

export class TesseractOcrEngine implements IOcrEngine {
  readonly name = 'tesseract' as const;
  readonly role = 'recognizer' as const;

  private readonly language: string;

  constructor(language?: string) {
    this.language = language ?? process.env['TESSERACT_LANG'] ?? 'deu+ces+lat';
  }

  async isAvailable(): Promise<boolean> {
    return true; // Tesseract.js always available in Node.js
  }

  async recognize(image: Buffer, options?: OcrOptions): Promise<OcrEngineResult> {
    void options; // options reserved for future use (language hints, tier)
    const startTime = Date.now();

    const worker = await createWorker(this.language);

    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO, // Fully automatic segmentation
      preserve_interword_spaces: '1',
    });

    const { data } = await worker.recognize(image);
    await worker.terminate();

    return {
      engine: this.name,
      role: this.role,
      text: data.text,
      confidence: data.confidence / 100, // Tesseract returns 0-100, normalize to 0-1
      processingTimeMs: Date.now() - startTime,
    };
  }
}
