import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

function cropTo(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  PNG.bitblt(png, out, 0, 0, width, height, 0, 0);
  return out;
}

/**
 * Pixel-compare two PNG buffers over their common top-left region
 * (page screenshots are usually taller than the Figma frame).
 *
 * @param {Buffer} actualBuf    screenshot of the live page
 * @param {Buffer} expectedBuf  PNG exported from Figma
 * @returns {{mismatchPct, mismatchPixels, comparedWidth, comparedHeight,
 *            actualSize, expectedSize, diffBuffer}}
 */
export function diffPngs(actualBuf, expectedBuf, { threshold = 0.1 } = {}) {
  const actual = PNG.sync.read(actualBuf);
  const expected = PNG.sync.read(expectedBuf);

  const width = Math.min(actual.width, expected.width);
  const height = Math.min(actual.height, expected.height);
  if (width < 10 || height < 10) {
    throw new Error('Зображення занадто малі для порівняння.');
  }

  const a = cropTo(actual, width, height);
  const e = cropTo(expected, width, height);
  const diff = new PNG({ width, height });
  const mismatchPixels = pixelmatch(a.data, e.data, diff.data, width, height, {
    threshold,
    includeAA: false,
  });

  return {
    mismatchPixels,
    mismatchPct: Math.round((mismatchPixels / (width * height)) * 10000) / 100,
    comparedWidth: width,
    comparedHeight: height,
    actualSize: { width: actual.width, height: actual.height },
    expectedSize: { width: expected.width, height: expected.height },
    diffBuffer: PNG.sync.write(diff),
  };
}

export function statusForMismatch(pct, okThreshold) {
  if (pct <= okThreshold) return 'ok';
  if (pct <= okThreshold * 3) return 'warning';
  return 'error';
}
