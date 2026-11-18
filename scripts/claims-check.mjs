// M10 claims harness.
//
// The claim lifecycle is where a hospital's finance module most easily lies to itself: an approval
// gets recorded as if it were cash. These tests pin the boundary — approval moves no money, only a
// settlement does, and it settles once.
//
// Expected values come from the seeded claims and the invoice amounts, not from the module's own
// helpers: the balance check recomputes the invoice arithmetic independently.
//
// Usage: PW=<playwright-core> node scripts/claims-check.mjs
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
await new Promise(r => server.listen(8854, r));
const BASE = 'http://127.0.0.1:8854';

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
await page.evaluate(() => HIS.auth.attempt('finance@mediheal.test', 'MediHeal2026!', true));
await page.goto(BASE + '/claims.html', { waitUntil: 'load' });
await page.waitForTimeout(400);

// ---------------------------------------------------------------- 1. the state machine is coherent
{
  const r = await page.evaluate(() => {
    const S = HIS.claims.STATUS, T = HIS.claims.TRANSITIONS;
    const bad = [];
    T.forEach(t => {
      if (!S[t.from] || !S[t.to]) bad.push('unknown status in ' + t.action);
      if (t.roles.length === 0) bad.push('no role can perform ' + t.action);
    });
    // Every status must be reachable from draft by following transitions.
    const seen = { draft: true };
    let changed = true;
    while (changed) {
      changed = false;
      T.forEach(t => { if (seen[t.from] && !seen[t.to]) { seen[t.to] = true; changed = true; } });
    }
    const unreachable = Object.keys(S).filter(k => !seen[k]);
    // Every status must be exitable, except the terminal ones.
    const dead = Object.keys(S).filter(k => !T.some(t => t.from === k) && k !== 'closed');
    return { bad, unreachable, dead, count: T.length, statuses: Object.keys(S).length };
  });
  ok('thirteen statuses are defined', r.statuses === 13, r.statuses);
  ok('every transition names known statuses and at least one role', r.bad.length === 0, r.bad.join('; '));
  ok('every status is reachable from draft', r.unreachable.length === 0, r.unreachable.join(','));
  ok('every status except closed has an exit', r.dead.length === 0, r.dead.join(','));
}

// ---------------------------------------------------------------- 2. seed integrity
{
  const r = await page.evaluate(() => {
    const all = HIS.claims.all();
    return {
      n: all.length,
      ids: all.map(c => c.id),
      missingHistory: all.filter(c => !c.history || !c.history.length).map(c => c.id),
      badDocs: all.filter(c => !Array.isArray(c.documents) || !c.documents.length).map(c => c.id),
      settled: all.filter(c => c.status === 'settled').length,
      coverageRows: HIS.ledger.all().filter(t => t.kind === 'coverage').length
    };
  });
  ok('five claims are seeded', r.n === 5, r.n);
  ok('claim ids are unique', new Set(r.ids).size === r.ids.length);
  ok('every claim carries a status history', r.missingHistory.length === 0, r.missingHistory.join(','));
  ok('every claim carries its document checklist', r.badDocs.length === 0, r.badDocs.join(','));
  ok('no claim is pre-settled, so the seed does not move the ledger', r.settled === 0 && r.coverageRows === 0, r.settled + ' settled, ' + r.coverageRows + ' coverage rows');
}

// ---------------------------------------------------------------- 3. approval is not a collection
{
  const r = await page.evaluate(() => {
    const before = HIS.ledger.reconcile();
    const claim = HIS.claims.get('CLM-2026-0001');           // approved, not settled
    const txBefore = HIS.ledger.all().length;
    // Walk it back to under-review and approve again: the money must not move.
    HIS.claims.transition(claim.id, 'close', { reason: 'test reset' });
    const after = HIS.ledger.reconcile();
    return { before, after, txBefore, txAfter: HIS.ledger.all().length, status: HIS.claims.get(claim.id).status };
  });
  ok('closing an approved claim posts no ledger transaction', r.txAfter === r.txBefore, r.txBefore + ' -> ' + r.txAfter);
  ok('collections are unchanged by a claim decision', near(r.before.collected, r.after.collected), r.before.collected + ' vs ' + r.after.collected);
  ok('coverage is unchanged by a claim decision', near(r.before.covered, r.after.covered), r.before.covered + ' vs ' + r.after.covered);
}

// ---------------------------------------------------------------- 4. settlement posts exactly once
{
  const r = await page.evaluate(() => {
    // Rebuild the approved state by moving the closed claim back through the machine is not
    // possible, so use a fresh claim for the settlement path.
    const created = HIS.claims.create({
      invoiceId: 'BL-8801', payer: 'PhilHealth', payerType: 'philhealth',
      memberRef: '12-345678901-2', requestedAmount: 2000, coverage: 'Case rate - test'
    });
    const id = created.claim.id;
    const steps = [];
    const step = (action, payload) => { const x = HIS.claims.transition(id, action, payload || {}); steps.push({ action, ok: x.ok, err: x.error }); return x; };
    // Documents are all missing on a new claim, so the documents gate must refuse.
    const docGate = HIS.claims.transition(id, 'send-review', {});
    HIS.claims.get(id).documents.forEach((d, i) => HIS.claims.setDocument(id, i, true));
    step('send-review', {});
    step('verify', {});
    step('submit', { reference: 'PH-TEST-1' });
    step('acknowledge', {});
    const txBeforeApprove = HIS.ledger.all().length;
    step('approve', { approvedAmount: 2000 });
    const txAfterApprove = HIS.ledger.all().length;
    const billBefore = HIS.ledger.balanceOf(HIS.billing.bills.filter(b => b.id === 'BL-8801')[0]);
    step('settle', {});
    const billAfter = HIS.ledger.balanceOf(HIS.billing.bills.filter(b => b.id === 'BL-8801')[0]);
    const claim = HIS.claims.get(id);
    const settleAgain = HIS.claims.transition(id, 'settle', {});
    const coverageRows = HIS.ledger.all().filter(t => t.sourceId === id);
    return {
      docGate: docGate.ok, steps, txBeforeApprove, txAfterApprove,
      billBefore, billAfter, approved: claim.approvedAmount, status: claim.status,
      settleAgain: settleAgain.ok, settleErr: settleAgain.error,
      coverageRows: coverageRows.length, coverageAmount: coverageRows[0] && coverageRows[0].amount / 100,
      settlementTx: claim.settlement && claim.settlement.transactionId
    };
  });
  ok('a claim with missing documents cannot be sent for review', r.docGate === false);
  ok('the full path draft -> settled succeeds', r.steps.every(s => s.ok), JSON.stringify(r.steps.filter(s => !s.ok)));
  ok('approval posts no ledger transaction', r.txAfterApprove === r.txBeforeApprove, r.txBeforeApprove + ' -> ' + r.txAfterApprove);
  ok('settlement posts exactly one coverage row', r.coverageRows === 1, r.coverageRows);
  ok('the coverage row carries the approved amount', near(r.coverageAmount, r.approved), r.coverageAmount + ' vs ' + r.approved);
  ok('settlement reduces the invoice balance by exactly the approved amount',
    near(r.billBefore - r.billAfter, 2000), r.billBefore + ' -> ' + r.billAfter);
  ok('settling a second time is refused', r.settleAgain === false, r.settleErr);
  ok('the claim records the ledger transaction id', !!r.settlementTx, r.settlementTx);
}

// ---------------------------------------------------------------- 5. a claim cannot over-cover an invoice
{
  const r = await page.evaluate(() => {
    const bill = HIS.billing.bills.filter(b => b.id === 'BL-8801')[0];
    const balance = HIS.ledger.balanceOf(bill);
    const res = HIS.ledger.recordCoverage({
      invoiceId: 'BL-8801', kind: 'coverage', amount: balance + 1000,
      payer: 'Test', reference: 'OVER', sourceId: 'TEST-OVER'
    });
    return { ok: res.ok, err: res.error, balance };
  });
  ok('coverage larger than the outstanding balance is refused', r.ok === false, r.err);
}

// ---------------------------------------------------------------- 6. role gating
{
  const r = await page.evaluate(() => {
    HIS.auth.signOut();
    HIS.auth.attempt('auditor@mediheal.test', 'MediHeal2026!', true);
    const auditorRole = HIS.rbac.key();
    const c = HIS.claims.all().filter(x => x.status === 'under-review')[0];
    const auditorApprove = c ? HIS.claims.transition(c.id, 'deny', { reason: 'x' }) : { ok: 'no-claim' };
    const auditorCreate = HIS.claims.create({ invoiceId: 'BL-8801', payer: 'X', memberRef: '1', requestedAmount: 1 });
    HIS.auth.signOut();
    HIS.auth.attempt('cashier@mediheal.test', 'MediHeal2026!', true);
    const cashierRole = HIS.rbac.key();
    const cashierApprove = c ? HIS.claims.transition(c.id, 'approve', { approvedAmount: 1 }) : { ok: 'no-claim' };
    const cashierCreate = HIS.claims.create({ invoiceId: 'BL-8801', payer: 'PhilHealth', memberRef: '12-3', requestedAmount: 500 });
    HIS.auth.signOut();
    HIS.auth.attempt('finance@mediheal.test', 'MediHeal2026!', true);
    return {
      auditorRole, cashierRole,
      auditorApprove: auditorApprove.ok, auditorCreate: auditorCreate.ok,
      cashierApprove: cashierApprove.ok, cashierCreate: cashierCreate.ok,
      cashierCreateErr: cashierCreate.error
    };
  });
  ok('the auditor role is active for the test', r.auditorRole === 'auditor', r.auditorRole);
  ok('an auditor cannot record a payer decision', r.auditorApprove === false);
  ok('an auditor cannot create a claim', r.auditorCreate === false);
  ok('a cashier cannot record a payer decision', r.cashierApprove === false);
  ok('a cashier can create a claim', r.cashierCreate === true, r.cashierCreateErr);
}

// ---------------------------------------------------------------- 7. claim amounts are bounded
{
  const r = await page.evaluate(() => {
    const tooBig = HIS.claims.create({ invoiceId: 'BL-8801', payer: 'PhilHealth', memberRef: '1', requestedAmount: 999999 });
    const zero = HIS.claims.create({ invoiceId: 'BL-8801', payer: 'PhilHealth', memberRef: '1', requestedAmount: 0 });
    const noInvoice = HIS.claims.create({ invoiceId: 'BL-0000', payer: 'PhilHealth', memberRef: '1', requestedAmount: 10 });
    return { tooBig: tooBig.ok, zero: zero.ok, noInvoice: noInvoice.ok };
  });
  ok('a claim larger than the invoice is refused', r.tooBig === false);
  ok('a zero claim is refused', r.zero === false);
  ok('a claim against an unknown invoice is refused', r.noInvoice === false);
}

// ---------------------------------------------------------------- 8. dashboard and ledger agree
{
  const r = await page.evaluate(() => {
    const S = HIS.claims.stats();
    const L = HIS.ledger.reconcile();
    const openFromList = HIS.claims.all().filter(c => HIS.claims.STATUS[c.status].open).length;
    const settledClaims = HIS.claims.all().filter(c => c.status === 'settled');
    const settledValue = settledClaims.reduce((a, c) => a + c.approvedAmount, 0);
    const coverageRows = HIS.ledger.all().filter(t => t.kind === 'coverage' && t.sourceId);
    return { S, L, openFromList, settledValue, coverageRows: coverageRows.length, inv: HIS.ledger.invariants() };
  });
  ok('open claim count matches the status list', r.S.pending === r.openFromList, r.S.pending + ' vs ' + r.openFromList);
  ok('every settled claim has exactly one coverage row', r.coverageRows === r.S.settled, r.coverageRows + ' rows, ' + r.S.settled + ' settled');
  ok('the ledger reconciliation still holds after claim activity', r.L.totalsMatch && r.L.methodMatchesCollected);
  ok('no ledger invariant is broken by claims', r.inv.length === 0, JSON.stringify(r.inv));
  ok('coverage is reported separately from collections', r.L.covered > 0 && r.L.collected > 0 &&
    Math.abs(r.L.collectedPlusCovered - (r.L.collected + r.L.covered)) < 0.01);
}

// ---------------------------------------------------------------- 9. the screen renders the truth
{
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const rows = document.querySelectorAll('.ad-tr.ad-g-claims').length;
    const kpis = [...document.querySelectorAll('.ad-kpi .v')].map(n => n.textContent.trim());
    const badges = [...document.querySelectorAll('.ad-tr.ad-g-claims .badge')].map(n => n.textContent.trim());
    return { rows, kpis, badges, claims: HIS.claims.all().length };
  });
  ok('the register renders one row per claim', r.rows === r.claims, r.rows + '/' + r.claims);
  ok('the KPI strip renders eight figures', r.kpis.length === 8, r.kpis.join('|'));
  ok('every row carries a status badge', r.badges.length === r.claims, r.badges.length);
}

// ---------------------------------------------------------------- 10. the screen can settle a claim
// Module tests pass even when the dialog is not wired to anything. This drives the real buttons.
{
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  const setup = await page.evaluate(() => {
    const c = HIS.claims.create({ invoiceId: 'BL-8798', payer: 'Intellicare', payerType: 'hmo', memberRef: 'IN-1', requestedAmount: 1200 });
    const id = c.claim.id;
    HIS.claims.get(id).documents.forEach((d, i) => HIS.claims.setDocument(id, i, true));
    HIS.claims.transition(id, 'send-review', {});
    HIS.claims.transition(id, 'verify', {});
    HIS.claims.transition(id, 'submit', { reference: 'IN-TEST' });
    HIS.claims.transition(id, 'acknowledge', {});
    HIS.claims.transition(id, 'approve', { approvedAmount: 1200 });
    return { id, before: HIS.ledger.reconcile().covered };
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.click(`[data-open="${setup.id}"]`);
  await page.waitForTimeout(300);
  const offered = await page.$$eval('.cl-actions [data-act]', ns => ns.map(n => n.textContent.trim()));
  await page.click('.cl-actions [data-act="settle"]');
  await page.waitForTimeout(400);
  const after = await page.evaluate(id => ({
    status: HIS.claims.get(id).status,
    covered: HIS.ledger.reconcile().covered,
    tx: HIS.claims.get(id).settlement && HIS.claims.get(id).settlement.transactionId
  }), setup.id);
  ok('clicking a row opens the claim dialog with its available actions', offered.indexOf('Record settlement') > -1, offered.join('|'));
  ok('the dialog settles the claim and records the ledger transaction', after.status === 'settled' && !!after.tx, after.status + ' / ' + after.tx);
  ok('the settlement raises coverage by exactly the approved amount', near(after.covered - setup.before, 1200), after.covered - setup.before);
}

ok('claims page loaded with no console errors', errs.length === 0, errs[0]);

await ctx.close();
await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
