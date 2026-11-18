// Role reachability check (M1, updated for M3 account-based auth).
// For every seeded demo account:
//   1. open the role's home page and assert it does NOT redirect (no loop, no dead end);
//   2. assert every page in the role's allowlist opens without redirecting;
//   3. assert a page OUTSIDE the allowlist redirects away;
//   4. assert an unauthenticated request to a protected page lands on the sign-in screen.
//
// Sessions are seeded by writing `mh_session` (the exact shape auth.js persists), which keeps the
// check fast and independent of the sign-in form. The form itself is exercised by
// scripts/auth-check.mjs.
//
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
// Pages that intentionally forward somewhere else. pharmacy used to be here because
// pharmacy.html was a redirect to treatment.html?modal=pharmacy; M6 replaced it with a real
// screen, so the alias was removed rather than left to mask a future redirect.
const ALIAS = { staff: 'personnel' };
const expectStem = s => ALIAS[s] || s;

// Read the registry + seeded accounts once, so this check cannot drift from the app.
const probe = await ctx.newPage();
await probe.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
const info = await probe.evaluate(() => {
  const roles = {};
  Object.keys(HIS.rbac.ROLES).forEach(k => {
    const r = HIS.rbac.ROLES[k];
    roles[k] = { pages: r.pages, home: r.home, external: r.external || null };
  });
  const accounts = HIS.accounts.all().map(a => ({ id: a.id, email: a.email, role: a.role }));
  return { roles, accounts };
});
await probe.close();

let fail = 0, checks = 0;
const stemOf = url => url.replace(`http://127.0.0.1:${PORT}/`, '').split('?')[0].replace(/\.html$/, '');

for (const acct of info.accounts) {
  const r = info.roles[acct.role];
  if (!r) { fail++; console.log(`FAIL ${acct.email} has unknown role "${acct.role}"`); continue; }

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  // Seed the session exactly as auth.js would (localStorage = "keep me signed in").
  await page.addInitScript(a => {
    localStorage.setItem('mh_session', JSON.stringify({
      userId: a.id, email: a.email, role: a.role,
      at: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString(), remember: true
    }));
  }, acct);

  // 1. home reachable without redirect
  await page.goto(`http://127.0.0.1:${PORT}/${r.home}.html`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForTimeout(320);
  const landed = stemOf(page.url());
  checks++;
  if (landed !== expectStem(r.home)) { fail++; console.log(`FAIL ${acct.email.padEnd(32)} home ${r.home} redirected to ${landed}`); }

  // 2. every allowed page opens
  for (const stem of r.pages) {
    if (!pages.includes(stem)) { fail++; console.log(`FAIL ${acct.email.padEnd(32)} allowlist names missing page "${stem}"`); continue; }
    await page.goto(`http://127.0.0.1:${PORT}/${stem}.html`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(110);
    const got = stemOf(page.url());
    checks++;
    if (got !== expectStem(stem)) { fail++; console.log(`FAIL ${acct.email.padEnd(32)} ${stem} redirected to ${got}`); }
  }

  // 3. one disallowed page redirects away
  const outside = pages.filter(p => r.pages.indexOf(p) < 0 && p !== 'index' && p !== 'portal');
  if (outside.length) {
    const probeStem = outside[0];
    await page.goto(`http://127.0.0.1:${PORT}/${probeStem}.html`, { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(380);
    const got = stemOf(page.url());
    checks++;
    if (got === probeStem) { fail++; console.log(`FAIL ${acct.email.padEnd(32)} ${probeStem} should be blocked but rendered`); }
  }

  if (errs.length) { fail++; console.log(`FAIL ${acct.email.padEnd(32)} console: ${errs[0].slice(0, 90)}`); }
  else console.log(`ok   ${acct.email.padEnd(32)} role=${acct.role.padEnd(13)} pages=${String(r.pages.length).padStart(2)} blocked=${outside[0] || '-'}`);
  await page.close();
}

// 4. unauthenticated access is refused. This needs its OWN context: `ctx` above carries a seeded
// session for the account under test, so reusing it would test a signed-in request by mistake.
const anonCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const anon = await anonCtx.newPage();
await anon.goto(`http://127.0.0.1:${PORT}/dashboard.html`, { waitUntil: 'load' });
await anon.waitForTimeout(420);
checks++;
const anonUrl = anon.url();
if (!/\/index\.html/.test(anonUrl)) { fail++; console.log(`FAIL unauthenticated dashboard.html was not redirected (${anonUrl})`); }
else console.log(`ok   unauthenticated -> ${anonUrl.replace(`http://127.0.0.1:${PORT}/`, '')}`);
await anonCtx.close();

await browser.close();
server.close();
console.log(`\n${checks} checks, ${fail ? fail + ' failure(s)' : 'all accounts reachable, allowlists complete, out-of-scope pages blocked, anonymous access refused'}`);
process.exit(fail ? 1 : 0);
