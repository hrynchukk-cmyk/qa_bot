import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pageAudit } from './checks/pageScript.js';

/** Scroll to the bottom step by step to trigger lazy-loaded content, then back to top. */
async function settlePage(page, extraWaitMs) {
  await page.evaluate(async () => {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = window.innerHeight;
    let pos = 0;
    let guard = 0;
    while (
      pos < document.documentElement.scrollHeight - window.innerHeight &&
      guard < 30
    ) {
      pos += step;
      window.scrollTo(0, pos);
      guard += 1;
      await delay(80);
    }
    window.scrollTo(0, 0);
    await delay(150);
  });
  if (extraWaitMs > 0) await page.waitForTimeout(extraWaitMs);
}

/**
 * Open the URL at one viewport, run all checks and take a screenshot.
 * @returns {{label, width, height, issues, metrics, screenshotBuffer, httpStatus}}
 */
export async function auditViewport(browser, url, viewport, opts) {
  const isMobile = viewport.width < 500;
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile,
    hasTouch: isMobile,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const runtime = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') runtime.consoleErrors.push(msg.text().slice(0, 500));
  });
  page.on('pageerror', (err) => {
    runtime.pageErrors.push(String(err).slice(0, 500));
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      runtime.failedRequests.push({ url: res.url().slice(0, 300), status: res.status() });
    }
  });

  try {
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: opts.timeout,
    });
    const httpStatus = response ? response.status() : null;
    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(opts.timeout, 10_000) });
    } catch {
      // Sites with long-polling never go network-idle — proceed anyway.
    }
    await settlePage(page, opts.wait);

    const { issues, metrics } = await page.evaluate(pageAudit, {
      includeDocChecks: opts.includeDocChecks,
      isMobileViewport: isMobile,
      maxPerCheck: opts.maxIssues,
      expectedWidth: viewport.width,
    });

    if (httpStatus && httpStatus >= 400) {
      issues.unshift({
        check: 'http-status',
        severity: 'error',
        message: `Сторінка відповіла статусом HTTP ${httpStatus}.`,
      });
    }
    for (const err of runtime.pageErrors.slice(0, opts.maxIssues)) {
      issues.push({ check: 'js-error', severity: 'error', message: 'JavaScript-помилка на сторінці.', details: err });
    }
    for (const msg of runtime.consoleErrors.slice(0, opts.maxIssues)) {
      issues.push({ check: 'console-error', severity: 'warning', message: 'Помилка в консолі браузера.', details: msg });
    }
    const seenReq = new Set();
    for (const req of runtime.failedRequests) {
      if (seenReq.has(req.url) || seenReq.size >= opts.maxIssues) continue;
      seenReq.add(req.url);
      issues.push({
        check: 'failed-request',
        severity: 'warning',
        message: `Ресурс не завантажився (HTTP ${req.status}).`,
        details: req.url,
      });
    }

    const screenshotBuffer = await page.screenshot({
      fullPage: opts.fullPage,
      timeout: opts.timeout,
    });

    return { ...viewport, httpStatus, issues, metrics, screenshotBuffer };
  } finally {
    await context.close();
  }
}

export function summarize(issueLists) {
  const summary = { errors: 0, warnings: 0, infos: 0 };
  for (const issues of issueLists) {
    for (const issue of issues) {
      if (issue.severity === 'error') summary.errors += 1;
      else if (issue.severity === 'warning') summary.warnings += 1;
      else summary.infos += 1;
    }
  }
  return summary;
}

export async function saveScreenshot(outDir, viewport, buffer) {
  const dir = path.join(outDir, 'screenshots');
  await mkdir(dir, { recursive: true });
  const name = `${viewport.label}-${viewport.width}x${viewport.height}.png`;
  await writeFile(path.join(dir, name), buffer);
  return path.posix.join('screenshots', name);
}
