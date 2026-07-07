/** Default set of screen resolutions the audit runs at. */
export const DEFAULT_VIEWPORTS = [
  { label: 'mobile', width: 390, height: 844 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'laptop', width: 1366, height: 768 },
  { label: 'desktop', width: 1920, height: 1080 },
];

export function labelForWidth(width) {
  if (width <= 600) return 'mobile';
  if (width <= 1024) return 'tablet';
  if (width <= 1600) return 'laptop';
  return 'desktop';
}

/**
 * Parse a viewport list like "390x844,768x1024" or "mobile:390x844,desktop:1920x1080".
 * @param {string} spec
 * @returns {Array<{label: string, width: number, height: number}>}
 */
export function parseViewports(spec) {
  if (!spec || !spec.trim()) return DEFAULT_VIEWPORTS;
  return spec.split(',').map((part) => {
    const item = part.trim();
    const m = item.match(/^(?:([\w-]+):)?(\d+)x(\d+)$/i);
    if (!m) {
      throw new Error(
        `Невірний формат viewport "${item}". Очікується "ШИРИНАxВИСОТА" або "назва:ШИРИНАxВИСОТА", напр. "390x844" чи "mobile:390x844".`
      );
    }
    const width = Number(m[2]);
    const height = Number(m[3]);
    if (width < 200 || width > 4000 || height < 200 || height > 4000) {
      throw new Error(`Viewport "${item}" поза допустимим діапазоном 200–4000px.`);
    }
    return { label: m[1] || labelForWidth(width), width, height };
  });
}
