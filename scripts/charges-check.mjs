// M11 — charge capture audit.
//
// The gap this covers: clinical work never reached an invoice. A laboratory order or a dispensed drug
// was recorded but nothing became billable, so the invoice total was a number written by hand.
//
// These tests drive the real pages in one session: order a test on Laboratory, dispense on Pharmacy,
// then read the invoice on Billing. That is the only way to prove the workflow connects.
//
// Usage: PW=<playwright-core> node scripts/charges-check.mjs
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
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
await new Promise(r => server.listen(8861, r));
const BASE = 'http://127.0.0.1:8861';

const spec = process.env.PW || 'playwright-core';
const mod = await import(spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) ? pathToFileURL(spec).href : spec);
const chromium = mod.chromium || (mod.default && mod.default.chromium);
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; failures.push({ name, detail: detail === undefined ? null : String(detail) }); console.log('FAIL ' + name + (detail !== undefined ? '  \u2192 ' + detail : '')); }
};
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) < (tol == null ? 0.011 : tol);

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));
// 2026-11-22: the charge store now seeds itself from the invoice lines, so a run that assumes it
// starts empty has to clear it first. This harness tests the workflow, not the seed.
await page.goto(BASE + '/charges.html', { waitUntil: 'load' });
await page.evaluate(() => HIS.store.set('mh_charges', { charges: [], version: 2 }));

// =================================================================================================
// 1. A LABORATORY ORDER BECOMES A CHARGE
// =================================================================================================
console.log('\n--- 1. laboratory order ---');
{
  await page.goto(BASE + '/laboratory.html', { waitUntil: 'load' });
  await page.waitForTimeout(300);

  const r = await page.evaluate(() => {
    const bill = HIS.billing.bills.filter(b => b.id === 'BL-8801')[0];
    const before = { total: HIS.ledger.invoiceAmount(bill), balance: HIS.ledger.balanceOf(bill), charges: HIS.charges.all().length };
    const order = HIS.lab.create({ patientId: 'PT-99213', test: 'CBC with platelet count', priority: 'Routine' });
    const after = { total: HIS.ledger.invoiceAmount(bill), balance: HIS.ledger.balanceOf(bill), charges: HIS.charges.all().length };
    const charge = HIS.charges.forInvoice('BL-8801').filter(c => c.status !== 'void')[0];
    return { before, after, order: order.order, charge, paid: HIS.ledger.paidOf(bill), price: HIS.lab.CATALOG['CBC with platelet count'].price };
  });

  ok('the laboratory page raises a charge with the order', r.order.billing === 'charged', r.order.billing);
  ok('the charge is priced from the catalogue tariff', near(r.charge.amount, r.price) && near(r.price, 350), r.charge.amount);
  ok('the charge names its source', r.charge.source === 'laboratory' && r.charge.sourceLabel === 'Laboratory', r.charge.sourceLabel);
  ok('the invoice total rises by exactly the charge', near(r.after.total - r.before.total, 350), r.after.total - r.before.total);
  ok('the balance owed rises by exactly the charge', near(r.after.balance - r.before.balance, 350), r.after.balance - r.before.balance);
  ok('the charge is not money: collected is unchanged', near(r.paid, 10000), r.paid);
}

// 1b. duplicate protection
{
  const r = await page.evaluate(() => {
    const order = HIS.lab.all().filter(o => o.patientId === 'PT-99213').slice(-1)[0];
    const before = HIS.charges.all().length;
    const again = HIS.charges.add({
      patientId: 'PT-99213', source: 'laboratory', sourceId: order.id,
      code: order.test, description: 'duplicate attempt', qty: 1, unitPrice: 350
    });
    return { before, after: HIS.charges.all().length, dup: again.duplicate === true, ok: again.ok };
  });
  ok('re-raising the same event returns the original charge', r.ok === true && r.dup === true);
  ok('and adds no second row', r.after === r.before, r.before + ' -> ' + r.after);
}

// =================================================================================================
// 2. A DISPENSE BECOMES A CHARGE
// =================================================================================================
console.log('\n--- 2. pharmacy dispense ---');
{
  await page.goto(BASE + '/pharmacy.html', { waitUntil: 'load' });
  await page.waitForTimeout(300);

  const r = await page.evaluate(() => {
    const bill = HIS.billing.bills.filter(b => b.id === 'BL-8801')[0];
    const before = { total: HIS.ledger.invoiceAmount(bill), balance: HIS.ledger.balanceOf(bill), charges: HIS.charges.all().length };
    const rx = HIS.pharmacy.rxById('RX-0001');
    const batch = HIS.pharmacy.stock().filter(b => b.drug === rx.drug && b.qty > 0 && !HIS.pharmacy.isExpired(b))[0];
    HIS.pharmacy.verify('RX-0001'); // Verification is required before stock may leave the shelf.
    const res = HIS.pharmacy.dispense('RX-0001', { batchId: batch.id, qty: 10 });
    const after = { total: HIS.ledger.invoiceAmount(bill), balance: HIS.ledger.balanceOf(bill), charges: HIS.charges.all().length };
    const charge = HIS.charges.all().slice(-1)[0];
    return { before, after, ok: res.ok, err: res.error, charge, price: batch.price, batch: batch.batch };
  });

  ok('dispensing succeeds', r.ok === true, r.err);
  ok('a charge is raised for the quantity dispensed', near(r.charge.amount, 10 * r.price), r.charge.amount + ' at ' + r.price);
  ok('the charge names the pharmacy as its source', r.charge.source === 'pharmacy', r.charge.source);
  ok('the invoice total rises by the dispensed value', near(r.after.total - r.before.total, 10 * r.price), r.after.total - r.before.total);
  ok('the balance rises by the same amount', near(r.after.balance - r.before.balance, 10 * r.price), r.after.balance - r.before.balance);
  ok('one charge row was added', r.after.charges === r.before.charges + 1, r.after.charges - r.before.charges);
}

// 2b. a partial dispense charges only what left the shelf
{
  const r = await page.evaluate(() => {
    const rx = HIS.pharmacy.rxById('RX-0002');
    const batch = HIS.pharmacy.stock().filter(b => b.drug === rx.drug && b.qty > 5 && !HIS.pharmacy.isExpired(b))[0];
    const before = HIS.charges.all().length;
    HIS.pharmacy.verify('RX-0002'); // Verification is required before stock may leave the shelf.
    const res = HIS.pharmacy.dispense('RX-0002', { batchId: batch.id, qty: 5 });
    const charge = HIS.charges.all().slice(-1)[0];
    return { ok: res.ok, err: res.error, before, after: HIS.charges.all().length, qty: charge.qty, amount: charge.amount, price: batch.price, remaining: res.remaining };
  });
  ok('a partial dispense succeeds', r.ok === true, r.err);
  ok('it charges only the quantity dispensed', r.qty === 5 && near(r.amount, 5 * r.price), r.qty + ' / ' + r.amount);
  ok('the prescription remains partly open', r.remaining > 0, r.remaining);
}

// =================================================================================================
// 3. NO INVOICE ON THE EPISODE — THE CHARGE IS STILL RECORDED, IN THE UNBILLED QUEUE
// =================================================================================================
// M12 CHANGED THE RULE THIS SECTION ASSERTS. M11 discarded a charge when the patient had no open
// invoice, which lost the revenue and made a performed service invisible. The brief for M12 is
// explicit: "Every valid billable service must produce a persistent charge record even when there is
// no invoice." The assertions below therefore check the stronger rule, not a weaker one.
console.log('\n--- 3. no invoice on the episode ---');
await page.goto(BASE + '/laboratory.html', { waitUntil: 'load' });
await page.waitForTimeout(300);
{
  const r = await page.evaluate(() => {
    // PT-99215's only invoice (BL-8800) is fully paid and its episode is closed.
    const before = {
      charges: HIS.charges.all().length,
      unbilled: HIS.charges.unbilled().length,
      billed: HIS.ledger.totals().billed
    };
    const order = HIS.lab.create({ patientId: 'PT-99215', test: 'Hemoglobin', priority: 'Routine' });
    const charge = HIS.charges.byId(order.order.chargeId);
    return {
      ok: order.ok, billing: order.order.billing, before,
      after: { charges: HIS.charges.all().length, unbilled: HIS.charges.unbilled().length, billed: HIS.ledger.totals().billed },
      charge: charge && { id: charge.id, amount: charge.amount, invoiceId: charge.invoiceId, status: charge.billingStatus, reason: charge.unbilledReason, encounterId: charge.encounterId },
      enc: order.order.encounterId
    };
  });
  ok('the order is still created', r.ok === true);
  ok('a charge is still recorded when no invoice exists', r.after.charges === r.before.charges + 1, r.before.charges + ' -> ' + r.after.charges);
  ok('the charge is marked unbilled rather than attached to an unrelated invoice',
    r.charge && r.charge.invoiceId === null && r.charge.status === 'unbilled', r.charge && r.charge.status);
  ok('the charge names the encounter it happened in', r.charge && r.charge.encounterId === r.enc, r.charge && r.charge.encounterId);
  ok('the charge records why it is unbilled', r.charge && /no invoice/i.test(r.charge.reason || ''), r.charge && r.charge.reason);
  ok('no invoice total moved', near(r.after.billed, r.before.billed), r.after.billed - r.before.billed);
  ok('it appears in the unbilled queue', r.after.unbilled === r.before.unbilled + 1, r.after.unbilled);
  ok('the order reports itself as unbilled, not billed', r.billing === 'unbilled', r.billing);
}

// =================================================================================================
// 4. THE BILLING SCREEN SHOWS IT
// =================================================================================================
console.log('\n--- 4. billing screen ---');
{
  await page.goto(BASE + '/billing.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const bill = HIS.billing.bills.filter(b => b.id === 'BL-8801')[0];
    const row = document.querySelector(".bl-row[data-id='BL-8801'] .am");
    document.querySelector(".bl-row[data-id='BL-8801']").click();
    const detail = document.getElementById('blinv').innerText;
    return {
      total: HIS.ledger.invoiceAmount(bill),
      rowText: row ? row.textContent : null,
      detail,
      chargeCount: HIS.charges.forInvoice('BL-8801').filter(c => c.status !== 'void').length
    };
  });
  const money = n => '\u20b1' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  ok('the invoice row shows the charge-inclusive total', r.rowText && r.rowText.indexOf(money(r.total)) > -1, r.rowText + ' vs ' + money(r.total));
  ok('the detail lists the laboratory charge', /CBC with platelet count/.test(r.detail), r.detail.slice(0, 120));
  ok('the detail lists the pharmacy charge', /Aspirin/.test(r.detail));
  ok('the detail totals the charges separately', /Charges raised/.test(r.detail));
  // Laboratory CBC, plus two pharmacy dispenses on the same patient's invoice.
  ok('three charges are on the invoice', r.chargeCount === 3, r.chargeCount);
}

// =================================================================================================
// 5. VOIDING A CHARGE
// =================================================================================================
console.log('\n--- 5. void ---');
{
  const r = await page.evaluate(() => {
    const bill = HIS.billing.bills.filter(b => b.id === 'BL-8801')[0];
    const charge = HIS.charges.forInvoice('BL-8801').filter(c => c.status !== 'void')[0];
    const before = HIS.ledger.invoiceAmount(bill);
    const noReason = HIS.charges.void(charge.id, '');
    const done = HIS.charges.void(charge.id, 'Ordered in error');
    const after = HIS.ledger.invoiceAmount(bill);
    const twice = HIS.charges.void(charge.id, 'again');
    return { before, after, noReason: noReason.ok, done: done.ok, twice: twice.ok, amount: charge.amount,
      inv: HIS.ledger.invariants(), status: HIS.charges.all().filter(c => c.id === charge.id)[0].status };
  });
  ok('voiding without a reason is refused', r.noReason === false);
  ok('voiding with a reason succeeds', r.done === true && r.status === 'void', r.status);
  ok('the invoice total falls by the voided amount', near(r.before - r.after, r.amount), r.before + ' -> ' + r.after);
  ok('voiding twice is refused', r.twice === false);
  ok('the ledger invariants still hold', r.inv.length === 0, JSON.stringify(r.inv));
}

// =================================================================================================
// 6. LEDGER INTEGRITY WITH CHARGES
// =================================================================================================
console.log('\n--- 6. ledger integrity ---');
{
  const r = await page.evaluate(() => {
    const rows = HIS.billing.bills.map(b => ({
      id: b.id, total: HIS.ledger.invoiceAmount(b),
      identity: Math.round(HIS.ledger.invoiceAmount(b) * 100) - HIS.ledger.sums(b.id).net - HIS.ledger.sums(b.id).covered - Math.round(HIS.ledger.balanceOf(b) * 100)
    }));
    const rec = HIS.ledger.reconcile();
    return { rows, rec, inv: HIS.ledger.invariants(), stats: HIS.charges.stats(), crec: HIS.charges.reconcile() };
  });
  ok('every invoice still satisfies total = collected + covered + outstanding',
    r.rows.every(x => x.identity === 0), JSON.stringify(r.rows.filter(x => x.identity !== 0)));
  ok('the ledger totals include the charges in billed', near(r.rec.billed, r.rows.reduce((t, x) => t + x.total, 0)),
    r.rec.billed);
  ok('collections are unaffected by charges', r.rec.collected === 100700, r.rec.collected);
  ok('no invariant is broken', r.inv.length === 0, JSON.stringify(r.inv));
  // Two pharmacy dispenses plus one laboratory order are assigned; the third laboratory order has no
  // invoice on its episode, so it is in the queue and not on any bill.
  ok('the charge stats separate billed from unbilled',
    r.stats.charges === 3 && near(r.stats.total, 280) && r.stats.voided === 1 &&
    r.stats.unbilledCount === 1 && near(r.stats.unbilledTotal, 180),
    JSON.stringify(r.stats));
  ok('the charge ledger reconciles against the invoices', r.crec.problems.length === 0, JSON.stringify(r.crec.problems));
  ok('every active charge names an encounter', r.crec.withoutEncounter === 0, r.crec.withoutEncounter);
}

// =================================================================================================
// 7. IDS
// =================================================================================================
{
  const r = await page.evaluate(() => {
    const ids = HIS.charges.all().map(c => c.id);
    return { ids, unique: new Set(ids).size === ids.length, short: ids.every(i => i.length <= 7) };
  });
  ok('charge ids are unique and sequential', r.unique && r.short, r.ids.join(','));
}

ok('the workflow ran with no console errors', errs.length === 0, errs[0]);

await mkdir(path.join(ROOT, 'qa', 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'qa', 'audit', 'm11.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, failures }, null, 2));

await ctx.close();
await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
