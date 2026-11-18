// M10 ledger harness.
//
// The ledger is the single record of money moving. These tests exercise the write paths that can
// break it — a double-submitted payment, a refund larger than what was received, coverage recorded
// as cash — and then assert the accounting identity holds to the centavo.
//
// The identity under test, per invoice:
//     charge = collected (payments - refunds) + covered (coverage/discount/adjustment) + outstanding
//
// Usage: PW=<playwright-core> node scripts/ledger-check.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
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
await new Promise(r => server.listen(8855, r));
const BASE = 'http://127.0.0.1:8855';

const spec = process.env.PW || 'playwright-core';
const mod = await import(spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) ? pathToFileURL(spec).href : spec);
const chromium = mod.chromium || (mod.default && mod.default.chromium);
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail !== undefined ? '  \u2192 ' + detail : '')); }
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.evaluate(() => HIS.auth.attempt('cashier@mediheal.test', 'MediHeal2026!', true));
await page.goto(BASE + '/billing.html', { waitUntil: 'load' });
await page.waitForTimeout(400);

// ---------------------------------------------------------------- 1. the seed is coherent
{
  const r = await page.evaluate(() => {
    const bills = HIS.billing.bills;
    const seeded = HIS.ledger.all().filter(t => t.seeded);
    return {
      bills: bills.length,
      seeded: seeded.length,
      // The migration must reproduce each invoice's old `paid` figure exactly.
      matches: bills.map(b => {
        const sum = seeded.filter(t => t.invoiceId === b.id).reduce((a, t) => a + t.amount, 0) / 100;
        // An invoice declares its opening money either as `paid` or as status Paid for the full amount.
        const expected = b.paid != null ? b.paid : (b.status === 'Paid' ? b.amount : 0);
        return { id: b.id, expected, got: sum };
      }),
      inv: HIS.ledger.invariants()
    };
  });
  ok('every invoice with a paid figure has an opening transaction',
    r.matches.every(m => near(m.expected, m.got)), JSON.stringify(r.matches));
  ok('the seeded ledger satisfies every invariant', r.inv.length === 0, JSON.stringify(r.inv));
}

// ---------------------------------------------------------------- 2. payments
{
  const r = await page.evaluate(() => {
    const bill = HIS.billing.bills.filter(b => b.id === 'BL-8798')[0];
    const start = HIS.ledger.balanceOf(bill);
    const over = HIS.ledger.recordPayment({ invoiceId: bill.id, amount: start + 1, method: 'Cash' });
    const part = HIS.ledger.recordPayment({ invoiceId: bill.id, amount: 1000, method: 'Cash' });
    const afterPart = HIS.ledger.balanceOf(bill);
    const statusPart = HIS.ledger.statusOf(bill);
    const zero = HIS.ledger.recordPayment({ invoiceId: bill.id, amount: 0, method: 'Cash' });
    const badMethod = HIS.ledger.recordPayment({ invoiceId: bill.id, amount: 10, method: 'Bitcoin' });
    return {
      start, over: over.ok, overErr: over.error, part: part.ok, afterPart, statusPart,
      zero: zero.ok, badMethod: badMethod.ok, inv: HIS.ledger.invariants()
    };
  });
  ok('a payment larger than the balance is refused', r.over === false, r.overErr);
  ok('a partial payment is accepted', r.part === true);
  ok('the balance falls by exactly the payment', near(r.start - r.afterPart, 1000), r.start + ' -> ' + r.afterPart);
  ok('a part-paid invoice reports Partial', r.statusPart === 'Partial', r.statusPart);
  ok('a zero payment is refused', r.zero === false);
  ok('an unknown payment method is refused', r.badMethod === false);
  ok('payments leave the invariants intact', r.inv.length === 0, JSON.stringify(r.inv));
}

// ---------------------------------------------------------------- 3. duplicate protection
{
  const r = await page.evaluate(() => {
    const bill = HIS.billing.bills.filter(b => b.id === 'BL-8798')[0];
    const before = HIS.ledger.all().length;
    const a = HIS.ledger.recordPayment({ invoiceId: bill.id, amount: 500, method: 'Cash', idempotencyKey: 'FORM-1' });
    const b = HIS.ledger.recordPayment({ invoiceId: bill.id, amount: 500, method: 'Cash', idempotencyKey: 'FORM-1' });
    const after = HIS.ledger.all().length;
    // Coverage is idempotent by source id: a re-settled claim must not credit twice.
    const c1 = HIS.ledger.recordCoverage({ invoiceId: bill.id, kind: 'coverage', amount: 300, payer: 'PhilHealth', reference: 'C1', sourceId: 'SRC-1' });
    const c2 = HIS.ledger.recordCoverage({ invoiceId: bill.id, kind: 'coverage', amount: 300, payer: 'PhilHealth', reference: 'C1', sourceId: 'SRC-1' });
    const afterC = HIS.ledger.all().length;
    return {
      before, after, c1: c1.ok, c2: c2.ok, c2dup: c2.duplicate === true,
      sameTx: a.transaction && b.transaction && a.transaction.id === b.transaction.id,
      afterC, coverageRows: HIS.ledger.all().filter(t => t.sourceId === 'SRC-1').length,
      inv: HIS.ledger.invariants()
    };
  });
  ok('a repeated idempotency key posts one transaction', r.after === r.before + 1, r.before + ' -> ' + r.after);
  ok('the retry returns the original transaction', r.sameTx === true);
  ok('a repeated source id posts one coverage row', r.coverageRows === 1, r.coverageRows);
  ok('the duplicate coverage call reports itself as a duplicate', r.c2dup === true);
  ok('idempotent writes leave the invariants intact', r.inv.length === 0, JSON.stringify(r.inv));
}

// ---------------------------------------------------------------- 4. refunds
{
  const r = await page.evaluate(() => {
    const bill = HIS.billing.bills.filter(b => b.id === 'BL-8800')[0];   // fully paid at seed
    const paid = HIS.ledger.paidOf(bill);
    const tooMuch = HIS.ledger.refund({ invoiceId: bill.id, amount: paid + 1, method: 'Cash' });
    const okRefund = HIS.ledger.refund({ invoiceId: bill.id, amount: 200, method: 'Cash' });
    const after = HIS.ledger.paidOf(bill);
    const status = HIS.ledger.statusOf(bill);
    const second = HIS.ledger.refund({ invoiceId: bill.id, amount: paid, method: 'Cash' });
    return {
      paid, tooMuch: tooMuch.ok, tooMuchErr: tooMuch.error, okRefund: okRefund.ok,
      after, status, second: second.ok, secondErr: second.error, inv: HIS.ledger.invariants()
    };
  });
  ok('a refund larger than the amount received is refused', r.tooMuch === false, r.tooMuchErr);
  ok('a valid refund is accepted', r.okRefund === true);
  ok('a refund reduces collected by exactly its amount', near(r.paid - r.after, 200), r.paid + ' -> ' + r.after);
  ok('a refund reopens the invoice', r.status !== 'Paid', r.status);
  ok('a second refund cannot exceed what remains', r.second === false, r.secondErr);
  ok('refunds leave the invariants intact', r.inv.length === 0, JSON.stringify(r.inv));
}

// ---------------------------------------------------------------- 5. coverage is not cash
{
  const r = await page.evaluate(() => {
    const before = HIS.ledger.reconcile();
    const bill = HIS.billing.bills.filter(b => b.id === 'BL-8798')[0];
    const balBefore = HIS.ledger.balanceOf(bill);
    const cov = HIS.ledger.recordCoverage({
      invoiceId: bill.id, kind: 'coverage', amount: 2500,
      payer: 'PhilHealth', reference: 'PH-TEST', sourceId: 'COV-2'
    });
    const disc = HIS.ledger.recordCoverage({
      invoiceId: bill.id, kind: 'discount', amount: 500,
      payer: 'Senior citizen', reference: 'SC-1', sourceId: 'DISC-1'
    });
    const noRef = HIS.ledger.recordCoverage({ invoiceId: bill.id, kind: 'coverage', amount: 10, payer: 'X', reference: '' });
    const noPayer = HIS.ledger.recordCoverage({ invoiceId: bill.id, kind: 'coverage', amount: 10, payer: '', reference: 'R' });
    const after = HIS.ledger.reconcile();
    return {
      cov: cov.ok, disc: disc.ok, noRef: noRef.ok, noPayer: noPayer.ok,
      balBefore, balAfter: HIS.ledger.balanceOf(bill),
      collectedBefore: before.collected, collectedAfter: after.collected,
      coveredBefore: before.covered, coveredAfter: after.covered,
      methodSum: after.methodSum, inv: HIS.ledger.invariants()
    };
  });
  ok('coverage is accepted with a payer and a reference', r.cov === true);
  ok('a discount is accepted as its own kind', r.disc === true);
  ok('coverage without a reference is refused', r.noRef === false);
  ok('coverage without a payer is refused', r.noPayer === false);
  ok('coverage and discounts reduce the balance by their total', near(r.balBefore - r.balAfter, 3000), r.balBefore + ' -> ' + r.balAfter);
  ok('coverage does not change collections', near(r.collectedBefore, r.collectedAfter), r.collectedBefore + ' vs ' + r.collectedAfter);
  ok('coverage increases the covered figure', near(r.coveredAfter - r.coveredBefore, 3000), r.coveredAfter - r.coveredBefore);
  ok('the payment-method total still equals collections only', near(r.methodSum, r.collectedAfter), r.methodSum + ' vs ' + r.collectedAfter);
  ok('coverage leaves the invariants intact', r.inv.length === 0, JSON.stringify(r.inv));
}

// ---------------------------------------------------------------- 6. electronic intents are not money
{
  const r = await page.evaluate(() => {
    const bill = HIS.billing.bills.filter(b => b.id === 'BL-8798')[0];
    const before = HIS.ledger.balanceOf(bill);
    const noRef = HIS.ledger.recordPayment({ invoiceId: bill.id, amount: 100, method: 'GCash' });
    const pend = HIS.ledger.recordPayment({ invoiceId: bill.id, amount: 100, method: 'GCash', reference: 'GC-1' });
    const midBalance = HIS.ledger.balanceOf(bill);
    const pendingRows = HIS.ledger.pendingOf(bill).length;
    const conf = pend.ok ? HIS.ledger.confirm(pend.transaction.id) : { ok: false };
    const afterConfirm = HIS.ledger.balanceOf(bill);
    return {
      before, noRef: noRef.ok, pend: pend.ok, midBalance, pendingRows, conf: conf.ok, afterConfirm,
      inv: HIS.ledger.invariants()
    };
  });
  ok('an electronic payment without a reference is refused', r.noRef === false);
  ok('an electronic payment is recorded as pending', r.pend === true && r.pendingRows === 1);
  ok('a pending payment does not move the balance', near(r.before, r.midBalance), r.before + ' -> ' + r.midBalance);
  ok('confirming it settles the money', near(r.midBalance - r.afterConfirm, 100), r.midBalance + ' -> ' + r.afterConfirm);
  ok('pending then confirmed leaves the invariants intact', r.inv.length === 0, JSON.stringify(r.inv));
}

// ---------------------------------------------------------------- 7. voiding
{
  const r = await page.evaluate(() => {
    const bill = HIS.billing.bills.filter(b => b.id === 'BL-8798')[0];   // still open at this point
    const before = HIS.ledger.balanceOf(bill);
    const pay = HIS.ledger.recordPayment({ invoiceId: bill.id, amount: 400, method: 'Cash' });
    const mid = HIS.ledger.balanceOf(bill);
    const v = HIS.ledger.void(pay.transaction.id, 'wrong invoice');
    const after = HIS.ledger.balanceOf(bill);
    const twice = HIS.ledger.void(pay.transaction.id, 'again');
    return { before, mid, after, v: v.ok, twice: twice.ok, inv: HIS.ledger.invariants() };
  });
  ok('a payment reduces the balance', near(r.before - r.mid, 400), r.before + ' -> ' + r.mid);
  ok('voiding restores the balance exactly', near(r.after, r.before), r.after + ' vs ' + r.before);
  ok('voiding twice is refused', r.twice === false);
  ok('voiding leaves the invariants intact', r.inv.length === 0, JSON.stringify(r.inv));
}

// ---------------------------------------------------------------- 8. the identity, to the centavo
{
  const r = await page.evaluate(() => {
    const rows = HIS.billing.bills.map(b => {
      const s = HIS.ledger.sums(b.id);
      return {
        id: b.id, charge: b.amount, collected: s.net / 100, covered: s.covered / 100,
        outstanding: HIS.ledger.balanceOf(b),
        identity: Math.round(b.amount * 100) - s.net - s.covered - Math.round(HIS.ledger.balanceOf(b) * 100)
      };
    });
    const rec = HIS.ledger.reconcile();
    return { rows, rec, inv: HIS.ledger.invariants() };
  });
  ok('every invoice satisfies charge = collected + covered + outstanding',
    r.rows.every(x => x.identity === 0), JSON.stringify(r.rows.filter(x => x.identity !== 0)));
  ok('no invoice has a negative balance', r.rows.every(x => x.outstanding >= 0), JSON.stringify(r.rows));
  ok('totals() agrees with the per-invoice sums', r.rec.totalsMatch === true);
  ok('the payment-method breakdown equals collections', r.rec.methodMatchesCollected === true);
  ok('no invariant is broken at the end of the run', r.inv.length === 0, JSON.stringify(r.inv));
}

// ---------------------------------------------------------------- 9. other screens agree
{
  await page.evaluate(() => { HIS.auth.clear(); HIS.auth.attempt('finance@mediheal.test', 'MediHeal2026!', true); });
  await page.goto(BASE + '/reports.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const kpis = [...document.querySelectorAll('.ad-kpi .v')].map(n => n.textContent.trim());
    const num = s => Number(String(s).replace(/[^\d.]/g, ''));
    return { kpis, rec: HIS.ledger.reconcile() };
  });
  ok('Reports renders the ledger outstanding figure',
    near(r.kpis[2].replace(/[^\d.]/g, ''), Math.round(r.rec.outstanding)), r.kpis[2] + ' vs ' + r.rec.outstanding);
  ok('Reports renders the ledger collected figure',
    near(r.kpis[1].replace(/[^\d.]/g, ''), Math.round(r.rec.collected)), r.kpis[1] + ' vs ' + r.rec.collected);
}

ok('ledger checks ran with no console errors', errs.length === 0, errs[0]);

await ctx.close();
await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
