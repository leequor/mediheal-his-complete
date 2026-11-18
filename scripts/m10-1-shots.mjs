// M10.1 screenshot pass: the released-run dialog, the correction form and the correction detail,
// at 1440 and 1366. No new page geometry; these are overlays on the existing Payroll screen.
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'qa', 'm10');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(8863, r));
const BASE = 'http://127.0.0.1:8863';

const spec = process.env.PW || path.resolve(ROOT, '../qa/node_modules/playwright-core');
const mod = await import(spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) ? pathToFileURL(spec).href : spec);
const chromium = mod.chromium || (mod.default && mod.default.chromium);
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });
await mkdir(OUT, { recursive: true });

for (const width of [1440, 1366]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.evaluate(() => HIS.auth.attempt('hr@mediheal.test', 'MediHeal2026!', true));
  await page.goto(BASE + '/payroll.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  // Walk the lifecycle through the real dialog until the run is released.
  for (let i = 0; i < 3; i++) {
    await page.click('[data-modal="proc"]');
    await page.waitForTimeout(200);
    await page.click('[data-ok]');
    await page.waitForTimeout(250);
  }

  // Make a real difference so the correction is not empty.
  await page.evaluate(() => {
    HIS.attendancePeriod.correct('EMP-008', '2026-08-18', { timeIn: '08:00', timeOut: '17:00', status: 'present' }, 'paid errand, not leave');
    HIS.attendancePeriod.approve('EMP-008', 'screenshot');
  });

  await page.click('[data-modal="proc"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `corr-released-${width}.png`), fullPage: false });

  await page.click('[data-corr="new"]');
  await page.waitForTimeout(250);
  await page.fill('#corrReason', 'Absence on 18 August was a paid errand, not unpaid leave');
  await page.screenshot({ path: path.join(OUT, `corr-form-${width}.png`), fullPage: false });

  await page.click('[data-ok]');
  await page.waitForTimeout(350);
  console.log(width, 'state', JSON.stringify(await page.evaluate(() => ({
    run: HIS.payrollRuns.current().status,
    corrections: HIS.payrollCorrections.all().map(c => ({ id: c.id, status: c.status, lines: c.lines.length })),
    modal: HIS.prState.modal, corrId: HIS.prState.corrId,
    tip: (document.querySelector('.pr-tip') || {}).textContent || null
  }))));
  await page.screenshot({ path: path.join(OUT, `corr-detail-${width}.png`), fullPage: false });

  const geo = await page.evaluate(() => {
    const m = document.querySelector('.pr-modal');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth };
  });
  console.log(width, JSON.stringify(geo), 'errors:', errs.length ? errs : 'none');
  await ctx.close();
}

await browser.close();
server.close();
