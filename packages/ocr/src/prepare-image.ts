import sharp, { type Metadata } from 'sharp';
import type { ImageMediaType } from './types';

// API limit is 5 MB for base64-encoded data. Base64 inflates size by ~4/3,
// so the raw file must be under ~3.75 MB to stay within the 5 MB base64 limit.
const MAX_BASE64_BYTES = 5 * 1024 * 1024;
const MAX_RAW_BYTES = Math.floor((MAX_BASE64_BYTES * 3) / 4); // ~3.75 MB
// Messages API odmítá obrázky nad 8000 px na stranu – a s nimi celou dávku.
const MAX_API_DIMENSION = 8000;

/**
 * Maximální počet pixelů vstupu pro sharp – ochrana proti dekompresní bombě
 * (malý PNG/TIFF, který se dekóduje do gigabajtů). 100 Mpx pokryje i sken A3
 * v 600 dpi (~7000 × 10000 px); výchozí limit sharp je ~268 Mpx.
 */
export const MAX_INPUT_PIXELS = 100_000_000;

/** Formáty (dle sharp), které Claude API přijímá beze změny. */
const API_FORMATS: Partial<Record<string, ImageMediaType>> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * Připraví obrázek pro Claude API.
 *
 * Obrázek se posílá beze změny jen tehdy, když je ve formátu, který API přijímá,
 * nemá EXIF orientaci vyžadující otočení a vejde se do limitu velikosti. Jinak se
 * převede na JPEG (s otočením podle EXIF a bílým pozadím místo průhlednosti).
 * Dřív se převáděly jen soubory nad ~3,75 MB, takže malý TIFF odešel jako
 * `image/jpeg` a API odmítlo celou dávku (LLM-1).
 */
export async function prepareImage(
  image: Buffer,
  options: { limitInputPixels?: number } = {},
): Promise<{ buffer: Buffer; mediaType: ImageMediaType }> {
  const sharpOptions = { limitInputPixels: options.limitInputPixels ?? MAX_INPUT_PIXELS };

  let metadata: Metadata;
  try {
    metadata = await sharp(image, sharpOptions).metadata();
  } catch (err) {
    throw new Error(
      `Obrázek nelze načíst (${err instanceof Error ? err.message : 'neznámý formát'})`,
    );
  }

  const apiMediaType = metadata.format ? API_FORMATS[metadata.format] : undefined;
  const needsRotation = metadata.orientation !== undefined && metadata.orientation !== 1;
  const tooLarge = image.length > MAX_RAW_BYTES;
  const tooManyPixels =
    (metadata.width ?? 0) > MAX_API_DIMENSION || (metadata.height ?? 0) > MAX_API_DIMENSION;

  if (apiMediaType && !needsRotation && !tooLarge && !tooManyPixels) {
    return { buffer: image, mediaType: apiMediaType };
  }

  const reasons = [
    !apiMediaType ? `formát ${metadata.format ?? 'neznámý'}` : null,
    needsRotation ? `EXIF orientace ${metadata.orientation}` : null,
    tooLarge ? `velikost ${(image.length / 1024 / 1024).toFixed(1)} MB` : null,
    tooManyPixels ? `rozměry ${metadata.width}×${metadata.height} px` : null,
  ].filter(Boolean);
  console.log(`[Claude] Converting image to JPEG (${reasons.join(', ')})…`);

  // Pokusy od nejvyšší kvality. Plné rozlišení zkoušíme jen u obrázků, které
  // se do limitu vešly už v původní podobě (převod formátu / otočení).
  const attempts: { width?: number; quality: number }[] = [
    ...(tooLarge || tooManyPixels ? [] : [{ quality: 90 }]),
    { width: 3000, quality: 85 },
    { width: 2000, quality: 75 },
  ];

  let converted: Buffer | null = null;
  for (const { width, quality } of attempts) {
    let pipeline = sharp(image, sharpOptions).rotate();
    // Výška je omezená jen limitem API – u běžných poměrů stran rozhoduje šířka,
    // úzký a vysoký obrázek (svitek, sloupec) se zmenší i podle výšky.
    if (width) {
      pipeline = pipeline.resize({
        width,
        height: MAX_API_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    converted = await pipeline.flatten({ background: '#ffffff' }).jpeg({ quality }).toBuffer();
    if (converted.length <= MAX_RAW_BYTES) break;
  }

  if (!converted || converted.length > MAX_RAW_BYTES) {
    throw new Error(
      `Obrázek je i po zmenšení příliš velký pro Claude API (${((converted?.length ?? 0) / 1024 / 1024).toFixed(1)} MB)`,
    );
  }

  console.log(`[Claude] Converted to ${(converted.length / 1024 / 1024).toFixed(1)} MB JPEG`);
  return { buffer: converted, mediaType: 'image/jpeg' };
}
