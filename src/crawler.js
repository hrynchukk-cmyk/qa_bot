/** Link discovery for whole-site crawling: same-origin pages only. */

const SKIP_EXTENSIONS =
  /\.(pdf|zip|rar|7z|gz|tar|jpe?g|png|gif|webp|avif|svg|ico|mp4|mp3|wav|webm|avi|mov|docx?|xlsx?|pptx?|txt|csv|xml|json|rss|atom|css|js|mjs|map|woff2?|ttf|otf|eot)([?#]|$)/i;

const TRACKING_PARAM = /^(utm_|fbclid|gclid|yclid|msclkid|_ga|mc_cid|mc_eid)/i;

/**
 * Resolve and canonicalize a link: absolute URL, no hash, no tracking params,
 * no trailing slash (except root). Returns null for non-http(s) links.
 */
export function normalizeUrl(href, baseUrl) {
  let u;
  try {
    u = new URL(href, baseUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) u.searchParams.delete(key);
  }
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

export function isSameSite(url, startUrl) {
  try {
    return new URL(url).origin === new URL(startUrl).origin;
  } catch {
    return false;
  }
}

export function isCrawlablePage(url) {
  return !SKIP_EXTENSIONS.test(url);
}

/**
 * Filter raw hrefs down to new, same-site, page-like URLs.
 * Mutates `seen` so the same URL is never returned twice.
 */
export function extractCrawlTargets(links, startUrl, seen, limit) {
  const out = [];
  for (const href of links) {
    if (out.length >= limit) break;
    const norm = normalizeUrl(href, startUrl);
    if (!norm || seen.has(norm)) continue;
    if (!isSameSite(norm, startUrl) || !isCrawlablePage(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/** Best-effort sitemap.xml fetch; returns [] on any failure. */
export async function fetchSitemapUrls(startUrl, limit = 100) {
  try {
    const origin = new URL(startUrl).origin;
    const res = await fetch(origin + '/sitemap.xml', {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const text = (await res.text()).slice(0, 2_000_000);
    const urls = [];
    for (const m of text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      urls.push(m[1]);
      if (urls.length >= limit) break;
    }
    return urls;
  } catch {
    return [];
  }
}
