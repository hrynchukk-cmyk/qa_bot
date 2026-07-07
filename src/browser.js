import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const FALLBACK_CHROMIUM = process.env.QA_BOT_CHROMIUM_PATH || '/opt/pw-browsers/chromium';

/**
 * Launch Chromium; if the Playwright registry doesn't have a matching browser
 * build, fall back to a system-provided executable (QA_BOT_CHROMIUM_PATH).
 */
export async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (err) {
    if (existsSync(FALLBACK_CHROMIUM)) {
      return chromium.launch({ executablePath: FALLBACK_CHROMIUM });
    }
    throw err;
  }
}
