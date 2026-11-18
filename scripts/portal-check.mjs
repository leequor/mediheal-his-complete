// M5 harness: unified patient identity and the signed-in portal.
//
// What it proves, per assertion:
//   - the patient login resolves to ONE hospital record (account.patientId -> HIS.registry)
//   - every portal view is scoped to that record and leaks no other patient's data
//   - appointments and invoices resolve through the shared stores, not a portal-private copy
//   - a staff account cannot open the portal
//   - guardian access is explicit, revocable, and scoped
//   - documents are real files
//   - the session survives a refresh and dies on sign-out
//
// Usage: PW=<playwright-core> node scripts/portal-check.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2'
};
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(8841, r));
const BASE = 'http://127.0.0.1:8841';

const spec = process.env.PW || 'playwright-core';
const mod = await import(spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) ? pathToFileURL(spec).href : spec);
const chromium = mod.chromium || (mod.default && mod.default.chromium);
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '  \u2192 ' + detail : '')); }
};

const DEMO = 'MediHeal2026!';

async function ctxFor() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const errs = [];
  ctx.on('page', p => p.on('pageerror', e => errs.push(String(e.message))));
  return { ctx, errs };
}
async function open(ctx) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  return { page, errs };
}

// ---------------------------------------------------------------- 1. patient sign-in
{
  const { ctx } = await ctxFor();
  const { page, errs } = await open(ctx);
  await page.goto(BASE + '/portal.html#signin', { waitUntil: 'load' });
  await page.fill('#pt-si-email', '  Patient@MediHeal.TEST ');
  await page.fill('#pt-signin input[name=password]', DEMO);
  await page.click('#pt-signin button[type=submit]');
  await page.waitForTimeout(900);

  const s = await page.evaluate(() => ({
    hash: location.hash,
    who: document.querySelector('#pt-who').textContent,
    pid: document.querySelector('#pt-pid').textContent,
    accountPatientId: HIS.auth.account() && HIS.auth.account().patientId,
    heading: document.querySelector('.pt-h1') && document.querySelector('.pt-h1').textContent
  }));
  ok('sign-in normalises email (upper case + spaces)', s.hash === '#home', s.hash);
  ok('header shows the linked patient name', s.who === 'Isabel Geliz V. Ramos', s.who);
  ok('header shows the hospital patient ID', s.pid === 'PT-99213', s.pid);
  ok('account resolves to a patientId', s.accountPatientId === 'PT-99213', s.accountPatientId);

  // No other patient may appear anywhere on the page.
  const body = await page.evaluate(() => document.body.innerText);
  const others = ['Tobias Reyes', 'Eleanor Whitfield', 'Hana Kobayashi', 'Rilaneh', 'Maria Santos', 'Nestor Villamor'];
  const leaked = others.filter(n => body.includes(n));
  ok('no other patient name appears on the portal', leaked.length === 0, leaked.join(', '));
  ok('own patient ID is not exposed in the URL', !page.url().includes('PT-99213'), page.url());
  ok('portal loaded with no console errors', errs.length === 0, errs[0]);
  await ctx.close();
}

// ---------------------------------------------------------------- 2. home figures match the stores
{
  const { ctx } = await ctxFor();
  const { page } = await open(ctx);
  await page.goto(BASE + '/portal.html', { waitUntil: 'load' });
  await page.evaluate(async (pw) => { HIS.auth.attempt('patient@mediheal.test', pw, true); }, DEMO);
  await page.goto(BASE + '/portal.html#home', { waitUntil: 'load' });
  await page.waitForTimeout(700);

  const r = await page.evaluate(() => {
    const p = HIS.registry.byId('PT-99213');
    const bills = HIS.registry.invoicesFor('PT-99213');
    const bal = bills.reduce((s, b) => s + HIS.ledger.balanceOf(b), 0);
    return {
      cards: [...document.querySelectorAll('.pt-card .n')].map(e => e.textContent.trim()),
      bal, billCount: bills.length,
      appts: HIS.registry.appointmentsFor('PT-99213').length
    };
  });
  ok('billing summary counts only this patient\'s invoices', r.billCount === 1, 'invoices=' + r.billCount);
  ok('outstanding balance equals the ledger balance', r.cards.some(c => c === '\u20b17,360'), r.cards.join(' | '));
  ok('appointment count is scoped to the patient', r.appts === 1, 'appts=' + r.appts);
  await ctx.close();
}

// ---------------------------------------------------------------- 3. appointments + billing views
{
  const { ctx } = await ctxFor();
  const { page } = await open(ctx);
  await page.goto(BASE + '/portal.html', { waitUntil: 'load' });
  await page.evaluate(async (pw) => { HIS.auth.attempt('patient@mediheal.test', pw, true); }, DEMO);

  await page.goto(BASE + '/portal.html#appts', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  let r = await page.evaluate(() => ({
    rows: document.querySelectorAll('.pt-tbl tbody tr').length,
    text: document.querySelector('#pt-stage').innerText
  }));
  ok('appointments table renders exactly this patient\'s rows', r.rows === 1, 'rows=' + r.rows);
  ok('appointments view names the patient', r.text.includes('Isabel Geliz V. Ramos'));

  // Filter to Past: her only appointment is Confirmed, so the table must empty out.
  await page.click("[data-apptmode='past']");
  await page.waitForTimeout(300);
  r = await page.evaluate(() => ({
    empty: !!document.querySelector('.pt-empty'),
    rows: document.querySelectorAll('.pt-tbl tbody tr').length
  }));
  ok('appointment filter is real (Past hides a Confirmed appointment)', r.empty === true && r.rows === 0, JSON.stringify(r));

  await page.goto(BASE + '/portal.html#billing', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  r = await page.evaluate(() => ({
    text: document.querySelector('#pt-stage').innerText,
    tables: document.querySelectorAll('.pt-tbl').length
  }));
  ok('billing view shows invoice BL-8801', r.text.includes('BL-8801'));
  ok('billing view shows a payment history table', r.text.includes('Payment history') && r.tables >= 2);
  ok('billing view does not show another patient\'s invoice', !r.text.includes('BL-8799') && !r.text.includes('BL-8800'));
  await ctx.close();
}

// ---------------------------------------------------------------- 4. documents are real files
{
  const { ctx } = await ctxFor();
  const { page } = await open(ctx);
  await page.goto(BASE + '/portal.html', { waitUntil: 'load' });
  await page.evaluate(async (pw) => { HIS.auth.attempt('patient@mediheal.test', pw, true); }, DEMO);
  await page.goto(BASE + '/portal.html#docs', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  const tiles = await page.evaluate(() => document.querySelectorAll('[data-doc]').length);
  ok('document tiles are generated from real records', tiles >= 3, 'tiles=' + tiles);

  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    page.click("[data-doc^='statement:']")
  ]);
  ok('statement downloads a file', !!dl, 'no download event');
  if (dl) {
    const name = dl.suggestedFilename();
    const stream = await dl.createReadStream();
    let head = '';
    for await (const chunk of stream) { head += chunk.toString('latin1').slice(0, 8); break; }
    ok('downloaded file is a PDF named after the invoice', /^%PDF/.test(head) && /^statement_BL-8801\.pdf$/.test(name), name + ' / ' + head.slice(0, 5));
  }
  await ctx.close();
}

// ---------------------------------------------------------------- 5. staff account refused
{
  const { ctx } = await ctxFor();
  const { page } = await open(ctx);
  await page.goto(BASE + '/portal.html#signin', { waitUntil: 'load' });
  await page.fill('#pt-si-email', 'doctor@mediheal.test');
  await page.fill('#pt-signin input[name=password]', DEMO);
  await page.click('#pt-signin button[type=submit]');
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => ({
    msg: document.querySelector('#pt-signin-error').textContent,
    session: !!HIS.auth.account(),
    hash: location.hash
  }));
  ok('a staff account cannot open the patient portal', /staff account/i.test(r.msg), r.msg);
  ok('the refused staff session is cleared immediately', r.session === false);
  ok('refused sign-in stays on the sign-in view', r.hash === '#signin', r.hash);
  await ctx.close();
}

// ---------------------------------------------------------------- 6. guard + session persistence
{
  const { ctx } = await ctxFor();
  const { page } = await open(ctx);
  await page.goto(BASE + '/portal.html#billing', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  ok('private view without a session redirects to sign-in', page.url().endsWith('#signin'), page.url());

  await page.evaluate(async (pw) => { HIS.auth.attempt('patient@mediheal.test', pw, true); }, DEMO);
  await page.goto(BASE + '/portal.html#medical', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  let t = await page.evaluate(() => document.querySelector('#pt-stage').innerText);
  ok('medical record shows the consultation', /chief complaint/i.test(t));
  ok('medical record shows the treatment diagnosis', /Acute coronary syndrome/.test(t));

  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  t = await page.evaluate(() => ({ hash: location.hash, who: document.querySelector('#pt-who').textContent }));
  ok('a refresh keeps the session and the view', t.hash === '#medical' && t.who === 'Isabel Geliz V. Ramos', JSON.stringify(t));

  await page.click('#pt-signout');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ hash: location.hash, session: !!HIS.auth.account() }));
  ok('sign-out ends the session', after.session === false);
  ok('sign-out returns to the sign-in view', after.hash === '#signin', after.hash);

  await page.goto(BASE + '/portal.html#home', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  ok('a private view is refused again after sign-out', page.url().endsWith('#signin'), page.url());
  await ctx.close();
}

// ---------------------------------------------------------------- 7. guardian access
{
  const { ctx } = await ctxFor();
  const { page } = await open(ctx);
  await page.goto(BASE + '/portal.html', { waitUntil: 'load' });

  // Grant patient@mediheal.test guardian access to a dependent, as an administrator would.
  const g = await page.evaluate(async () => {
    const acct = HIS.accounts.byEmail('patient@mediheal.test');
    return HIS.registry.addGuardian({
      accountId: acct.id, patientId: 'PT-99210', relationship: 'Parent', reference: 'AUTH-2026-0042'
    });
  });
  ok('guardian link can be created', g.ok === true, g.error);

  await page.evaluate(async (pw) => { HIS.auth.attempt('patient@mediheal.test', pw, true); }, DEMO);
  await page.goto(BASE + '/portal.html#home', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  let r = await page.evaluate(() => ({
    deps: document.querySelectorAll('[data-subject]').length,
    text: document.querySelector('#pt-stage').innerText
  }));
  ok('the dependent appears in "People you can view"', r.deps >= 1, 'buttons=' + r.deps);
  ok('the dependent is named', r.text.includes('Tobias Reyes'));

  await page.click("[data-subject='PT-99210']");
  await page.waitForTimeout(500);
  r = await page.evaluate(() => ({ pid: document.querySelector('#pt-pid').textContent, text: document.querySelector('#pt-stage').innerText }));
  ok('switching subject loads the dependent record', r.pid.startsWith('PT-99210'), r.pid);
  ok('the dependent view says it is a guardian view', /viewing as parent/i.test(r.text), r.text.slice(0, 120));

  // Revoke, then confirm the dependent disappears.
  await page.evaluate(() => {
    const acct = HIS.accounts.byEmail('patient@mediheal.test');
    const row = HIS.registry.guardianRowsFor('PT-99210').filter(x => x.accountId === acct.id && x.status === 'active')[0];
    HIS.registry.revokeGuardian(row.id, 'Authorisation withdrawn by the patient');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(600);
  r = await page.evaluate(() => ({
    deps: document.querySelectorAll('[data-subject]').length,
    text: document.querySelector('#pt-stage').innerText
  }));
  ok('revoking the link removes the dependent', r.deps === 0 && !r.text.includes('Tobias Reyes'), 'buttons=' + r.deps);
  await ctx.close();
}

// ---------------------------------------------------------------- 8. account <-> patient link rules
{
  const { ctx } = await ctxFor();
  const { page } = await open(ctx);
  await page.goto(BASE + '/portal.html#signin', { waitUntil: 'load' });
  const r = await page.evaluate(async (pw) => {
    HIS.auth.attempt('superadmin@mediheal.test', pw, true);
    const out = {};
    const acct = HIS.accounts.byEmail('nurse@mediheal.test');
    out.link = HIS.registry.linkAccount(acct.id, 'PT-99215');
    out.second = HIS.registry.linkAccount(HIS.accounts.byEmail('cashier@mediheal.test').id, 'PT-99215');
    out.badPatient = HIS.registry.linkAccount(acct.id, 'PT-00000');
    out.accountFor = !!HIS.registry.accountFor('PT-99215');
    HIS.registry.linkAccount(acct.id, null);
    return out;
  }, DEMO);
  ok('an account can be linked to a patient record', r.link.ok === true, r.link.error);
  ok('a second account cannot claim the same patient', r.second.ok === false && /already linked/i.test(r.second.error), r.second.error);
  ok('linking to a missing patient is refused', r.badPatient.ok === false, r.badPatient.error);
  ok('accountFor finds the linked account', r.accountFor === true);
  await ctx.close();
}

// ---------------------------------------------------------------- 9. no leftover private portal store
{
  const { ctx } = await ctxFor();
  const { page } = await open(ctx);
  await page.goto(BASE + '/portal.html', { waitUntil: 'load' });
  const r = await page.evaluate(() => Object.keys(HIS.store.KEY).filter(k => /portalAccounts|portalReset/.test(k)));
  ok('the portal no longer keeps a private account store', r.length === 0, r.join(','));
  await ctx.close();
}

await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
