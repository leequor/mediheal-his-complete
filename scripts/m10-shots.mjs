// M10 screenshot pass: the two screens this milestone touched, plus their new modals, at 1440 and 1366.
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
await new Promise(r => server.listen(8862, r));
const BASE = 'http://127.0.0.1:8862';

const spec = process.env.PW || path.resolve(ROOT, '../qa/node_modules/playwright-core');
const mod = await import(spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) ? pathToFileURL(spec).href : spec);
const chromium = mod.chromium || (mod.default && mod.default.chromium);
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });
await mkdir(OUT, { recursive: true });

async function shot(name, page, full = true) {
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
  console.log('shot ' + name);
}

for (const width of [1440, 1366]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.evaluate(() => HIS.auth.attempt('hr@mediheal.test', 'MediHeal2026!', true));
  await page.goto(BASE + '/payroll.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await shot(`payroll-${width}`, page);

  if (width === 1440) {
    await page.click('[data-slip]');
    await page.waitForTimeout(250);
    await shot('payroll-payslip', page, false);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.click('[data-modal="timesheets"]');
    await page.waitForTimeout(250);
    await shot('payroll-timesheets', page, false);
    await page.click('[data-tab="thirteenth"]');
    await page.waitForTimeout(200);
    await shot('payroll-thirteenth', page, false);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.click('[data-modal="proc"]');
    await page.waitForTimeout(250);
    await shot('payroll-process', page, false);
  }
  await ctx.close();

  const ctx2 = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', e => errs.push(e.message));
  await p2.goto(BASE + '/index.html', { waitUntil: 'load' });
  await p2.evaluate(() => HIS.auth.attempt('finance@mediheal.test', 'MediHeal2026!', true));
  await p2.goto(BASE + '/claims.html', { waitUntil: 'load' });
  await p2.waitForTimeout(500);
  await shot(`claims-${width}`, p2);
  if (width === 1440) {
    await p2.click('[data-open="CLM-2026-0001"]');
    await p2.waitForTimeout(250);
    await shot('claims-detail', p2, false);
  }
  await ctx2.close();
  console.log('errors @' + width + ': ' + (errs.length ? errs.join(' | ') : 'none'));
}

await browser.close();
server.close();
