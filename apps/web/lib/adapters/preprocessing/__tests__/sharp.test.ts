import { describe, it, expect } from 'vitest';
import { SharpPreprocessor } from '../sharp.js';
import sharp from 'sharp';

describe('SharpPreprocessor', () => {
  const preprocessor = new SharpPreprocessor();

  it('processes an image and returns a buffer', async () => {
    const input = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .jpeg()
      .toBuffer();
    const result = await preprocessor.process(input);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('produces a valid processed image', async () => {
    const input = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    const result = await preprocessor.process(input);
    const metadata = await sharp(result).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(50);
  });

  it('limits width to 3000px', async () => {
    const input = await sharp({
      create: { width: 5000, height: 1000, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .jpeg()
      .toBuffer();
    const result = await preprocessor.process(input);
    const metadata = await sharp(result).metadata();
    expect(metadata.width).toBeLessThanOrEqual(3000);
  });
});
