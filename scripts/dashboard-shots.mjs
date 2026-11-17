// Capture every role's dashboard (M4). Signs in as each seeded account in its own browser context,
// screenshots the dashboard, and reports console errors + overflow.
// Usage: node scripts/dashboard-shots.mjs [outDir]
import http from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.resolve(ROOT, process.argv[2] || 'qa/dashboards');
const PORT = 8794;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json' };

const spec = process.env.PW || 'playwright-core';
const target = /^[a-zA-Z]:[\\/]|^\//.test(spec) ? pathToFileURL(spec).href : spec;
const mod = await import(target);
const chromium = mod.chromium || (mod.default && mod.default.chromium);

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
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const seedCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const probe = await seedCtx.newPage();
await probe.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
const accounts = await probe.evaluate(() => HIS.accounts.all().map(a => ({ id: a.id, email: a.email, role: a.role })));
await probe.close();
await seedCtx.close();

let fail = 0;
for (const acct of accounts) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(a => {
    localStorage.setItem('mh_session', JSON.stringify({
      userId: a.id, email: a.email, role: a.role,
      at: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString(), remember: true
    }));
  }, acct);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  // The patient role has no staff dashboard by design: rbac.js routes it to the public portal.
  const home = acct.role === 'patient' ? 'portal.html' : 'dashboard.html';
  await page.goto(`http://127.0.0.1:${PORT}/${home}`, { waitUntil: 'load', timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(420);

  const info = await page.evaluate(() => ({
    greet: document.querySelector('.dash-title')?.textContent || document.title || '',
    kpis: [...document.querySelectorAll('.kpi')].map(k => k.querySelector('.l').textContent + '=' + k.querySelector('.v').textContent),
    panelA: document.querySelectorAll('.card-h')[0]?.textContent || '',
    panelB: document.querySelectorAll('.card-h')[1]?.textContent || '',
    rows: document.querySelectorAll('.dr').length,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    height: document.documentElement.scrollHeight
  }));
  await page.screenshot({ path: path.join(OUT, acct.role + '__' + acct.email.split('@')[0] + '.png'), fullPage: true, animations: 'disabled' });

  const over = info.scrollW > info.clientW + 1;
  const bad = errs.length || over || !info.greet;
  if (bad) fail++;
  const label = acct.role === 'patient' ? `${acct.role} (portal)` : acct.role;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${label.padEnd(13)} ${info.greet.padEnd(28)} A:"${info.panelA}" B:"${info.panelB}" rows:${info.rows} ${over ? 'OVERFLOW' : ''}${errs.length ? ' err:' + errs[0].slice(0, 70) : ''}`);
  if (info.kpis.length) console.log(`     ${info.kpis.join('  |  ')}`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${accounts.length} dashboards -> ${OUT}${fail ? '  (' + fail + ' with problems)' : ''}`);
process.exit(fail ? 1 : 0);
