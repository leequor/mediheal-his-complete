// M7 harness: one money chain.
//
// The claim being tested is not "the numbers look right" but "no two screens can disagree".
// Every figure is recomputed from the ledger and compared with what Billing and Reports actually
// render, and with the patient portal's own statement.
//
// Usage: PW=<playwright-core> node scripts/finance-check.mjs
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
await new Promise(r => server.listen(8849, r));
const BASE = 'http://127.0.0.1:8849';

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

async function session(email, pagePath) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.evaluate(([e, pw]) => HIS.auth.attempt(e, pw, true), [email, DEMO]);
  await page.goto(BASE + pagePath, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return { ctx, page, errs };
}

// ---------------------------------------------------------------- 1. the ledger is the source
{
  const { ctx, page, errs } = await session('cashier@mediheal.test', '/billing.html');

  const r = await page.evaluate(() => {
    const out = {};
    const b = HIS.billing.bills.filter(x => x.id === 'BL-8798')[0]; // Pending, 52,800, nothing paid
    out.startBalance = HIS.ledger.balanceOf(b);
    out.startStatus = HIS.ledger.statusOf(b);

    // A PhilHealth share is NOT a collection.
    const before = HIS.ledger.totals();
    out.cov = HIS.ledger.recordCoverage({ invoiceId: b.id, kind: 'coverage', payer: 'PhilHealth', reference: 'CF2-2026-001', amount: 8000 });
    const after = HIS.ledger.totals();
    out.balAfterCov = HIS.ledger.balanceOf(b);
    out.collectedDelta = Math.round((after.collected - before.collected) * 100) / 100;
    out.coveredDelta = Math.round((after.covered - before.covered) * 100) / 100;

    // A discount needs an authorisation number.
    out.discNoRef = HIS.ledger.recordCoverage({ invoiceId: b.id, kind: 'discount', payer: 'Senior citizen', reference: '', amount: 500 });
    out.discOk = HIS.ledger.recordCoverage({ invoiceId: b.id, kind: 'discount', payer: 'Senior citizen', reference: 'OSCA-2026-4471', basis: '20% senior citizen discount', amount: 2000 });

    // Paying more than the remaining balance is refused.
    out.overpay = HIS.ledger.recordPayment({ invoiceId: b.id, amount: 50000, method: 'Cash' });
    out.pay = HIS.ledger.recordPayment({ invoiceId: b.id, amount: 42800, method: 'Cash' });
    out.finalBalance = HIS.ledger.balanceOf(b);
    out.finalStatus = HIS.ledger.statusOf(b);
    out.sums = HIS.ledger.sums(b.id);
    return out;
  });

  ok('an unpaid invoice starts Pending with the full balance', r.startStatus === 'Pending' && r.startBalance === 52800, r.startStatus + ' / ' + r.startBalance);
  ok('coverage reduces the outstanding balance', r.balAfterCov === 44800, 'balance=' + r.balAfterCov);
  ok('coverage is NOT counted as collected', r.collectedDelta === 0, 'delta=' + r.collectedDelta);
  ok('coverage is reported in its own bucket', r.coveredDelta === 8000, 'delta=' + r.coveredDelta);
  ok('a discount without an authorisation is refused', r.discNoRef.ok === false && /reference/i.test(r.discNoRef.error), r.discNoRef.error);
  ok('a documented discount is accepted', r.discOk.ok === true, r.discOk.error);
  ok('paying more than the remaining balance is refused', r.overpay.ok === false && /outstanding/i.test(r.overpay.error), r.overpay.error);
  ok('a payment for exactly the remaining balance is accepted', r.pay.ok === true, r.pay.error);
  ok('the balance reaches zero', r.finalBalance === 0, 'balance=' + r.finalBalance);
  ok('the invoice reads Paid once coverage and payment cover it', r.finalStatus === 'Paid', r.finalStatus);
  ok('the ledger splits received from covered', r.sums.net === 4280000 && r.sums.covered === 1000000, JSON.stringify(r.sums));

  ok('billing page loaded with no console errors', errs.length === 0, errs[0]);
  await ctx.close();
}

// ---------------------------------------------------------------- 2. electronic payments stay pending
{
  const { ctx, page } = await session('cashier@mediheal.test', '/billing.html');
  const r = await page.evaluate(() => {
    const b = HIS.billing.bills.filter(x => x.id === 'BL-8798')[0]; // 52,800, nothing received
    const out = {};
    const before = HIS.ledger.balanceOf(b);
    out.noRef = HIS.ledger.recordPayment({ invoiceId: b.id, amount: 1000, method: 'GCash' });
    out.withRef = HIS.ledger.recordPayment({ invoiceId: b.id, amount: 1000, method: 'GCash', reference: 'GC-2026-9911' });
    out.pendingBalance = HIS.ledger.balanceOf(b);
    out.statusWhilePending = HIS.ledger.statusOf(b);
    out.confirm = HIS.ledger.confirm(out.withRef.transaction.id);
    out.afterConfirm = HIS.ledger.balanceOf(b);
    return { before, ...out };
  });
  ok('an electronic payment without a provider reference is refused', r.noRef.ok === false && /reference/i.test(r.noRef.error), r.noRef.error);
  ok('an electronic payment lands as pending', r.withRef.ok === true && r.withRef.transaction.status === 'pending', JSON.stringify(r.withRef.transaction && r.withRef.transaction.status));
  ok('a pending payment does not move the balance', r.pendingBalance === r.before, r.before + ' -> ' + r.pendingBalance);
  ok('confirmation settles it and moves the balance', r.confirm.ok === true && r.afterConfirm === r.before - 1000, r.before + ' -> ' + r.afterConfirm);
  await ctx.close();
}

// ---------------------------------------------------------------- 3. voids and refunds
{
  const { ctx, page } = await session('cashier@mediheal.test', '/billing.html');
  const r = await page.evaluate(() => {
    const b = HIS.billing.bills.filter(x => x.id === 'BL-8801')[0];
    const out = { start: HIS.ledger.balanceOf(b) };
    out.pay = HIS.ledger.recordPayment({ invoiceId: b.id, amount: 1000, method: 'Maya', reference: 'MY-2026-77' });
    out.afterPay = HIS.ledger.balanceOf(b);
    out.void = HIS.ledger.void(out.pay.transaction.id, 'duplicate entry');
    out.afterVoid = HIS.ledger.balanceOf(b);
    out.refundTooMuch = HIS.ledger.refund({ invoiceId: b.id, amount: 99999 });
    out.refund = HIS.ledger.refund({ invoiceId: b.id, amount: 500, method: 'Cash' });
    out.afterRefund = HIS.ledger.balanceOf(b);
    return out;
  });
  ok('a void removes the payment from the balance', r.void.ok === true && r.afterVoid === r.start, r.afterPay + ' -> ' + r.afterVoid);
  ok('a refund cannot exceed what was received', r.refundTooMuch.ok === false, r.refundTooMuch.error);
  ok('a refund increases the outstanding balance', r.refund.ok === true && r.afterRefund === r.start + 500, r.start + ' -> ' + r.afterRefund);
  await ctx.close();
}

// ---------------------------------------------------------------- 4. screens agree
{
  const { ctx, page } = await session('finance@mediheal.test', '/reports.html');
  const rep = await page.evaluate(() => {
    const t = HIS.ledger.totals();
    return {
      totals: t,
      kpi: [...document.querySelectorAll('.ad-kpi .v')].map(e => e.textContent.trim()),
      text: document.querySelector('.ad-body').innerText
    };
  });
  const fmt = n => '\u20b1' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  ok('Reports shows the ledger total billed', rep.text.includes(fmt(rep.totals.billed)), fmt(rep.totals.billed));
  ok('Reports shows the ledger collected figure', rep.text.includes(fmt(rep.totals.collected)), fmt(rep.totals.collected));
  ok('Reports shows the ledger outstanding figure', rep.text.includes(fmt(rep.totals.outstanding)), fmt(rep.totals.outstanding));
  ok('billed equals collected plus covered plus outstanding',
    Math.abs(rep.totals.billed - (rep.totals.collected + rep.totals.covered + rep.totals.outstanding)) < 0.01,
    JSON.stringify(rep.totals));

  // Billing must show the same headline figures.
  await page.goto(BASE + '/billing.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const bill = await page.evaluate(() => ({
    totals: HIS.ledger.totals(),
    stats: [...document.querySelectorAll('.bl-stat .n')].map(e => e.textContent.trim())
  }));
  ok('Billing KPI strip uses the same billed figure', bill.stats[0] === fmt(rep.totals.billed), bill.stats[0] + ' vs ' + fmt(rep.totals.billed));
  ok('Billing KPI strip uses the same collected figure', bill.stats[1] === fmt(rep.totals.collected), bill.stats[1] + ' vs ' + fmt(rep.totals.collected));
  ok('Billing KPI strip uses the same outstanding figure', bill.stats[2] === fmt(rep.totals.outstanding), bill.stats[2] + ' vs ' + fmt(rep.totals.outstanding));
  await ctx.close();
}

// ---------------------------------------------------------------- 5. the portal agrees
{
  const { ctx, page } = await session('patient@mediheal.test', '/portal.html#billing');
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const b = HIS.registry.invoicesFor('PT-99213')[0];
    return {
      ledgerBalance: HIS.ledger.balanceOf(b),
      text: document.querySelector('#pt-stage').innerText
    };
  });
  const fmt = n => '\u20b1' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  ok('the portal statement shows the ledger balance', r.text.includes(fmt(r.ledgerBalance)), fmt(r.ledgerBalance));
  await ctx.close();
}

// ---------------------------------------------------------------- 6. method and payer mix
{
  const { ctx, page } = await session('finance@mediheal.test', '/reports.html');
  const r = await page.evaluate(() => {
    // Add one of each so the distributions have something to separate.
    const b = HIS.billing.bills.filter(x => x.id === 'BL-8798')[0]; // open balance, so both rows can post
    const qr = HIS.ledger.recordPayment({ invoiceId: b.id, amount: 100, method: 'QR Ph', reference: 'QR-1' });
    HIS.ledger.recordCoverage({ invoiceId: b.id, kind: 'coverage', payer: 'Maxicare', reference: 'LOA-9', amount: 50 });
    const beforeConfirm = HIS.ledger.byMethod().map(m => m.method);
    HIS.ledger.confirm(qr.transaction.id);
    return {
      beforeConfirm,
      methods: HIS.ledger.byMethod(),
      payers: HIS.ledger.byPayer()
    };
  });
  const methodNames = r.methods.map(m => m.method);
  const payerNames = r.payers.map(p => p.payer);
  ok('an unconfirmed electronic method is not in the collection mix', !r.beforeConfirm.includes('QR Ph'), r.beforeConfirm.join(','));
  ok('a confirmed electronic method appears in the collection mix', methodNames.includes('QR Ph'), methodNames.join(','));
  ok('payment-method distribution does NOT list a payer', !methodNames.includes('Maxicare'), methodNames.join(','));
  ok('payer mix lists the payer', payerNames.includes('Maxicare'), payerNames.join(','));
  await ctx.close();
}

await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
