// Authentication + account-management checks (M3).
// Drives the real sign-in form where a user would, and the account API for the edge cases that are
// impractical to click through. Every assertion prints PASS/FAIL with the observed value.
//
// Usage: node scripts/auth-check.mjs   (PW=/abs/path/to/playwright-core/index.js if needed)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8793;
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

const B = `http://127.0.0.1:${PORT}`;
const PW_DEMO = 'MediHeal2026!';
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}${detail ? '  -> ' + detail : ''}`); }
}

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const stem = () => page.url().replace(B + '/', '').split('?')[0].replace(/\.html$/, '');

async function freshIndex() {
  await page.goto(`${B}/index.html`, { waitUntil: 'load' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${B}/index.html`, { waitUntil: 'load' });
  await page.waitForTimeout(120);
}
async function submit(email, pass) {
  await page.evaluate(([e, p]) => {
    const msg = document.getElementById('siMsg');
    if (msg) msg.textContent = '';          // a stale error would satisfy the wait below
    document.getElementById('sie').value = e;
    document.getElementById('sip').value = p;
    document.getElementById('siBtn').click();
  }, [email, pass]);
  // Wait for the outcome rather than for a duration: the redirect is what the next assertion reads,
  // and on a loaded machine 800ms was not always enough for it to land.
  try {
    await page.waitForFunction(() => {
      if (/dashboard\.html$/.test(location.pathname)) return true;
      const msg = document.getElementById('siMsg');
      // only an error ON the sign-in form counts; the form being momentarily absent is a transition
      return !!(msg && msg.textContent.trim() && document.getElementById('siBtn'));
    }, null, { timeout: 6000 });
  } catch (e) { /* the caller's assertion reports the real state */ }
  // The URL changes when the new document commits, before its scripts have mounted the header.
  try { await page.waitForSelector('#profile .nm', { timeout: 4000 }); } catch (e) { /* sign-in page */ }
  await page.waitForTimeout(150);
}
const message = () => page.evaluate(() => document.getElementById('siMsg').innerText.trim());

// ---- 1. empty credentials -------------------------------------------------
await freshIndex();
await submit('', '');
ok('empty credentials are rejected', /email/i.test(await message()) && stem() === 'index', await message());

// ---- 2. malformed email ---------------------------------------------------
await submit('not-an-email', PW_DEMO);
ok('malformed email is rejected', /valid email/i.test(await message()) && stem() === 'index', await message());

// ---- 3. unknown account ---------------------------------------------------
await submit('nobody@mediheal.test', PW_DEMO);
ok('unknown account is rejected', /no account uses that email/i.test(await message()) && stem() === 'index', await message());

// ---- 4. wrong password ----------------------------------------------------
await submit('doctor@mediheal.test', 'definitely-wrong');
ok('wrong password is rejected', /password does not match/i.test(await message()) && stem() === 'index', await message());

// ---- 5. empty password ----------------------------------------------------
await submit('doctor@mediheal.test', '');
ok('empty password is rejected', /password/i.test(await message()) && stem() === 'index', await message());

// ---- 6. valid, with uppercase + surrounding whitespace ---------------------
await submit('   Doctor@MediHeal.TEST   ', PW_DEMO);
ok('uppercase/whitespace email signs in', stem() === 'dashboard', page.url());
const who = await page.evaluate(() => ({ name: document.querySelector('.profile .nm')?.textContent, role: HIS.rbac.key(), email: HIS.auth.account()?.email }));
ok('identity resolves from the account', who.name === 'Dr. Laurice Laureta' && who.role === 'doctor' && who.email === 'doctor@mediheal.test', JSON.stringify(who));

// ---- 7. refresh keeps the session ----------------------------------------
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(250);
ok('refresh keeps the session', stem() === 'dashboard', page.url());

// ---- 8. sign out clears the session --------------------------------------
await page.evaluate(() => { HIS.auth.signOut(); });
await page.goto(`${B}/dashboard.html`, { waitUntil: 'load' });
await page.waitForTimeout(350);
ok('sign-out blocks protected pages', /\/index\.html/.test(page.url()), page.url());

// ---- 9. expired session is refused ---------------------------------------
await page.evaluate(() => {
  localStorage.setItem('mh_session', JSON.stringify({
    userId: 'USR-0005', email: 'doctor@mediheal.test', role: 'doctor',
    at: new Date(Date.now() - 9e6).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString(), remember: true
  }));
});
await page.goto(`${B}/dashboard.html`, { waitUntil: 'load' });
await page.waitForTimeout(350);
ok('expired session is refused', /\/index\.html/.test(page.url()), page.url());

// ---- 10. "keep me signed in" uses localStorage ----------------------------
await freshIndex();
await page.evaluate(() => { document.getElementById('sik').checked = true; });
await submit('nurse@mediheal.test', PW_DEMO);
const storage = await page.evaluate(() => ({ ls: !!localStorage.getItem('mh_session'), ss: !!sessionStorage.getItem('mh_session_tab') }));
ok('remember-me persists to localStorage', storage.ls && !storage.ss, JSON.stringify(storage));

// ---- 11. account API: duplicates, roles, reset, role change, deactivation --
const api = await page.evaluate(PW => {
  const out = {};
  const before = HIS.accounts.all().length;
  out.dupLower = HIS.accounts.create({ email: 'NURSE@mediheal.test', name: 'Dup', role: 'nurse' }).ok;
  out.badRole = HIS.accounts.create({ email: 'x1@mediheal.test', name: 'X', role: 'wizard' }).ok;
  const made = HIS.accounts.create({ email: 'flow.test@mediheal.test', name: 'Flow Test', role: 'cashier', password: 'FirstPass123' });
  out.created = made.ok;
  out.countDelta = HIS.accounts.all().length - before;
  out.loginNew = HIS.auth.attempt('flow.test@mediheal.test', 'FirstPass123', false).ok;
  HIS.auth.clear();
  out.reset = HIS.accounts.setPassword(made.account.id, 'SecondPass456').ok;
  out.oldPassAfterReset = HIS.auth.attempt('flow.test@mediheal.test', 'FirstPass123', false).ok;
  HIS.auth.clear();
  out.newPassAfterReset = HIS.auth.attempt('flow.test@mediheal.test', 'SecondPass456', false).ok;
  out.roleAfterReset = HIS.auth.account() ? HIS.rbac.key() : null;
  HIS.auth.clear();
  out.roleChange = HIS.accounts.update(made.account.id, { role: 'auditor' }).ok;
  out.loginAfterRoleChange = HIS.auth.attempt('flow.test@mediheal.test', 'SecondPass456', false).ok;
  out.roleIsAuditor = HIS.rbac.key();
  HIS.auth.clear();
  out.deactivate = HIS.accounts.update(made.account.id, { status: 'disabled' }).ok;
  out.loginWhenDisabled = HIS.auth.attempt('flow.test@mediheal.test', 'SecondPass456', false).ok;
  HIS.auth.clear();
  // clean up the flow account so the seed stays 14
  HIS.accounts.save(HIS.accounts.all().filter(a => a.email !== 'flow.test@mediheal.test'));
  out.finalCount = HIS.accounts.all().length;
  return out;
}, PW_DEMO);
ok('duplicate email is refused (case-insensitive)', api.dupLower === false);
ok('invalid role is refused', api.badRole === false);
ok('account creation adds exactly one record', api.created && api.countDelta === 1, JSON.stringify(api));
ok('new account can sign in', api.loginNew === true);
ok('password reset succeeds', api.reset === true);
ok('old password stops working after reset', api.oldPassAfterReset === false);
ok('new password works after reset', api.newPassAfterReset === true);
ok('role change takes effect on the next session', api.loginAfterRoleChange && api.roleIsAuditor === 'auditor', JSON.stringify({ ok: api.loginAfterRoleChange, role: api.roleIsAuditor }));
ok('deactivated account cannot sign in', api.loginWhenDisabled === false);
ok('seed count restored to 14', api.finalCount === 14, String(api.finalCount));

// ---- 12. audit log captured the auth events ------------------------------
// Produced right here rather than relied on from earlier steps: freshIndex() clears localStorage
// between steps, which also clears mh_audit.
await freshIndex();
await submit('nurse@mediheal.test', 'wrong-password');   // -> failed attempt
await submit('nurse@mediheal.test', PW_DEMO);            // -> signed in
await page.evaluate(() => HIS.auth.signOut());           // -> signed out
const audited = await page.evaluate(() => HIS.audit.list().map(r => r.what));
ok('successful sign-in is audited', audited.some(w => /Signed in/.test(w)), audited.join(' | ').slice(0, 140));
ok('failed sign-in is audited', audited.some(w => /Failed sign-in/.test(w)));
ok('sign-out is audited', audited.some(w => /Signed out/.test(w)));
ok('no password material is audited', !audited.join(' ').match(/MediHeal2026|FirstPass123|SecondPass456/));

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
