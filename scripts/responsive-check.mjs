// Responsive + console sweep (M3/M4). Shell pages are behind auth, so this signs in first.
// For every page at 1440/1200/1000/800/390 it asserts no horizontal overflow and no console error.
// Usage: node scripts/responsive-check.mjs [--widths 1440,1200,1000,800,390]
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8796;
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const WIDTHS = String(arg('widths', '1440,1200,1000,800,390')).split(',').map(Number);
const EMAIL = arg('email', 'superadmin@mediheal.test');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };

const spec = process.env.PW || 'playwright-core';
const target = /^[a-zA-Z]:[\\/]|^\//.test(spec) ? pathToFileURL(spec).href : spec;
const mod = await import(target);
const chromium = mod.chromium || (mod.default && mod.default.chromium);
if (!chromium) { console.error('playwright-core not resolvable; set PW=...'); process.exit(2); }

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
const PUBLIC = new Set(['index.html', 'portal.html']);

const browser = await chromium.launch({ channel: 'chrome' });
const seedCtx = await browser.newContext();
const probe = await seedCtx.newPage();
await probe.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
const acct = await probe.evaluate(e => { const a = HIS.accounts.byEmail(e); return a ? { id: a.id, email: a.email, role: a.role } : null; }, EMAIL);
await probe.close();
await seedCtx.close();
if (!acct) { console.error('No account for ' + EMAIL); process.exit(2); }

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(a => {
  localStorage.setItem('mh_session', JSON.stringify({ userId: a.id, email: a.email, role: a.role, at: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString(), remember: true }));
}, acct);
const ctxPublic = await browser.newContext({ viewport: { width: 1440, height: 900 } });

let fails = 0, checks = 0;
for (const name of pages) {
  const page = await (PUBLIC.has(name) ? ctxPublic : ctx).newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(`http://127.0.0.1:${PORT}/${name}`, { waitUntil: 'load', timeout: 25000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(280);

  const over = [];
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(90);
    const bad = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    if (bad) over.push(w);
    checks++;
  }
  const fail = over.length || errs.length;
  if (fail) fails++;
  console.log(`${fail ? 'FAIL' : 'ok  '} ${name.padEnd(26)} overflow:[${over.join(',')}] errors:${errs.length}${errs.length ? '  ' + errs[0].slice(0, 70) : ''}`);
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${pages.length} pages x ${WIDTHS.length} widths = ${checks} checks, ${fails ? fails + ' page(s) failed' : 'no overflow, no console errors'}`);
process.exit(fails ? 1 : 0);
