import sharp from 'sharp';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

/**
 * A tiny PNG whose header claims `width` × `height` pixels – the shape of a
 * decompression bomb as far as the pixel limit is concerned (the limit is
 * checked from the header, before any pixel data is decoded).
 */
export async function pngClaimingSize(width: number, height: number): Promise<Buffer> {
  const png = Buffer.from(
    await sharp({ create: { width: 1, height: 1, channels: 3, background: '#fff' } })
      .png()
      .toBuffer(),
  );
  // Signature (8 B), then the IHDR chunk: length (4), "IHDR" (4), data (13), CRC (4).
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
  return png;
}
