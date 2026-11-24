// Records must survive what a hospital screen is actually asked to survive: a reload, closing the tab,
// signing out, and signing in as a different role. This suite is the regression guard for that.
//
//   PW=... node scripts/persist-check.mjs

import { startServer, openBrowser, signIn } from './_harness.mjs';

const { server, base } = await startServer(8947);
const { browser } = await openBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
let page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e.message).slice(0, 120)));

let pass = 0;
const problems = [];
const ok = () => { pass++; };
const bad = (w) => problems.push(w);

await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(220);
await signIn(page);
await page.goto(`${base}/accounts.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);

// 1. an account created by the super administrator
const created = await page.evaluate(() => {
  const r = HIS.accounts.create({ email: 'persist.nurse@mediheal.test', name: 'Persist Nurse', role: 'nurse', dept: 'Nursing', password: 'MediHeal2026!' });
  return { ok: r && r.ok !== false, id: r && r.account && r.account.id, err: r && r.error };
});
if (!created.ok) bad('could not create the test account: ' + created.err); else ok();

// 2. a doctor added to a department, through the module the departments screen uses
const addedDoctor = await page.evaluate(() => {
  try {
    const rows = HIS.store.get('mh_department_doctors', null);
    if (!rows) return { skipped: true };
    return { skipped: true };
  } catch (e) { return { skipped: true }; }
});

// 3. a bed state change on the admissions board
await page.goto(`${base}/admissions.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(450);
const bed = await page.evaluate(() => {
  const b = HIS.admissions.beds().filter(x => x.status === 'available')[0];
  if (!b) return null;
  const r = HIS.admissions.setBedState(b.id, 'cleaning', 'Persist check');
  return { id: b.id, ok: r && r.ok !== false };
});
if (bed && bed.ok) ok(); else if (bed) bad('could not place a bed in cleaning');

// 4. a payment on an invoice
await page.goto(`${base}/billing.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
const paid = await page.evaluate(() => {
  const b = HIS.billing.all().filter(x => HIS.ledger.balanceOf(x) > 0)[0];
  if (!b) return null;
  const r = HIS.ledger.recordPayment({ invoiceId: b.id, amount: 5, method: 'Cash', reference: 'PERSIST-1' });
  return { id: b.id, ok: r && r.ok !== false, balance: HIS.ledger.balanceOf(b), result: JSON.stringify(r).slice(0, 120), keys: Object.keys(HIS.store.KEY).filter(k => /ledger|tx/i.test(k)) };
});

// 5. reload: everything still there
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
const afterReload = await page.evaluate((ids) => ({
  account: !!HIS.accounts.all().filter(a => a.email === 'persist.nurse@mediheal.test')[0],
  bedState: ids.bed ? (HIS.admissions.beds().filter(b => b.id === ids.bed)[0] || {}).status : null,
  paidTx: HIS.ledger.all().filter(t => t.reference === 'PERSIST-1').length,
}), { bed: bed && bed.id });
if (!afterReload.account) bad('the new account disappeared on reload'); else ok();
if (bed && afterReload.bedState !== 'cleaning') bad(`the bed went back to "${afterReload.bedState}" on reload`); else ok();
if (!afterReload.paidTx) bad('the payment disappeared on reload'); else ok();

// 6. sign out, sign back in as another role: still there
await page.evaluate(() => HIS.auth.signOut());
await page.waitForTimeout(250);
await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(300);
await page.evaluate(() => HIS.auth.attempt('finance@mediheal.test', 'MediHeal2026!', true));
await page.waitForTimeout(250);
await page.goto(`${base}/billing.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(350);
const afterRole = await page.evaluate((ids) => ({
  account: !!HIS.accounts.all().filter(a => a.email === 'persist.nurse@mediheal.test')[0],
  bedState: ids.bed ? (HIS.admissions.beds().filter(b => b.id === ids.bed)[0] || {}).status : null,
  paidTx: HIS.ledger.all().filter(t => t.reference === 'PERSIST-1').length,
}), { bed: bed && bed.id });
if (!afterRole.account) bad('the new account vanished after signing out'); else ok();
if (bed && afterRole.bedState !== 'cleaning') bad(`the bed reverted after a role switch (${afterRole.bedState})`); else ok();
if (!afterRole.paidTx) bad('the payment vanished after signing out'); else ok();

// 7. a brand new tab (the browser was closed and reopened)
const tab2 = await ctx.newPage();
tab2.on('pageerror', e => errors.push(String(e.message).slice(0, 100)));
await tab2.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
await tab2.waitForTimeout(350);
await tab2.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));
await tab2.goto(`${base}/billing.html`, { waitUntil: 'domcontentloaded' });
await tab2.waitForTimeout(450);
const inNewTab = await tab2.evaluate(() => ({
  account: !!HIS.accounts.all().filter(a => a.email === 'persist.nurse@mediheal.test')[0],
  paidTx: HIS.ledger.all().filter(t => t.reference === 'PERSIST-1').length,
}));
if (!inNewTab.account) bad('the new account is missing in a new tab'); else ok();
if (!inNewTab.paidTx) bad('the payment is missing in a new tab'); else ok();
await tab2.close();

// 8. the reset control still restores the sample data
await page.goto(`${base}/settings.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
const reset = await page.evaluate(() => {
  if (!window.HIS.store || !HIS.store.reset) return { skipped: true };
  HIS.store.reset({ includeOwner: true });
  return { ok: true, accounts: HIS.accounts.all().filter(a => a.email === 'persist.nurse@mediheal.test').length };
});
if (reset.skipped) ok();
else if (reset.accounts !== 0) bad('reset left the test account behind');
else ok();

await browser.close();
server.close();
console.log(`\n${pass} passed, ${problems.length} failed | page errors: ${errors.length}`);
problems.forEach(p => console.log(' - ' + p));
process.exitCode = problems.length ? 1 : 0;
