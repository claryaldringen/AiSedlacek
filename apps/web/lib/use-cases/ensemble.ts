import type { IOcrEngine, OcrEngineResult, OcrOptions } from '@ai-sedlacek/shared';

export class EnsembleOrchestrator {
  constructor(private readonly engines: IOcrEngine[]) {}

  async run(originalImage: Buffer, preprocessedImage?: Buffer, options?: OcrOptions): Promise<OcrEngineResult[]> {
    if (this.engines.length === 0) {
      throw new Error('No OCR engines configured');
    }

    // Check availability of all engines in parallel
    const availabilityResults = await Promise.all(
      this.engines.map(async (engine) => ({
        engine,
        available: await engine.isAvailable(),
      })),
    );

    const availableEngines = availabilityResults
      .filter(({ engine, available }) => {
        if (!available) {
          console.warn(`[Ensemble] Engine "${engine.name}" is not available, skipping`);
        }
        return available;
      })
      .map(({ engine }) => engine);

    if (availableEngines.length === 0) {
      throw new Error('No OCR engines are available');
    }

    console.log(
      `[Ensemble] Running ${availableEngines.length} engine(s): ${availableEngines.map((e) => e.name).join(', ')}`,
    );

    // Run all available engines in parallel, capturing failures gracefully
    const settledResults = await Promise.allSettled(
      availableEngines.map(async (engine) => {
        const startTime = Date.now();
        console.log(`[Ensemble] Starting engine "${engine.name}"`);
        try {
          // Tesseract gets preprocessed image (better for OCR), LLM engines get original
          const imageForEngine =
            engine.name === 'tesseract' && preprocessedImage ? preprocessedImage : originalImage;
          const result = await engine.recognize(imageForEngine, options);
          const elapsed = Date.now() - startTime;
          console.log(
            `[Ensemble] Engine "${engine.name}" finished in ${elapsed}ms, output length: ${result.text.length}`,
          );
          return result;
        } catch (err) {
          const elapsed = Date.now() - startTime;
          console.error(
            `[Ensemble] Engine "${engine.name}" failed after ${elapsed}ms:`,
            err instanceof Error ? err.message : String(err),
          );
          throw err;
        }
      }),
    );

    const successfulResults: OcrEngineResult[] = [];

    for (const settled of settledResults) {
      if (settled.status === 'fulfilled') {
        successfulResults.push(settled.value);
      } else {
        console.warn(`[Ensemble] An engine failed:`, settled.reason);
      }
    }

    if (successfulResults.length === 0) {
      throw new Error('All OCR engines failed to produce results');
    }

    console.log(
      `[Ensemble] Completed: ${successfulResults.length}/${availableEngines.length} engines succeeded`,
    );

    return successfulResults;
  }
}
