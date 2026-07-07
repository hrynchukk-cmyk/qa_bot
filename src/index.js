import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './browser.js';
import { auditViewport, saveScreenshot, summarize } from './runner.js';
import { runFigmaComparison } from './figma/index.js';
import { saveIssueCrops } from './report/crops.js';
import { renderHtmlReport } from './report/html.js';
import { DEFAULT_VIEWPORTS, parseViewports } from './viewports.js';

export { DEFAULT_VIEWPORTS, parseViewports };
export { parseFigmaUrl } from './figma/client.js';

/**
 * Run the full layout audit for one URL.
 *
 * @param {object} options
 * @param {string} options.url                 Site URL to test.
 * @param {Array}  [options.viewports]         Resolutions, default DEFAULT_VIEWPORTS.
 * @param {string} [options.outDir]            Report output dir, default "qa-report".
 * @param {{url: string, token: string}} [options.figma]  Optional Figma template.
 * @param {number} [options.timeout]           Navigation timeout ms.
 * @param {number} [options.wait]              Extra settle wait ms.
 * @param {number} [options.maxIssues]         Cap per check per viewport.
 * @param {boolean} [options.fullPage]         Full-page screenshots.
 * @param {number} [options.figmaOkThreshold]  Mismatch % considered "ok".
 * @param {number} [options.figmaMaxFrames]    Max Figma frames to compare.
 * @param {function} [options.log]             Progress logger.
 * @returns {Promise<object>} report object (also written to outDir as JSON + HTML)
 */
export async function runAudit(options) {
  const {
    url,
    viewports = DEFAULT_VIEWPORTS,
    outDir = 'qa-report',
    figma = null,
    timeout = 45_000,
    wait = 800,
    maxIssues = 20,
    fullPage = true,
    figmaOkThreshold = 5,
    figmaMaxFrames = 8,
    log = console.log,
  } = options;

  if (!url) throw new Error('Не задано URL сайту для тестування.');
  const startedAt = new Date();
  await mkdir(outDir, { recursive: true });

  const browser = await launchBrowser();
  try {
    const report = {
      url,
      startedAt: startedAt.toISOString(),
      viewports: [],
      figma: null,
    };

    for (const [index, vp] of viewports.entries()) {
      log(`Тестую ${vp.label} (${vp.width}×${vp.height})...`);
      const result = await auditViewport(browser, url, vp, {
        includeDocChecks: index === 0,
        timeout,
        wait,
        maxIssues,
        fullPage,
      });
      const screenshot = await saveScreenshot(outDir, vp, result.screenshotBuffer);
      await saveIssueCrops(
        result.screenshotBuffer,
        result.issues,
        outDir,
        `${vp.label}-${vp.width}x${vp.height}`
      );
      delete result.screenshotBuffer;
      report.viewports.push({ ...result, screenshot });
      const errs = result.issues.filter((i) => i.severity === 'error').length;
      const warns = result.issues.filter((i) => i.severity === 'warning').length;
      log(`  → ${errs} помилок, ${warns} попереджень`);
    }

    if (figma && figma.url) {
      report.figma = await runFigmaComparison(
        browser,
        url,
        {
          url: figma.url,
          token: figma.token,
          outDir,
          timeout,
          wait,
          maxFrames: figmaMaxFrames,
          okThreshold: figmaOkThreshold,
          pixelThreshold: 0.1,
        },
        log
      );
    }

    report.durationMs = Date.now() - startedAt.getTime();
    report.summary = summarize(report.viewports.map((v) => v.issues));

    await writeFile(
      path.join(outDir, 'report.json'),
      JSON.stringify(report, null, 2),
      'utf8'
    );
    await writeFile(path.join(outDir, 'index.html'), renderHtmlReport(report), 'utf8');
    return report;
  } finally {
    await browser.close();
  }
}
