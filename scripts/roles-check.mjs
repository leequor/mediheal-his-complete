// Role reachability check (M1/M2). For every role in HIS.rbac.ROLES:
//   1. set mh_role, open the role's home page, assert it does NOT redirect (no loop, no dead end);
//   2. assert every page in the role's allowlist opens without redirecting;
//   3. assert a page OUTSIDE the allowlist does redirect away.
// Usage: node scripts/roles-check.mjs   (PW=/abs/path/to/playwright-core/index.js if needed)
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8792;
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

const browser = await chromium.launch({ channel: 'chrome' });
const pages = (await readdir(ROOT)).filter(f => f.endsWith('.html')).map(f => f.replace(/\.html$/, ''));
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// Pages that are aliases, not real destinations: pharmacy.html redirects to treatment, staff.html
// to personnel. Asking for the alias must land on the target, not on itself.
const ALIAS = { pharmacy: 'treatment', staff: 'personnel' };
const expectStem = s => ALIAS[s] || s;

// Read the registry once from the module itself so this check cannot drift from rbac.js.
const probe = await ctx.newPage();
await probe.goto(`http://127.0.0.1:${PORT}/dashboard.html`, { waitUntil: 'load' });
const ROLES = await probe.evaluate(() => {
  const o = {};
  Object.keys(HIS.rbac.ROLES).forEach(k => {
    const r = HIS.rbac.ROLES[k];
    o[k] = { pages: r.pages, home: r.home, external: r.external || null };
  });
  return o;
});
await probe.close();

let fail = 0, checks = 0;
for (const [key, r] of Object.entries(ROLES)) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  // 1. home reachable without redirect
  // HIS.store stores JSON, so the role must be written with JSON.stringify — a bare string parses
  // as corrupt and silently falls back to superadmin.
  await page.addInitScript(k => localStorage.setItem('mh_role', JSON.stringify(k)), key);
  const homeUrl = `http://127.0.0.1:${PORT}/${r.home}.html`;
  await page.goto(homeUrl, { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(350);
  const landed = page.url().replace(`http://127.0.0.1:${PORT}/`, '').split('?')[0].replace(/\.html$/, '');
  checks++;
  if (landed !== expectStem(r.home)) { fail++; console.log(`FAIL ${key.padEnd(14)} home ${r.home} redirected to ${landed}`); }

  // 2. every allowed page opens
  for (const stem of r.pages) {
    if (!pages.includes(stem)) { fail++; console.log(`FAIL ${key.padEnd(14)} allowlist names missing page "${stem}"`); continue; }
    await page.goto(`http://127.0.0.1:${PORT}/${stem}.html`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(120);
    const got = page.url().replace(`http://127.0.0.1:${PORT}/`, '').split('?')[0].replace(/\.html$/, '');
    checks++;
    if (got !== expectStem(stem)) { fail++; console.log(`FAIL ${key.padEnd(14)} ${stem} redirected to ${got}`); }
  }

  // 3. one disallowed page redirects away
  const outside = pages.filter(p => r.pages.indexOf(p) < 0 && p !== 'index' && p !== 'portal');
  if (outside.length) {
    const probeStem = outside[0];
    await page.goto(`http://127.0.0.1:${PORT}/${probeStem}.html`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(400);
    const got = page.url().replace(`http://127.0.0.1:${PORT}/`, '').split('?')[0].replace(/\.html$/, '');
    checks++;
    if (got === probeStem) { fail++; console.log(`FAIL ${key.padEnd(14)} ${probeStem} should be blocked but rendered`); }
  }

  if (errs.length) { fail++; console.log(`FAIL ${key.padEnd(14)} console: ${errs[0].slice(0, 90)}`); }
  else console.log(`ok   ${key.padEnd(14)} home=${r.home.padEnd(12)} pages=${String(r.pages.length).padStart(2)} blocked=${outside[0] || '-'}`);
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${checks} checks, ${fail ? fail + ' failure(s)' : 'all roles reachable, allowlists complete, out-of-scope pages blocked'}`);
process.exit(fail ? 1 : 0);
