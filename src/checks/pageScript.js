/**
 * Layout audit that runs INSIDE the page via page.evaluate().
 * The function is serialized by Playwright, so it must be fully
 * self-contained: no imports and no references to outer scope.
 *
 * Issue shape: { check, severity: 'error'|'warning'|'info', message, selector?, details? }
 *
 * @param {{includeDocChecks: boolean, isMobileViewport: boolean, maxPerCheck: number, expectedWidth?: number}} opts
 */
export function pageAudit(opts) {
  const includeDocChecks = !!opts.includeDocChecks;
  const isMobileViewport = !!opts.isMobileViewport;
  const maxPerCheck = opts.maxPerCheck || 20;

  // On emulated mobile the browser zooms out to fit overflowing content,
  // which inflates window.innerWidth — compare against the device width.
  const vw = opts.expectedWidth || window.innerWidth;
  const issues = [];
  const counts = {};

  const push = (issue) => {
    counts[issue.check] = (counts[issue.check] || 0) + 1;
    if (counts[issue.check] <= maxPerCheck) issues.push(issue);
  };

  const esc = (s) => {
    try {
      return CSS.escape(s);
    } catch {
      return s;
    }
  };

  // Short, human-readable CSS path for the report.
  const cssPath = (el) => {
    if (el.id) return '#' + esc(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 4) {
      if (node.id) {
        parts.unshift('#' + esc(node.id));
        break;
      }
      let part = node.tagName.toLowerCase();
      const classes = Array.from(node.classList).slice(0, 2);
      if (classes.length) part += '.' + classes.map(esc).join('.');
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  };

  const styleOf = (el) => getComputedStyle(el);

  const isVisible = (el) => {
    const st = styleOf(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    if (parseFloat(st.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0.5 && r.height > 0.5;
  };

  const hasDirectText = (el) => {
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0) return true;
    }
    return false;
  };

  const hasFixedOrStickyAncestor = (el) => {
    let node = el;
    while (node && node !== document.body && node.nodeType === 1) {
      const pos = styleOf(node).position;
      if (pos === 'fixed' || pos === 'sticky') return true;
      node = node.parentElement;
    }
    return false;
  };

  const round = (n) => Math.round(n * 10) / 10;

  // Collect elements once (with a safety cap for huge pages).
  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, TITLE: 1, BR: 1, WBR: 1 };
  const all = [];
  if (document.body) {
    for (const el of document.body.querySelectorAll('*')) {
      if (!SKIP_TAGS[el.tagName]) all.push(el);
      if (all.length >= 6000) break;
    }
  }

  // ── 1. Document-level checks (run once, on the first viewport) ────────────
  if (includeDocChecks) {
    if (!document.querySelector('meta[name="viewport"]')) {
      push({
        check: 'meta-viewport',
        severity: 'error',
        message: 'Відсутній тег <meta name="viewport"> — сторінка не масштабується коректно на мобільних пристроях.',
      });
    }
    if (!document.documentElement.getAttribute('lang')) {
      push({
        check: 'html-lang',
        severity: 'info',
        message: 'У тега <html> не вказано атрибут lang.',
      });
    }
  }

  // ── 2. Horizontal overflow of the whole page ──────────────────────────────
  const docW = Math.max(
    document.documentElement.scrollWidth,
    document.body ? document.body.scrollWidth : 0
  );
  if (docW > vw + 1) {
    push({
      check: 'horizontal-scroll',
      severity: 'error',
      message: `Сторінка має горизонтальний скрол: ширина контенту ${docW}px перевищує ширину екрана ${vw}px.`,
    });
  }

  // ── 3. Elements sticking out of the viewport ──────────────────────────────
  const offenders = [];
  for (const el of all) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    // Only partially visible overflow counts: fully off-screen elements are
    // usually intentional (off-canvas menus, sliders).
    const outRight = r.left < vw && r.right > vw + 1;
    const outLeft = r.right > 0 && r.left < -1;
    if (outRight || outLeft) offenders.push({ el, r, outRight, outLeft });
  }
  offenders.sort(
    (a, b) =>
      Math.max(b.r.right - vw, -b.r.left) - Math.max(a.r.right - vw, -a.r.left)
  );
  const trimmed = offenders.slice(0, 60);
  // Keep only the deepest offenders so we don't report every ancestor wrapper.
  const deepest = trimmed.filter(
    (o) => !trimmed.some((other) => other.el !== o.el && o.el.contains(other.el))
  );
  for (const o of deepest) {
    const amount = o.outRight ? round(o.r.right - vw) : round(-o.r.left);
    const side = o.outRight ? 'праворуч' : 'ліворуч';
    push({
      check: 'viewport-overflow',
      severity: 'warning',
      message: `Елемент виходить за межі екрана на ${amount}px ${side} (ширина елемента ${round(o.r.width)}px).`,
      selector: cssPath(o.el),
    });
  }

  // ── 4. Overlapping elements ────────────────────────────────────────────────
  // Candidates: "content leaves" — images, form controls and nodes with direct text.
  const LEAF_TAGS = { IMG: 1, BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, VIDEO: 1, IFRAME: 1, svg: 1, SVG: 1 };
  const candidates = [];
  for (const el of all) {
    if (candidates.length >= 1200) break;
    if (!(LEAF_TAGS[el.tagName] || el.tagName === 'A' || hasDirectText(el))) continue;
    if (!isVisible(el)) continue;
    // Fixed/sticky elements legitimately overlay content (headers, cookie bars).
    if (hasFixedOrStickyAncestor(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    candidates.push({ el, r, area: r.width * r.height });
  }
  candidates.sort((a, b) => a.r.top - b.r.top);
  const overlapReported = new Set();
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i];
    if (overlapReported.has(a.el)) continue;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j];
      if (b.r.top >= a.r.bottom) break; // list is sorted by top edge
      if (overlapReported.has(b.el)) continue;
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ix = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const iy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ix <= 2 || iy <= 2) continue;
      const inter = ix * iy;
      if (inter < 0.3 * Math.min(a.area, b.area)) continue;
      overlapReported.add(a.el);
      overlapReported.add(b.el);
      push({
        check: 'overlap',
        severity: 'warning',
        message: `Елементи перекривають один одного (зона перетину ${round(ix)}×${round(iy)}px).`,
        selector: cssPath(a.el),
        details: 'перетинається з: ' + cssPath(b.el),
      });
      break;
    }
  }

  // ── 5. Clipped text ───────────────────────────────────────────────────────
  for (const el of all) {
    if (!hasDirectText(el) || !isVisible(el)) continue;
    const st = styleOf(el);
    const clipX =
      el.scrollWidth > el.clientWidth + 2 &&
      (st.overflowX === 'hidden' || st.overflowX === 'clip');
    const clipY =
      el.scrollHeight > el.clientHeight + 4 &&
      (st.overflowY === 'hidden' || st.overflowY === 'clip');
    const intentional =
      st.textOverflow === 'ellipsis' ||
      (st.webkitLineClamp && st.webkitLineClamp !== 'none');
    if (intentional) continue;
    if (clipX) {
      push({
        check: 'text-clipped',
        severity: 'warning',
        message: `Текст обрізається по горизонталі: вміст ${el.scrollWidth}px не вміщується в блок ${el.clientWidth}px.`,
        selector: cssPath(el),
        details: (el.textContent || '').trim().slice(0, 80),
      });
    } else if (clipY) {
      push({
        check: 'text-clipped',
        severity: 'warning',
        message: `Текст обрізається по вертикалі: вміст ${el.scrollHeight}px не вміщується в блок ${el.clientHeight}px.`,
        selector: cssPath(el),
        details: (el.textContent || '').trim().slice(0, 80),
      });
    }
  }

  // ── 6. Tiny font sizes ────────────────────────────────────────────────────
  const seenSmallFont = new Set();
  for (const el of all) {
    if (!hasDirectText(el) || !isVisible(el)) continue;
    const fs = parseFloat(styleOf(el).fontSize);
    if (fs > 0 && fs < 12) {
      const sel = cssPath(el);
      if (seenSmallFont.has(sel)) continue;
      seenSmallFont.add(sel);
      push({
        check: 'small-font',
        severity: 'warning',
        message: `Розмір шрифту ${round(fs)}px — менший за рекомендований мінімум 12px.`,
        selector: sel,
        details: (el.textContent || '').trim().slice(0, 80),
      });
    }
  }

  // ── 7. Images: broken, distorted, missing alt ─────────────────────────────
  for (const img of Array.from(document.images)) {
    const src = img.currentSrc || img.src;
    if (!src) continue;
    const st = styleOf(img);
    if (st.display === 'none' || st.visibility === 'hidden') continue;
    if (img.complete && img.naturalWidth === 0) {
      push({
        check: 'broken-image',
        severity: 'error',
        message: 'Зображення не завантажилося.',
        selector: cssPath(img),
        details: src.slice(0, 200),
      });
      continue;
    }
    const r = img.getBoundingClientRect();
    if (img.naturalWidth > 0 && r.width > 16 && r.height > 16 && st.objectFit === 'fill') {
      const arNatural = img.naturalWidth / img.naturalHeight;
      const arRendered = r.width / r.height;
      if (Math.abs(Math.log(arRendered / arNatural)) > 0.14) {
        push({
          check: 'distorted-image',
          severity: 'warning',
          message: `Пропорції зображення спотворені: оригінал ${img.naturalWidth}×${img.naturalHeight}px, відображається ${Math.round(r.width)}×${Math.round(r.height)}px.`,
          selector: cssPath(img),
        });
      }
    }
    if (includeDocChecks && !img.hasAttribute('alt')) {
      push({
        check: 'image-alt',
        severity: 'info',
        message: 'Зображення без атрибута alt (доступність).',
        selector: cssPath(img),
      });
    }
  }

  // ── 8. Tap targets that are too small (mobile only) ───────────────────────
  if (isMobileViewport) {
    const interactive = document.querySelectorAll(
      'a[href], button, input, select, textarea, [role="button"], [onclick]'
    );
    for (const el of Array.from(interactive)) {
      if (!isVisible(el)) continue;
      if (el.tagName === 'INPUT' && (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) {
        continue; // native checkbox/radio inside a clickable label
      }
      const st = styleOf(el);
      // Inline links inside running text are exempt (WCAG 2.5.8).
      if (
        el.tagName === 'A' &&
        st.display === 'inline' &&
        el.parentElement &&
        (el.parentElement.textContent || '').trim().length >
          (el.textContent || '').trim().length + 3
      ) {
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) {
        push({
          check: 'tap-target',
          severity: 'warning',
          message: `Інтерактивний елемент замалий для натискання пальцем: ${round(r.width)}×${round(r.height)}px (мінімум 24×24px).`,
          selector: cssPath(el),
          details: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 60),
        });
      }
    }
  }

  // Note about truncated checks.
  for (const check of Object.keys(counts)) {
    if (counts[check] > maxPerCheck) {
      push({
        check: 'truncated',
        severity: 'info',
        message: `Перевірка "${check}": показано перші ${maxPerCheck} із ${counts[check]} знайдених проблем.`,
      });
    }
  }

  return {
    issues,
    metrics: {
      title: document.title,
      scrollWidth: docW,
      scrollHeight: Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0
      ),
      elementsScanned: all.length,
    },
  };
}
