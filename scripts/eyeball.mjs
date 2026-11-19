// Eyeball harness. Captures every page at the three required desktop viewports and, alongside each
// screenshot, records the things a person would notice but an assertion would not: text clipped by
// its own box, elements overflowing their container, controls sitting outside the viewport, text
// colliding with an icon, and rows whose height does not match their content.
//
// The screenshot is the evidence; the measurements only tell me where to look.
//
// Run: PW=<playwright-core> node scripts/eyeball.mjs [--only page1,page2] [--out dir]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PW = process.env.PW;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const b = fs.readFileSync(path.join('.', p));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(b);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const argv = process.argv.slice(2);
const arg = n => { const i = argv.indexOf('--' + n); return i > -1 ? argv[i + 1] : null; };
const OUT = arg('out') || 'qa/eyeball';
const ONLY = arg('only') ? arg('only').split(',') : null;
const VIEWPORTS = [[1440, 900], [1366, 768], [1280, 800]];

const mod = await import(pathToFileURL(PW).href);
const browser = await (mod.chromium || mod.default.chromium).launch({ channel: 'chrome' });
fs.mkdirSync(OUT, { recursive: true });

const ACCOUNT = process.env.ACCOUNT || 'superadmin@mediheal.test';
const PUBLIC = new Set(['index', 'portal']);

// Everything a visitor can see that might be wrong with the box it lives in.
const PROBE = () => {
  const out = { clipped: [], overflow: [], offscreen: [], collide: [], tiny: [], rows: [] };
  const vis = el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const label = el => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 42);
    const cls = (el.className || '').toString().split(' ')[0];
    return (cls ? '.' + cls + ' ' : el.tagName.toLowerCase() + ' ') + '«' + t + '»';
  };

  // 1. text clipped by its own box (ellipsis is intentional in a few places; a hard cut is not)
  document.querySelectorAll('body *').forEach(el => {
    if (el.children.length) return;
    if (!vis(el)) return;
    const cs = getComputedStyle(el);
    if (cs.textOverflow === 'ellipsis' || cs.whiteSpace === 'nowrap') return;
    if (el.scrollHeight > el.clientHeight + 3 && el.clientHeight > 0) {
      out.clipped.push(label(el) + ' h' + el.clientHeight + '<' + el.scrollHeight);
    }
  });

  // 2. a child wider than the box that clips it
  document.querySelectorAll('body *').forEach(el => {
    if (!vis(el)) return;
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'visible') return;
    if (el.scrollWidth > el.clientWidth + 4 && el.clientWidth > 0) {
      out.overflow.push(label(el) + ' w' + el.clientWidth + '<' + el.scrollWidth);
    }
  });

  // 3. controls outside the window
  document.querySelectorAll('button, a, input, select, textarea').forEach(el => {
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 2 || r.left < -2) out.offscreen.push(label(el) + ' x' + Math.round(r.left) + '..' + Math.round(r.right));
  });

  // 4. an absolutely positioned text block overlapping a sibling icon/button
  document.querySelectorAll('.ad-btn, .a-ib, .pr-m-ok, .tp-m-ok').forEach(btn => {
    if (!vis(btn)) return;
    const b = btn.getBoundingClientRect();
    const parent = btn.parentElement;
    if (!parent) return;
    [...parent.children].forEach(sib => {
      if (sib === btn || !vis(sib)) return;
      const s = sib.getBoundingClientRect();
      const ox = Math.min(b.right, s.right) - Math.max(b.left, s.left);
      const oy = Math.min(b.bottom, s.bottom) - Math.max(b.top, s.top);
      if (ox > 6 && oy > 6) out.collide.push(label(btn) + ' overlaps ' + label(sib));
    });
  });

  // 5. text below the 12px floor the project set for itself
  document.querySelectorAll('body *').forEach(el => {
    if (el.children.length || !vis(el)) return;
    const t = (el.textContent || '').trim();
    if (!t) return;
    const fs2 = parseFloat(getComputedStyle(el).fontSize);
    if (fs2 && fs2 < 11.5) out.tiny.push(label(el) + ' ' + fs2 + 'px');
  });

  // 6. table rows whose content is taller than the row
  document.querySelectorAll('.ad-tr, .a-row, .pr-r, .bl-row, .at-r').forEach(r => {
    if (!vis(r)) return;
    const rr = r.getBoundingClientRect();
    [...r.children].forEach(c => {
      if (!vis(c)) return;
      const cr = c.getBoundingClientRect();
      if (cr.height > rr.height + 2) out.rows.push(label(c) + ' ' + Math.round(cr.height) + '>' + Math.round(rr.height));
    });
  });

  const uniq = a => [...new Set(a)].slice(0, 6);
  return {
    clipped: uniq(out.clipped), overflow: uniq(out.overflow), offscreen: uniq(out.offscreen),
    collide: uniq(out.collide), tiny: uniq(out.tiny), rows: uniq(out.rows),
    pageHeight: document.documentElement.scrollHeight,
    hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  };
};

const pages = fs.readdirSync('.').filter(f => f.endsWith('.html')).sort()
  .filter(f => !ONLY || ONLY.includes(f.replace('.html', '')));

const report = {};
for (const [W, H] of VIEWPORTS) {
  for (const file of pages) {
    const slug = file.replace('.html', '');
    const ctx = await browser.newContext({ viewport: { width: W, height: H } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e).slice(0, 120)));

    if (!PUBLIC.has(slug)) {
      await page.goto(BASE + '/index.html', { waitUntil: 'load' });
      await page.evaluate(([em, pw]) => HIS.auth.attempt(em, pw, true), [ACCOUNT, 'MediHeal2026!']);
    }
    await page.goto(BASE + '/' + file, { waitUntil: 'load' });
    await page.waitForTimeout(520);
    await page.evaluate(() => document.fonts.ready);

    const probe = await page.evaluate(PROBE);
    await page.screenshot({ path: path.join(OUT, slug + '-' + W + '.png'), fullPage: false });

    const key = W + '/' + slug;
    report[key] = Object.assign({ errors }, probe);
    const flags = ['clipped', 'overflow', 'offscreen', 'collide', 'tiny', 'rows'].reduce((n, k) => n + probe[k].length, 0);
    const mark = (flags || probe.hOverflow || errors.length) ? '!' : ' ';
    console.log(mark + ' ' + String(W).padEnd(5) + slug.padEnd(22) +
      ' flags:' + String(flags).padStart(2) +
      (probe.hOverflow ? ' H-OVERFLOW' : '') +
      (errors.length ? ' ERR' : '') +
      '  h' + probe.pageHeight);
    await ctx.close();
  }
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log('\nreport: ' + path.join(OUT, 'report.json'));
await browser.close();
server.close();
