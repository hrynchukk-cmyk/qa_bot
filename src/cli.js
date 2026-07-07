import path from 'node:path';
import { program } from 'commander';
import { runAudit } from './index.js';
import { parseViewports } from './viewports.js';

program
  .name('qa-bot')
  .description(
    'Бот для тестування верстки сайту на різних розширеннях екрана.\n' +
      'Перевіряє горизонтальний скрол, вихід елементів за межі екрана, перекриття,\n' +
      'обрізані тексти, дрібні шрифти, биті зображення, помилки в консолі тощо.\n' +
      'Опційно порівнює сторінку з макетом Figma (попіксельно).'
  )
  .argument('<url>', 'URL сайту для тестування')
  .option(
    '-v, --viewports <list>',
    'розширення через кому: "390x844,1920x1080" або "mobile:390x844"',
    '390x844,768x1024,1366x768,1920x1080'
  )
  .option('-o, --out <dir>', 'тека для звіту', 'qa-report')
  .option('-p, --pages <n>', 'скільки сторінок сайту обійти (1 = лише вказану)', '1')
  .option('--figma <url>', 'посилання на файл/фрейм Figma для порівняння')
  .option('--figma-token <token>', 'персональний токен Figma (або змінна FIGMA_TOKEN)')
  .option('--figma-frames <n>', 'максимальна кількість фреймів для порівняння', '8')
  .option('--figma-threshold <pct>', '% розбіжності пікселів, що вважається нормою', '5')
  .option('--wait <ms>', 'додаткове очікування після завантаження', '800')
  .option('--timeout <ms>', 'таймаут завантаження сторінки', '45000')
  .option('--max-issues <n>', 'максимум проблем на перевірку для одного розширення', '20')
  .option('--no-full-page', 'скриншот лише видимої області, без прокрутки')
  .option('--fail-on <level>', 'вихід із кодом 1, якщо є проблеми рівня: error | warning | never', 'never')
  .action(async (url, opts) => {
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    let figma = null;
    if (opts.figma) {
      figma = {
        url: opts.figma,
        token: opts.figmaToken || process.env.FIGMA_TOKEN,
      };
    }

    try {
      const report = await runAudit({
        url,
        viewports: parseViewports(opts.viewports),
        maxPages: Math.min(Math.max(Number(opts.pages) || 1, 1), 50),
        outDir: opts.out,
        figma,
        timeout: Number(opts.timeout),
        wait: Number(opts.wait),
        maxIssues: Number(opts.maxIssues),
        fullPage: opts.fullPage,
        figmaOkThreshold: Number(opts.figmaThreshold),
        figmaMaxFrames: Number(opts.figmaFrames),
      });

      const s = report.summary;
      console.log('');
      console.log('Підсумок:');
      if (report.pages.length > 1) console.log(`  Сторінок:      ${report.pages.length}`);
      console.log(`  Помилки:       ${s.errors}`);
      console.log(`  Попередження:  ${s.warnings}`);
      console.log(`  Зауваження:    ${s.infos}`);
      if (report.figma) {
        for (const c of report.figma.comparisons) {
          if (c.error) console.log(`  Figma "${c.frame.name}": не порівняно (${c.error})`);
          else console.log(`  Figma "${c.frame.name}": розбіжність ${c.mismatchPct}%`);
        }
      }
      console.log('');
      console.log(`Звіт: ${path.resolve(opts.out, 'index.html')}`);

      const failOn = String(opts.failOn).toLowerCase();
      if (
        (failOn === 'error' && s.errors > 0) ||
        (failOn === 'warning' && s.errors + s.warnings > 0)
      ) {
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(`Помилка: ${err.message || err}`);
      process.exitCode = 2;
    }
  });

program.parseAsync();
