/**
 * End-to-end demo: serves the fixture site with intentional layout bugs
 * and runs the full audit against it. Output goes to ./demo-report.
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit } from '../src/index.js';

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../test/fixtures/demo-site'
);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  const file = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  try {
    const data = await readFile(path.join(fixtureDir, file));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/`;
console.log(`Демо-сайт із навмисними помилками верстки: ${url}\n`);

try {
  const report = await runAudit({ url, outDir: 'demo-report' });
  console.log('\nПідсумок:', JSON.stringify(report.summary));
  console.log(`Звіт: ${path.resolve('demo-report/index.html')}`);
} finally {
  server.close();
}
