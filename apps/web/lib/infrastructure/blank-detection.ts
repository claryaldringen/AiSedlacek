import sharp from 'sharp';

/**
 * Detect whether an image is a blank page (parchment/paper with no writing).
 *
 * Strategy: apply a Laplacian-like edge-detection kernel, then count the
 * fraction of pixels that exceed an intensity threshold.  Written pages have
 * many strong edges (ink strokes); blank pages have very few.
 *
 * Returns true if the page appears blank.
 */
export async function isBlankPage(buffer: Buffer): Promise<boolean> {
  try {
    // Down-scale to speed up analysis (256 px wide is plenty)
    const edgeBuffer = await sharp(buffer)
      .resize(256, undefined, { withoutEnlargement: true })
      .greyscale()
      .convolve({
        width: 3,
        height: 3,
        kernel: [0, -1, 0, -1, 4, -1, 0, -1, 0],
      })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = edgeBuffer;
    const totalPixels = info.width * info.height;

    // Count pixels with edge intensity above threshold
    const EDGE_THRESHOLD = 30;
    let edgePixels = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i]! > EDGE_THRESHOLD) edgePixels++;
    }

    const edgeRatio = edgePixels / totalPixels;

    // Blank pages typically have < 2% edge pixels; written pages > 5%
    const BLANK_THRESHOLD = 0.02;
    return edgeRatio < BLANK_THRESHOLD;
  } catch {
    // If analysis fails, assume not blank (safer — won't skip pages)
    return false;
  }
}
