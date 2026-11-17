// DOM probe: report elements whose rendered box is smaller than their content, which is the
// signature of an inline Figma height surviving a responsive reflow. Automated audits check
// text size and page overflow; they do not check "this row is 35px tall but needs 52".
//
//   PW=<path>/playwright-core/index.js node scripts/overflow-probe.mjs [--width 390] [--only profile]

import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8813;
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
const ONLY = arg('only', null);

const PAGES = [
  ['dashboard', 'superadmin'], ['registration', 'superadmin'], ['appointments', 'superadmin'],
  ['billing', 'superadmin'], ['departments', 'superadmin'], ['profile', 'superadmin'],
  ['attendance', 'hr'], ['payroll', 'hr'], ['personnel', 'hr'],
  ['nursing', 'nurse'], ['consultation', 'doctor'], ['treatment', 'doctor'],
  ['audit', 'auditor'], ['reports', 'finance'], ['accounts', 'superadmin'],
  ['appointment-form', 'superadmin'], ['outpatient-form', 'superadmin'],
  ['registration-form', 'superadmin'], ['appointment-confirmed', 'superadmin']
];

const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });
let total = 0;

for (const [slug, who] of PAGES) {
  if (ONLY && !ONLY.split(',').includes(slug)) continue;
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 1 });
  const p0 = await ctx.newPage();
  await p0.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  const ok = await p0.evaluate(([e, pw]) => !!HIS.auth.attempt(e, pw, true).ok, [`${who}@mediheal.test`, 'MediHeal2026!']);
  await p0.close();
  if (!ok) { console.log(`SKIP ${slug} (no account ${who})`); await ctx.close(); continue; }

  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/${slug}.html`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await page.waitForTimeout(450);

  const rows = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.stage *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const cs = getComputedStyle(el);
      if (cs.position === 'absolute' || cs.position === 'fixed') return;
      // content taller than the box, and the box is not just a text line
      const overY = el.scrollHeight - el.clientHeight;
      if (overY > 4 && cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') {
        out.push({
          cls: String(el.className || el.tagName).slice(0, 30),
          h: Math.round(r.height), need: el.scrollHeight,
          over: overY, inlineH: el.style.height || '',
          txt: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 46)
        });
      }
    });
    // collapse duplicate classes, keep worst
    const best = new Map();
    for (const o of out) {
      const k = o.cls;
      if (!best.has(k) || best.get(k).over < o.over) best.set(k, o);
    }
    return [...best.values()].sort((a, b) => b.over - a.over);
  });

  total += rows.length;
  console.log(`${rows.length ? 'BAD ' : 'ok  '} ${slug.padEnd(21)} ${rows.length} clipped`);
  for (const r of rows.slice(0, 5)) console.log(`      ${r.cls.padEnd(30)} box:${r.h} need:${r.need} (+${r.over}) inline:"${r.inlineH}" ${r.txt}`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${total} clipped elements at ${WIDTH}px`);
