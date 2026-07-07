const FIGMA_API = 'https://api.figma.com';

/**
 * Extract the file key and (optionally) a node id from any Figma link:
 * https://www.figma.com/design/<key>/<name>?node-id=1-23
 * https://www.figma.com/file/<key>/<name>
 * @returns {{fileKey: string, nodeId: string|null}}
 */
export function parseFigmaUrl(url) {
  const m = String(url).match(/figma\.com\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/);
  if (!m) {
    throw new Error(
      `Не вдалося розпізнати посилання на Figma: "${url}". Очікується URL виду https://www.figma.com/design/<key>/...`
    );
  }
  const nodeMatch = String(url).match(/[?&]node-id=([\w:%-]+)/);
  let nodeId = null;
  if (nodeMatch) {
    // In URLs node ids use "-" instead of ":" (1-23 -> 1:23).
    nodeId = decodeURIComponent(nodeMatch[1]).replace(/-/g, ':');
  }
  return { fileKey: m[1], nodeId };
}

export class FigmaClient {
  constructor(token) {
    if (!token) {
      throw new Error(
        'Не задано токен Figma. Передайте --figma-token або змінну середовища FIGMA_TOKEN.'
      );
    }
    this.token = token;
  }

  async #get(pathname) {
    const res = await fetch(FIGMA_API + pathname, {
      headers: { 'X-Figma-Token': this.token },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Figma API ${res.status} для ${pathname}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }

  /**
   * Collect frames to compare against.
   * With a nodeId: that frame (or the frames inside it if it's a page).
   * Without: all top-level frames of the first page of the file.
   * @returns {Promise<Array<{id: string, name: string, width: number, height: number}>>}
   */
  async getFrames(fileKey, nodeId) {
    const toFrame = (node) => {
      const box = node.absoluteBoundingBox;
      if (!box) return null;
      return {
        id: node.id,
        name: node.name,
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    };

    if (nodeId) {
      const data = await this.#get(
        `/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}&depth=1`
      );
      const entry = data.nodes && data.nodes[nodeId];
      if (!entry || !entry.document) {
        throw new Error(`Вузол ${nodeId} не знайдено у файлі Figma ${fileKey}.`);
      }
      const doc = entry.document;
      if (doc.type === 'CANVAS') {
        return (doc.children || [])
          .filter((c) => c.type === 'FRAME' || c.type === 'COMPONENT' || c.type === 'SECTION')
          .map(toFrame)
          .filter(Boolean);
      }
      const frame = toFrame(doc);
      return frame ? [frame] : [];
    }

    const data = await this.#get(`/v1/files/${fileKey}?depth=2`);
    const pages = (data.document && data.document.children) || [];
    const firstPage = pages[0];
    if (!firstPage) return [];
    return (firstPage.children || [])
      .filter((c) => c.type === 'FRAME' || c.type === 'COMPONENT')
      .map(toFrame)
      .filter(Boolean);
  }

  /** Export node images as PNG. Returns { nodeId: url }. */
  async exportImages(fileKey, nodeIds, scale = 1) {
    const ids = nodeIds.map(encodeURIComponent).join(',');
    const data = await this.#get(
      `/v1/images/${fileKey}?ids=${ids}&format=png&scale=${scale}`
    );
    if (data.err) throw new Error(`Figma не змогла експортувати зображення: ${data.err}`);
    return data.images || {};
  }

  async download(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Не вдалося завантажити зображення з Figma (HTTP ${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }
}
