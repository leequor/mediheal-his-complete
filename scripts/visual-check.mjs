// Visual regression harness (M0, docs/DESIGN-LOCK.md §11).
// Captures every page at a fixed viewport and diffs it against a stored baseline, so a functional
// change cannot silently move pixels. Diffing happens inside the browser on a canvas, so there are
// no image-processing dependencies beyond playwright-core.
//
//   node scripts/visual-check.mjs --capture [--out qa/baseline] [--width 1440]
//   node scripts/visual-check.mjs --check   [--baseline qa/baseline] [--width 1440]
//
// --capture writes <page>__<width>.png plus baseline-manifest.json (sha256 + size).
// --check compares current render against the baseline and reports, per page, the percentage of
// pixels that differ and the bounding box of the change. Exit code 1 if any page exceeds --max.
//
// The baseline images are intentionally NOT committed (9 MB); the manifest is, so drift is
// detectable from the hash alone. Regenerate the images with --capture when you need to look.
import http from 'node:http';
import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def; };
const has = name => process.argv.includes('--' + name);
const WIDTH = Number(arg('width', 1440));
// Tolerated % of differing pixels per page. Measured noise across separate browser launches reaches
// ~0.06% on text-heavy pages while zero pixels differ by >=128, so 0.1% separates renderer noise
// from a real change (the M3 login redesign measured 0.59%, six times this).
const MAX_PCT = Number(arg('max', 0.1));
const CAPTURE = has('capture');
const OUT = path.resolve(ROOT, arg('out', 'qa/baseline'));
const BASE = path.resolve(ROOT, arg('baseline', 'qa/baseline'));
const PORT = Number(arg('port', 8791));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' };

// PW may be a bare package name or an absolute path; ESM needs a file: URL for the latter.
const spec = process.env.PW || 'playwright-core';
const target = /^[a-zA-Z]:[\\/]|^\//.test(spec) ? pathToFileURL(spec).href : spec;
let chromium;
try {
  const mod = await import(target);
  // playwright-core is CommonJS: depending on how Node links it, the export lives on `.default`.
  chromium = mod.chromium || (mod.default && mod.default.chromium);
  if (!chromium) throw new Error('no chromium export');
} catch {
  console.error('Cannot import playwright-core (tried ' + spec + '). Install it or set PW=/abs/path/to/playwright-core/index.js');
  process.exit(2);
}

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(PORT, r));

const pages = (await readdir(ROOT)).filter(f => f.endsWith('.html')).sort();
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });
const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 1 });

// M3: shell pages sit behind the sign-in guard, so the capture context carries a seeded session.
// index.html and portal.html are public and are captured WITHOUT one (otherwise index would
// redirect to the dashboard and the login screen would never be photographed).
const AUTH_EMAIL = process.env.AUTH_EMAIL || 'superadmin@mediheal.test';
const PUBLIC = new Set(['index', 'portal']);
const probe = await ctx.newPage();
await probe.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
const authAcct = await probe.evaluate(email => {
  const a = HIS.accounts.byEmail(email);
  return a ? { id: a.id, email: a.email, role: a.role } : null;
}, AUTH_EMAIL);
await probe.close();
if (!authAcct) { console.error('No seeded account for ' + AUTH_EMAIL + '; cannot capture protected pages.'); process.exit(2); }
await ctx.addInitScript(a => {
  localStorage.setItem('mh_session', JSON.stringify({
    userId: a.id, email: a.email, role: a.role,
    at: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString(), remember: true
  }));
}, authAcct);
const ctxPublic = await browser.newContext({ viewport: { width: WIDTH, height: 900 }, deviceScaleFactor: 1 });
console.log(`visual-check: authenticated as ${AUTH_EMAIL} (${authAcct.role})`);

const manifest = {};
let failures = 0;

for (const name of pages) {
  const slug = name.replace(/\.html$/, '');
  const file = path.join(OUT, `${slug}__${WIDTH}.png`);
  const page = await (PUBLIC.has(slug) ? ctxPublic : ctx).newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(`http://127.0.0.1:${PORT}/${name}`, { waitUntil: 'load', timeout: 25000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(450);

  if (CAPTURE) {
    const buf = await page.screenshot({ fullPage: true, animations: 'disabled' });
    await writeFile(file, buf);
    const box = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
    manifest[slug] = { width: WIDTH, height: box.h, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') };
    console.log(`cap  ${slug.padEnd(24)} ${box.w}x${box.h}  ${(buf.length / 1024).toFixed(0)}KB  err:${errors.length}`);
  } else {
    let baseBuf;
    try { baseBuf = await readFile(file); }
    catch { console.log(`skip ${slug.padEnd(24)} no baseline (run --capture)`); await page.close(); continue; }

    const curBuf = await page.screenshot({ fullPage: true, animations: 'disabled' });
    const same = createHash('sha256').update(curBuf).digest('hex') === createHash('sha256').update(baseBuf).digest('hex');

    let res = { pct: 0, box: null, hard: 0 };
    if (!same) res = await page.evaluate(async ([a, b]) => {
      const load = src => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
      const toURL = async buf => 'data:image/png;base64,' + buf;
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height);
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(ia, 0, 0); const da = cx.getImageData(0, 0, w, h).data;
      cx.clearRect(0, 0, w, h); cx.drawImage(ib, 0, 0); const db = cx.getImageData(0, 0, w, h).data;
      let diff = 0, hard = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      const TH = 12; // per-channel tolerance: ignores sub-pixel AA noise
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
        if (d > TH) {
          diff++;
          if (d >= 128) hard++;
          const p = i / 4, x = p % w, y = (p / w) | 0;
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      return { pct: (diff / (w * h)) * 100, hard, box: x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
    }, [await toDataURL(curBuf), await toDataURL(baseBuf)]);

    const bad = res.pct > MAX_PCT;
    if (bad) failures++;
    const b = res.box ? `box ${res.box.x},${res.box.y} ${res.box.w}x${res.box.h}` : 'no region';
    console.log(`${bad ? 'DIFF' : 'ok  '} ${slug.padEnd(24)} ${res.pct.toFixed(3)}%  hard:${String(res.hard).padStart(5)}  ${b}  err:${errors.length}`);
  }

  if (errors.length) {
    failures++;
    errors.slice(0, 3).forEach(e => console.log('      ! ' + String(e).split('\n')[0].slice(0, 150)));
  }
  await page.close();
}

await browser.close();
server.close();

if (CAPTURE) {
  await writeFile(path.join(OUT, `baseline-manifest-${WIDTH}.json`), JSON.stringify(manifest, null, 2));
  console.log(`\ncaptured ${pages.length} pages @${WIDTH} -> ${OUT}`);
} else {
  console.log(`\n${failures ? failures + ' page(s) changed or errored' : 'all pages match baseline'}`);
  process.exit(failures ? 1 : 0);
}

async function toDataURL(buf) { return 'data:image/png;base64,' + buf.toString('base64'); }
