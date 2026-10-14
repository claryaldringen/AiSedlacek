import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import sharp from 'sharp';
import { prepareImage } from '../prepare-image.js';
import { sniffMediaType } from '../parse.js';

// Skutečný sharp (bez mocku) – testuje se reálná konverze formátů.
vi.spyOn(console, 'log').mockImplementation(() => {});

function solid(width: number, height: number): sharp.Sharp {
  return sharp({ create: { width, height, channels: 3, background: '#cc9966' } });
}

describe('prepareImage (LLM-1)', () => {
  it('malý TIFF převede na skutečný JPEG (dřív odešel jako image/jpeg beze změny)', async () => {
    const tiff = await solid(60, 40).tiff().toBuffer();
    expect(tiff.length).toBeLessThan(1024 * 1024);

    const { buffer, mediaType } = await prepareImage(tiff);

    expect(mediaType).toBe('image/jpeg');
    expect(sniffMediaType(buffer)).toBe('image/jpeg');
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([60, 40]);
  });

  it('malý JPEG bez EXIF orientace pošle beze změny', async () => {
    const jpeg = await solid(60, 40).jpeg().toBuffer();
    const { buffer, mediaType } = await prepareImage(jpeg);
    expect(mediaType).toBe('image/jpeg');
    expect(buffer).toBe(jpeg);
  });

  it('PNG a WebP pod limitem pošle beze změny se správným media type', async () => {
    const png = await solid(30, 30).png().toBuffer();
    const webp = await solid(30, 30).webp().toBuffer();
    expect(await prepareImage(png)).toEqual({ buffer: png, mediaType: 'image/png' });
    expect(await prepareImage(webp)).toEqual({ buffer: webp, mediaType: 'image/webp' });
  });

  it('respektuje EXIF orientaci – obrázek otočí a orientaci odstraní', async () => {
    // 60×40 s orientací 6 (otočit o 90°) → po otočení 40×60
    const jpeg = await solid(60, 40).jpeg().withMetadata({ orientation: 6 }).toBuffer();

    const { buffer, mediaType } = await prepareImage(jpeg);

    expect(mediaType).toBe('image/jpeg');
    const meta = await sharp(buffer).metadata();
    expect([meta.width, meta.height]).toEqual([40, 60]);
    expect(meta.orientation ?? 1).toBe(1);
  });

  it('velký obrázek zmenší pod limit API', async () => {
    // Šum se nedá zkomprimovat → PNG výrazně přes ~3,75 MB
    const width = 1600;
    const height = 1200;
    const noise = crypto.randomBytes(width * height * 3);
    const png = await sharp(noise, { raw: { width, height, channels: 3 } })
      .png({ compressionLevel: 0 })
      .toBuffer();
    expect(png.length).toBeGreaterThan(4 * 1024 * 1024);

    const { buffer, mediaType } = await prepareImage(png);

    expect(mediaType).toBe('image/jpeg');
    expect(buffer.length).toBeLessThanOrEqual(Math.floor((5 * 1024 * 1024 * 3) / 4));
  });

  it('odmítne obrázek nad limitem pixelů (dekompresní bomba)', async () => {
    const png = await solid(100, 100).png().toBuffer();
    await expect(prepareImage(png, { limitInputPixels: 5000 })).rejects.toThrow(
      /Obrázek nelze načíst.*pixel limit/,
    );
  });

  it('odmítne data, která nejsou obrázek', async () => {
    await expect(prepareImage(Buffer.from('tohle není obrázek'))).rejects.toThrow(
      /Obrázek nelze načíst/,
    );
  });
});
