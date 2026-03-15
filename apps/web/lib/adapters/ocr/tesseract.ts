import type { IOcrEngine, OcrEngineResult, OcrEngineName, OcrOptions } from '@ai-sedlacek/shared';
import { createWorker, PSM } from 'tesseract.js';

export interface TesseractConfig {
  /** Language code(s), e.g. 'deu', 'frk', 'deu+ces+lat' */
  language: string;
  /** Human-readable label for this config (shown in UI) */
  label: string;
  /** Page segmentation mode */
  psm?: PSM;
  /** Path to custom .traineddata file (optional, overrides CDN) */
  langPath?: string;
}

/** Pre-defined configurations for medieval text OCR */
export const TESSERACT_CONFIGS: TesseractConfig[] = [
  { language: 'frk', label: 'Fraktur', psm: PSM.SINGLE_BLOCK },
  { language: 'deu+ces+lat', label: 'DEU+CES+LAT', psm: PSM.AUTO },
  { language: 'lat', label: 'Latina', psm: PSM.SINGLE_BLOCK },
];

export class TesseractOcrEngine implements IOcrEngine {
  readonly name: OcrEngineName;
  readonly role = 'recognizer' as const;

  private readonly config: TesseractConfig;

  constructor(config?: TesseractConfig | string) {
    if (typeof config === 'string' || config === undefined) {
      const lang = config ?? process.env['TESSERACT_LANG'] ?? 'deu+ces+lat';
      this.config = { language: lang, label: lang, psm: PSM.AUTO };
    } else {
      this.config = config;
    }
    // Each config gets a unique engine name for ensemble identification
    this.name = `tesseract` as OcrEngineName;
  }

  /** Label shown in OCR results to distinguish configs */
  get label(): string {
    return this.config.label;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async recognize(image: Buffer, _options?: OcrOptions): Promise<OcrEngineResult> {
    const startTime = Date.now();

    const worker = await createWorker(this.config.language, undefined,
      this.config.langPath ? { langPath: this.config.langPath } : undefined,
    );

    await worker.setParameters({
      tessedit_pageseg_mode: this.config.psm ?? PSM.AUTO,
      preserve_interword_spaces: '1',
    });

    const { data } = await worker.recognize(image);
    await worker.terminate();

    return {
      engine: this.name,
      role: this.role,
      text: data.text,
      confidence: data.confidence / 100,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

/** Create multiple Tesseract engines from pre-defined configs */
export function createTesseractEngines(configs?: TesseractConfig[]): TesseractOcrEngine[] {
  return (configs ?? TESSERACT_CONFIGS).map((c) => new TesseractOcrEngine(c));
}
