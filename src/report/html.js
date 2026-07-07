const CHECK_TITLES = {
  'meta-viewport': 'Meta viewport',
  'html-lang': 'Атрибут lang',
  'horizontal-scroll': 'Горизонтальний скрол',
  'viewport-overflow': 'Вихід за межі екрана',
  overlap: 'Перекриття елементів',
  'text-clipped': 'Обрізаний текст',
  'small-font': 'Дрібний шрифт',
  'broken-image': 'Биті зображення',
  'distorted-image': 'Спотворені зображення',
  'image-alt': 'Зображення без alt',
  'tap-target': 'Малі елементи натискання',
  'http-status': 'HTTP-статус',
  'js-error': 'JS-помилки',
  'console-error': 'Помилки в консолі',
  'failed-request': 'Невдалі запити',
  truncated: 'Скорочено',
};

const SEVERITY = {
  error: { label: 'помилка', color: '#dc2626', bg: '#fee2e2' },
  warning: { label: 'попередження', color: '#b45309', bg: '#fef3c7' },
  info: { label: 'зауваження', color: '#1d4ed8', bg: '#dbeafe' },
};

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function severityBadge(sev) {
  const s = SEVERITY[sev] || SEVERITY.info;
  return `<span class="badge" style="color:${s.color};background:${s.bg}">${s.label}</span>`;
}

function issueRow(issue) {
  return `<tr>
    <td>${severityBadge(issue.severity)}</td>
    <td class="check">${esc(CHECK_TITLES[issue.check] || issue.check)}</td>
    <td>
      ${esc(issue.message)}
      ${issue.selector ? `<div><code>${esc(issue.selector)}</code></div>` : ''}
      ${issue.details ? `<div class="details">${esc(issue.details)}</div>` : ''}
    </td>
  </tr>`;
}

function viewportSection(vp) {
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of vp.issues) counts[i.severity] = (counts[i.severity] || 0) + 1;
  const countsText = `${counts.error} помилок · ${counts.warning} попереджень · ${counts.info} зауважень`;
  return `<details open class="viewport">
    <summary>
      <strong>${esc(vp.label)}</strong> — ${vp.width}×${vp.height}px
      <span class="muted">(${countsText})</span>
    </summary>
    <div class="vp-body">
      <div class="issues">
        ${
          vp.issues.length
            ? `<table><thead><tr><th></th><th>Перевірка</th><th>Опис</th></tr></thead><tbody>${vp.issues
                .map(issueRow)
                .join('')}</tbody></table>`
            : '<p class="ok">✅ Проблем не знайдено.</p>'
        }
      </div>
      ${
        vp.screenshot
          ? `<figure>
              <a href="${esc(vp.screenshot)}" target="_blank"><img src="${esc(vp.screenshot)}" alt="Скриншот ${vp.width}×${vp.height}" loading="lazy"></a>
              <figcaption>Повний скриншот сторінки (клікніть, щоб відкрити)</figcaption>
            </figure>`
          : ''
      }
    </div>
  </details>`;
}

function figmaSection(figma) {
  if (!figma) return '';
  const cards = (figma.comparisons || [])
    .map((c) => {
      if (c.error) {
        return `<div class="figma-card">
          <h3>${esc(c.frame.name)} <span class="muted">${c.frame.width}×${c.frame.height}px</span></h3>
          <p class="err">Не вдалося порівняти: ${esc(c.error)}</p>
        </div>`;
      }
      const st = c.status === 'ok' ? 'ok-badge' : c.status === 'warning' ? 'warn-badge' : 'err-badge';
      const stText = c.status === 'ok' ? 'відповідає макету' : c.status === 'warning' ? 'є розбіжності' : 'суттєві розбіжності';
      return `<div class="figma-card">
        <h3>${esc(c.frame.name)}
          <span class="muted">${c.frame.width}×${c.frame.height}px</span>
          <span class="badge ${st}">${c.mismatchPct}% пікселів відрізняється — ${stText}</span>
        </h3>
        <p class="muted">Порівняно область ${c.comparedWidth}×${c.comparedHeight}px (макет ${c.expectedSize.width}×${c.expectedSize.height}px, сторінка ${c.actualSize.width}×${c.actualSize.height}px).</p>
        <div class="figma-images">
          <figure><a href="${esc(c.files.expected)}" target="_blank"><img src="${esc(c.files.expected)}" loading="lazy" alt="Макет"></a><figcaption>Макет (Figma)</figcaption></figure>
          <figure><a href="${esc(c.files.actual)}" target="_blank"><img src="${esc(c.files.actual)}" loading="lazy" alt="Сайт"></a><figcaption>Сайт</figcaption></figure>
          <figure><a href="${esc(c.files.diff)}" target="_blank"><img src="${esc(c.files.diff)}" loading="lazy" alt="Різниця"></a><figcaption>Різниця</figcaption></figure>
        </div>
      </div>`;
    })
    .join('');
  return `<section>
    <h2>Порівняння з макетом Figma</h2>
    ${figma.note ? `<p class="muted">${esc(figma.note)}</p>` : ''}
    ${cards || '<p class="muted">Порівнянь немає.</p>'}
  </section>`;
}

/** Build a self-contained HTML report (images referenced by relative paths). */
export function renderHtmlReport(report) {
  const s = report.summary;
  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Звіт тестування верстки — ${esc(report.url)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
  .wrap { max-width: 1200px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 20px; margin: 32px 0 12px; }
  .muted { color: #64748b; font-weight: normal; font-size: 0.9em; }
  .summary { display: flex; gap: 12px; margin: 16px 0 24px; flex-wrap: wrap; }
  .chip { padding: 10px 16px; border-radius: 10px; background: #fff; border: 1px solid #e2e8f0; }
  .chip b { display: block; font-size: 22px; }
  .chip.err b { color: #dc2626; } .chip.warn b { color: #b45309; } .chip.info b { color: #1d4ed8; }
  details.viewport { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; margin: 12px 0; }
  details.viewport > summary { cursor: pointer; padding: 14px 18px; font-size: 16px; }
  .vp-body { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; padding: 0 18px 18px; }
  @media (max-width: 900px) { .vp-body { grid-template-columns: 1fr; } }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-top: 1px solid #f1f5f9; vertical-align: top; }
  thead th { border-top: none; color: #64748b; font-weight: 600; font-size: 12px; text-transform: uppercase; }
  .check { white-space: nowrap; font-weight: 600; }
  code { background: #f1f5f9; padding: 1px 6px; border-radius: 6px; font-size: 12px; word-break: break-all; }
  .details { color: #64748b; font-size: 12px; margin-top: 2px; word-break: break-all; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .ok { color: #15803d; }
  .err { color: #dc2626; }
  figure { margin: 0; }
  figure img { max-width: 100%; border: 1px solid #e2e8f0; border-radius: 8px; max-height: 420px; object-fit: cover; object-position: top; }
  figcaption { font-size: 12px; color: #64748b; margin-top: 4px; }
  .figma-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 18px; margin: 12px 0; }
  .figma-card h3 { margin: 0 0 6px; font-size: 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .figma-images { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  @media (max-width: 700px) { .figma-images { grid-template-columns: 1fr; } }
  .ok-badge { color: #15803d; background: #dcfce7; }
  .warn-badge { color: #b45309; background: #fef3c7; }
  .err-badge { color: #dc2626; background: #fee2e2; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Звіт тестування верстки</h1>
  <p class="muted">
    <a href="${esc(report.url)}">${esc(report.url)}</a>
    · ${esc(new Date(report.startedAt).toLocaleString('uk-UA'))}
    · тривалість ${Math.round(report.durationMs / 100) / 10}с
  </p>
  <div class="summary">
    <div class="chip err"><b>${s.errors}</b>помилок</div>
    <div class="chip warn"><b>${s.warnings}</b>попереджень</div>
    <div class="chip info"><b>${s.infos}</b>зауважень</div>
  </div>
  <h2>Перевірка на різних розширеннях</h2>
  ${report.viewports.map(viewportSection).join('')}
  ${figmaSection(report.figma)}
</div>
</body>
</html>`;
}
