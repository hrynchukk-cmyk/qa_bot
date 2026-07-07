import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { runAudit } from '../index.js';
import { parseViewports } from '../viewports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.resolve(process.env.QA_BOT_RUNS_DIR || 'runs');
const PORT = Number(process.env.PORT || 3000);
const MAX_JOBS_KEPT = 200;

/** @type {Map<string, object>} in-memory job registry */
const jobs = new Map();
// Audits are heavy (a real browser per run) — execute them one at a time.
let queueTail = Promise.resolve();

function publicJob(job) {
  return {
    id: job.id,
    url: job.url,
    figmaUrl: job.figmaUrl || null,
    status: job.status,
    createdAt: job.createdAt,
    log: job.log,
    summary: job.summary || null,
    figmaComparisons: job.figmaComparisons || null,
    error: job.error || null,
    reportUrl: job.status === 'done' ? `/reports/${job.id}/index.html` : null,
    queuePosition:
      job.status === 'queued'
        ? [...jobs.values()].filter((j) => j.status === 'queued' && j.createdAt < job.createdAt).length
        : null,
  };
}

async function executeJob(job) {
  job.status = 'running';
  try {
    const report = await runAudit({
      url: job.url,
      viewports: job.viewports,
      outDir: path.join(RUNS_DIR, job.id),
      figma: job.figma,
      log: (line) => {
        job.log.push(String(line));
        if (job.log.length > 200) job.log.shift();
      },
    });
    job.summary = report.summary;
    if (report.figma) {
      job.figmaComparisons = report.figma.comparisons.map((c) => ({
        name: c.frame.name,
        width: c.frame.width,
        height: c.frame.height,
        mismatchPct: c.mismatchPct ?? null,
        status: c.status || null,
        error: c.error || null,
      }));
    }
    job.status = 'done';
  } catch (err) {
    job.status = 'error';
    job.error = String(err.message || err);
  } finally {
    delete job.figma; // don't keep the Figma token in memory longer than needed
  }
}

function enqueue(job) {
  jobs.set(job.id, job);
  // Drop oldest finished jobs so the registry doesn't grow forever.
  if (jobs.size > MAX_JOBS_KEPT) {
    for (const [id, j] of jobs) {
      if (jobs.size <= MAX_JOBS_KEPT) break;
      if (j.status === 'done' || j.status === 'error') jobs.delete(id);
    }
  }
  queueTail = queueTail.then(() => executeJob(job));
}

const app = express();
app.use(express.json({ limit: '100kb' }));

app.post('/api/audits', (req, res) => {
  const body = req.body || {};
  let url = String(body.url || '').trim();
  if (!url) return res.status(400).json({ error: 'Вкажіть посилання на сайт.' });
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: `Некоректне посилання: "${body.url}".` });
  }

  let viewports;
  try {
    viewports = parseViewports(String(body.viewports || ''));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let figma = null;
  const figmaUrl = String(body.figmaUrl || '').trim();
  if (figmaUrl) {
    const token = String(body.figmaToken || '').trim() || process.env.FIGMA_TOKEN;
    if (!token) {
      return res.status(400).json({
        error: 'Для порівняння з Figma потрібен токен (поле "Токен Figma" або змінна FIGMA_TOKEN на сервері).',
      });
    }
    figma = { url: figmaUrl, token };
  }

  const job = {
    id: randomUUID().slice(0, 8) + '-' + Date.now().toString(36),
    url,
    figmaUrl: figmaUrl || null,
    viewports,
    figma,
    status: 'queued',
    createdAt: Date.now(),
    log: [],
  };
  enqueue(job);
  res.status(202).json(publicJob(job));
});

app.get('/api/audits/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Завдання не знайдено.' });
  res.json(publicJob(job));
});

app.use('/reports', express.static(RUNS_DIR, { fallthrough: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`QA Design Bot: відкрийте http://localhost:${PORT} у браузері`);
  console.log(`Звіти зберігаються у ${RUNS_DIR}`);
});
