/**
 * Sdílený semafor pro dekódování obrázků sharpem ve web procesu.
 *
 * Plné dekódování velkého skenu (TIFF, prokládané PNG) zabere stovky MB nativní
 * paměti a sharp běží v libuv poolu sdíleném s fs a dns. Upload, import z URL
 * i další routy proto sdílejí jeden rozpočet – bez něj by souběžné uploady
 * snadno přesáhly PM2 `max_memory_restart` (500 MB) a shodily web pro všechny.
 */
const SHARP_MAX_CONCURRENT = 2;
let sharpInFlight = 0;
const sharpQueue: Array<() => void> = [];

export async function withSharpLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (sharpInFlight >= SHARP_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => sharpQueue.push(resolve));
  }
  sharpInFlight++;
  try {
    return await fn();
  } finally {
    sharpInFlight--;
    sharpQueue.shift()?.();
  }
}
