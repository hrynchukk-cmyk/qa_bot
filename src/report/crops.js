import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

const PAD = 32; // context around the element, px
const MAX_ELEMENT_W = 1400; // very wide elements get truncated in the crop
const MAX_ELEMENT_H = 900;
const MAX_CROPS_PER_VIEWPORT = 40;
const BORDER = [220, 38, 38, 255]; // red highlight

function drawHighlight(png, x, y, w, h) {
  const setPx = (px, py) => {
    if (px < 0 || py < 0 || px >= png.width || py >= png.height) return;
    const idx = (png.width * py + px) << 2;
    png.data[idx] = BORDER[0];
    png.data[idx + 1] = BORDER[1];
    png.data[idx + 2] = BORDER[2];
    png.data[idx + 3] = BORDER[3];
  };
  const x1 = x + w;
  const y1 = y + h;
  for (let t = 0; t < 2; t++) {
    for (let px = x - t; px <= x1 + t; px++) {
      setPx(px, y - t);
      setPx(px, y1 + t);
    }
    for (let py = y - t; py <= y1 + t; py++) {
      setPx(x - t, py);
      setPx(x1 + t, py);
    }
  }
}

/**
 * For every issue that carries an element rect, cut that region (with some
 * context) out of the full-page screenshot, outline the element in red and
 * save it to <outDir>/elements/. Sets issue.image (relative path) in place.
 */
export async function saveIssueCrops(screenshotBuffer, issues, outDir, prefix) {
  const withRect = issues
    .filter((i) => i.rect && i.rect.width >= 2 && i.rect.height >= 2)
    .slice(0, MAX_CROPS_PER_VIEWPORT);
  if (!withRect.length) return;

  let png;
  try {
    png = PNG.sync.read(screenshotBuffer);
  } catch {
    return; // non-PNG or unreadable screenshot — just skip element crops
  }

  const dir = path.join(outDir, 'elements');
  await mkdir(dir, { recursive: true });

  let n = 0;
  for (const issue of withRect) {
    n += 1;
    const r = issue.rect;
    const elW = Math.min(r.width, MAX_ELEMENT_W);
    const elH = Math.min(r.height, MAX_ELEMENT_H);
    const x0 = Math.max(0, Math.floor(r.x - PAD));
    const y0 = Math.max(0, Math.floor(r.y - PAD));
    const x1 = Math.min(png.width, Math.ceil(r.x + elW + PAD));
    const y1 = Math.min(png.height, Math.ceil(r.y + elH + PAD));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w < 8 || h < 8) continue;

    const crop = new PNG({ width: w, height: h });
    PNG.bitblt(png, crop, x0, y0, w, h, 0, 0);
    drawHighlight(crop, r.x - x0, r.y - y0, Math.min(r.width, w), Math.min(r.height, h));

    const file = `${prefix}-${n}.png`;
    await writeFile(path.join(dir, file), PNG.sync.write(crop));
    issue.image = path.posix.join('elements', file);
  }
}
