import type { IPreprocessor } from '@ai-sedlacek/shared';
import sharp from 'sharp';

export class SharpPreprocessor implements IPreprocessor {
  async process(image: Buffer): Promise<Buffer> {
    return sharp(image)
      .toColourspace('b-w')
      .normalize()
      .sharpen({ sigma: 1.5 })
      .threshold(128)
      .resize({ width: 3000, withoutEnlargement: true })
      .png()
      .toBuffer();
  }
}
