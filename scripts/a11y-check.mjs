// Accessibility audit (M9.2).
//
// Runs axe-core (WCAG 2.1 A/AA) against every page at phone and desktop width, then adds a
// few checks axe cannot make: Escape closing a dialog, focus returning to the trigger, and
// whether the first Tab stop has a visible focus indicator.
//
//   PW=<path>/playwright-core/index.js node scripts/a11y-check.mjs [--width 390]
//
// axe is loaded from the CDN because the repo has no bundler; if it cannot be fetched the
// script says so and still runs the manual checks rather than reporting a false pass.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8815;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const buf = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));

const spec = process.env.PW || 'playwright-core';
const mod = await import(spec.startsWith('/') || spec.includes(':') ? pathToFileURL(spec).href : spec);
const chromium = mod.chromium || mod.default.chromium;

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const WIDTH = Number(arg('width', 390));
const AUTH = arg('auth', 'superadmin');

const PAGES = [
  'index', 'dashboard', 'registration', 'appointments', 'appointment-form', 'appointment-confirmed',
  'billing', 'claims', 'departments', 'profile', 'attendance', 'payroll', 'personnel', 'nursing',
  'consultation', 'treatment', 'audit', 'reports', 'accounts', 'portal',
  'registration-form', 'outpatient-form'
];

const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });
let axeLoaded = true;
const byRule = new Map();
const pageIssues = [];

for (const slug of PAGES) {
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 1 });
  const isPortal = slug === 'portal';
  const isIndex = slug === 'index';

  if (!isPortal && !isIndex) {
    const p0 = await ctx.newPage();
    await p0.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
    const ok = await p0.evaluate(([e, pw]) => !!HIS.auth.attempt(e, pw, true).ok, [`${AUTH}@mediheal.test`, 'MediHeal2026!']);
    await p0.close();
    if (!ok) { console.log(`SKIP ${slug}`); await ctx.close(); continue; }
  }

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/${slug}.html`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(400);

  // ---- axe -------------------------------------------------------------
  let results = null;
  if (axeLoaded) {
    try {
      await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js' });
      results = await page.evaluate(async () => await axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        resultTypes: ['violations']
      }));
    } catch (e) {
      axeLoaded = false;
      console.log('axe-core could not be loaded: ' + e.message.slice(0, 80));
    }
  }

  const v = results ? results.violations : [];
  if (v.length) pageIssues.push({ slug, n: v.length });
  for (const vi of v) {
    const key = vi.id;
    const cur = byRule.get(key) || { impact: vi.impact, help: vi.help, pages: new Set(), sample: vi.nodes[0]?.target?.join(' ') || '' };
    cur.pages.add(slug);
    byRule.set(key, cur);
  }

  // ---- manual: first Tab stop has a visible focus indicator --------------
  const focus = await page.evaluate(() => {
    const first = document.querySelector('a[href], button:not([disabled]), input:not([type=hidden]), select, textarea');
    if (!first) return null;
    first.focus();
    const cs = getComputedStyle(first);
    const hasRing = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
    return { tag: first.tagName, cls: String(first.className).slice(0, 24), hasRing };
  });

  console.log(`${v.length ? 'A11Y' : 'ok  '} ${slug.padEnd(21)} violations:${String(v.length).padStart(2)} focusRing:${focus ? focus.hasRing : 'n/a'}${errs.length ? ' ERR' : ''}${v.length ? '  ' + v.map(x => x.id).slice(0, 3).join(', ') : ''}`);
  await ctx.close();
}

// ---- manual: dialog Escape + focus restoration (accounts editor) ---------
let dialogReport = 'n/a';
{
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 } });
  const p0 = await ctx.newPage();
  await p0.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await p0.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));
  await p0.close();
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/accounts.html`, { waitUntil: 'load' });
  await page.waitForTimeout(350);
  await page.evaluate(() => document.querySelector('.ac-edit').click());
  await page.waitForTimeout(250);
  const opened = await page.evaluate(() => !!document.querySelector('.ac-m'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const closed = await page.evaluate(() => !document.querySelector('.ac-m'));
  const focusBack = await page.evaluate(() => document.activeElement?.className || '');
  dialogReport = `opened:${opened} escCloses:${closed} focusAfter:${String(focusBack).slice(0, 20)}`;
  await ctx.close();
}

await browser.close();
server.close();

console.log('\n=== violations by rule ===');
if (!byRule.size) console.log('none');
for (const [id, r] of [...byRule.entries()].sort((a, b) => (a[1].impact === 'critical' ? -1 : 1))) {
  console.log(`${String(r.impact).padEnd(9)} ${id.padEnd(26)} pages:${String(r.pages.size).padEnd(3)} ${r.help}`);
  console.log(`          e.g. ${r.sample}  [${[...r.pages].slice(0, 5).join(', ')}]`);
}
console.log(`\ndialog: ${dialogReport}`);
console.log(`axe loaded: ${axeLoaded}`);
