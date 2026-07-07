import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from './browser.js';
import { auditViewport, saveScreenshot, summarize } from './runner.js';
import { extractCrawlTargets, fetchSitemapUrls, normalizeUrl } from './crawler.js';
import { runFigmaComparison } from './figma/index.js';
import { saveIssueCrops } from './report/crops.js';
import { renderHtmlReport } from './report/html.js';
import { DEFAULT_VIEWPORTS, parseViewports } from './viewports.js';

export { DEFAULT_VIEWPORTS, parseViewports };
export { parseFigmaUrl } from './figma/client.js';

/**
 * Run the full layout audit for a site.
 *
 * @param {object} options
 * @param {string} options.url                 Start URL.
 * @param {number} [options.maxPages]          How many site pages to audit (1 = only the given page).
 * @param {Array}  [options.viewports]         Resolutions, default DEFAULT_VIEWPORTS.
 * @param {string} [options.outDir]            Report output dir, default "qa-report".
 * @param {{url: string, token: string}} [options.figma]  Optional Figma template (compared against the start page).
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
    maxPages = 1,
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
  const crawl = maxPages > 1;
  const startedAt = new Date();
  await mkdir(outDir, { recursive: true });

  const startUrl = normalizeUrl(url, url) || url;
  const seen = new Set([startUrl]);
  const queue = [startUrl];

  if (crawl) {
    const sitemapUrls = await fetchSitemapUrls(startUrl, maxPages * 3);
    const fromSitemap = extractCrawlTargets(sitemapUrls, startUrl, seen, maxPages * 2);
    queue.push(...fromSitemap);
    if (fromSitemap.length) {
      log(`У sitemap.xml знайдено ще ${fromSitemap.length} сторінок.`);
    }
  }

  const browser = await launchBrowser();
  try {
    const report = {
      url: startUrl,
      startedAt: startedAt.toISOString(),
      pages: [],
      figma: null,
    };

    while (queue.length && report.pages.length < maxPages) {
      const pageUrl = queue.shift();
      const pageNum = report.pages.length + 1;
      if (crawl) log(`Сторінка ${pageNum}: ${pageUrl}`);
      const indent = crawl ? '  ' : '';

      const pageEntry = { url: pageUrl, title: null, viewports: [], error: null };
      try {
        for (const [index, vp] of viewports.entries()) {
          log(`${indent}Тестую ${vp.label} (${vp.width}×${vp.height})...`);
          const result = await auditViewport(browser, pageUrl, vp, {
            includeDocChecks: index === 0,
            collectLinks: crawl && index === 0,
            timeout,
            wait,
            maxIssues,
            fullPage,
          });

          if (result.links) {
            const targets = extractCrawlTargets(
              result.links,
              startUrl,
              seen,
              maxPages * 3
            );
            queue.push(...targets);
          }
          delete result.links;

          const prefix = crawl ? `p${pageNum}-` : '';
          const screenshot = await saveScreenshot(
            outDir,
            vp,
            result.screenshotBuffer,
            prefix
          );
          await saveIssueCrops(
            result.screenshotBuffer,
            result.issues,
            outDir,
            `${prefix}${vp.label}-${vp.width}x${vp.height}`
          );
          delete result.screenshotBuffer;

          if (!pageEntry.title && result.metrics) pageEntry.title = result.metrics.title;
          pageEntry.viewports.push({ ...result, screenshot });

          const errs = result.issues.filter((i) => i.severity === 'error').length;
          const warns = result.issues.filter((i) => i.severity === 'warning').length;
          log(`${indent}  → ${errs} помилок, ${warns} попереджень`);
        }
      } catch (err) {
        pageEntry.error = String(err.message || err);
        log(`${indent}✖ Сторінку не вдалося перевірити: ${pageEntry.error}`);
      }
      pageEntry.summary = summarize(pageEntry.viewports.map((v) => v.issues));
      report.pages.push(pageEntry);
    }

    if (crawl) {
      report.crawl = {
        maxPages,
        audited: report.pages.length,
        discovered: seen.size,
      };
      log(`Обхід завершено: перевірено ${report.pages.length} сторінок (знайдено ${seen.size}).`);
    }

    if (figma && figma.url) {
      report.figma = await runFigmaComparison(
        browser,
        startUrl,
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
    report.summary = summarize(
      report.pages.flatMap((p) => p.viewports.map((v) => v.issues))
    );

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
