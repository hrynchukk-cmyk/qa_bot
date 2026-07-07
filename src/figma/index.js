import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FigmaClient, parseFigmaUrl } from './client.js';
import { diffPngs, statusForMismatch } from './compare.js';

function safeName(name, id) {
  const base = String(name).replace(/[^\wЀ-ӿ-]+/g, '_').slice(0, 40) || 'frame';
  return `${base}-${id.replace(/[^\w-]/g, '_')}`;
}

/**
 * For every Figma frame: open the site at the frame's width, screenshot it
 * and pixel-diff against the PNG exported from Figma.
 */
export async function runFigmaComparison(browser, url, figmaOpts, log = () => {}) {
  const { fileKey, nodeId } = parseFigmaUrl(figmaOpts.url);
  const client = new FigmaClient(figmaOpts.token);

  log(`Отримую фрейми з Figma (файл ${fileKey}${nodeId ? `, вузол ${nodeId}` : ''})...`);
  let frames = await client.getFrames(fileKey, nodeId);
  frames = frames.filter((f) => f.width >= 280 && f.width <= 3200);
  if (!frames.length) {
    return { fileKey, nodeId, comparisons: [], note: 'У файлі Figma не знайдено фреймів придатної ширини (280–3200px).' };
  }
  frames = frames.slice(0, figmaOpts.maxFrames);

  log(`Експортую ${frames.length} фрейм(ів) як PNG...`);
  const imageUrls = await client.exportImages(fileKey, frames.map((f) => f.id));

  const figmaDir = path.join(figmaOpts.outDir, 'figma');
  await mkdir(figmaDir, { recursive: true });

  const comparisons = [];
  for (const frame of frames) {
    const imageUrl = imageUrls[frame.id];
    if (!imageUrl) {
      comparisons.push({ frame, error: 'Figma не повернула зображення для цього фрейму.' });
      continue;
    }
    log(`Порівнюю з фреймом "${frame.name}" (${frame.width}×${frame.height}px)...`);
    try {
      const expectedBuf = await client.download(imageUrl);

      const isMobile = frame.width < 500;
      const context = await browser.newContext({
        viewport: { width: frame.width, height: Math.min(frame.height, 1400) },
        deviceScaleFactor: 1,
        isMobile,
        hasTouch: isMobile,
        ignoreHTTPSErrors: true,
      });
      let actualBuf;
      try {
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: figmaOpts.timeout });
        try {
          await page.waitForLoadState('networkidle', { timeout: 10_000 });
        } catch {
          /* proceed */
        }
        await page.waitForTimeout(figmaOpts.wait);
        actualBuf = await page.screenshot({ fullPage: true, timeout: figmaOpts.timeout });
      } finally {
        await context.close();
      }

      const result = diffPngs(actualBuf, expectedBuf, { threshold: figmaOpts.pixelThreshold });
      const base = safeName(frame.name, frame.id);
      const files = {
        expected: path.posix.join('figma', `${base}-expected.png`),
        actual: path.posix.join('figma', `${base}-actual.png`),
        diff: path.posix.join('figma', `${base}-diff.png`),
      };
      await writeFile(path.join(figmaOpts.outDir, files.expected), expectedBuf);
      await writeFile(path.join(figmaOpts.outDir, files.actual), actualBuf);
      await writeFile(path.join(figmaOpts.outDir, files.diff), result.diffBuffer);

      comparisons.push({
        frame,
        mismatchPct: result.mismatchPct,
        status: statusForMismatch(result.mismatchPct, figmaOpts.okThreshold),
        comparedWidth: result.comparedWidth,
        comparedHeight: result.comparedHeight,
        actualSize: result.actualSize,
        expectedSize: result.expectedSize,
        files,
      });
    } catch (err) {
      comparisons.push({ frame, error: String(err.message || err) });
    }
  }

  return { fileKey, nodeId, comparisons };
}
