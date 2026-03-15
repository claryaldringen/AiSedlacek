import type { IPreprocessor } from '@ai-sedlacek/shared';
import sharp from 'sharp';

export class SharpPreprocessor implements IPreprocessor {
  async process(image: Buffer): Promise<Buffer> {
    return sharp(image)
      .greyscale()
      .normalize()
      .sharpen({ sigma: 1.0 })
      .resize({ width: 3000, withoutEnlargement: true })
      .png()
      .toBuffer();
  }
}
