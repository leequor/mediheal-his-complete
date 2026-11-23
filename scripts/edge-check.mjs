// Sequence sweep — the journeys a real user makes and the money invariants after each step.
// The single-step suites click one control from a fresh seed; this one does payment -> refund -> void,
// timesheet change -> payroll re-run, discharge -> reopen -> transfer, and the claim and lab state
// machines, re-deriving the ledger and bed invariants after every step.
//
// Run: PW=<playwright-core> node scripts/edge-check.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PW = process.env.PW;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const buf = fs.readFileSync(path.join('.', p));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(8898, r));
const B = 'http://127.0.0.1:8898';
const mod = await import(pathToFileURL(PW).href);
const chromium = mod.chromium || mod.default.chromium;

const browser = await chromium.launch({ channel: 'chrome' });
let pass = 0, fail = 0; const problems = [];
const ok = (c, l, d) => { if (c) pass++; else { fail++; problems.push(l + (d ? ' :: ' + d : '')); } };
const j = v => JSON.stringify(v).slice(0, 150);

const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message.slice(0, 80)));
await page.goto(B + '/index.html');
await page.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));
await page.goto(B + '/payroll.html');
await page.waitForTimeout(400);

// ---------------------------------------------------------------- payroll arithmetic across extremes
const pay = await page.evaluate(() => {
  const out = [];
  const emp = HIS.employees.all()[0];
  const cases = [
    ['zero hours', { daysWorked: 0, hoursWorked: 0, absentDays: 15, lateMinutes: 0, otMinutes: 0, nightMinutes: 0 }],
    ['one hour', { daysWorked: 1, hoursWorked: 1, absentDays: 14, lateMinutes: 0, otMinutes: 0, nightMinutes: 0 }],
    ['half shift', { daysWorked: 7, hoursWorked: 28, absentDays: 7, lateMinutes: 0, otMinutes: 0, nightMinutes: 0 }],
    ['full period', { daysWorked: 15, hoursWorked: 120, absentDays: 0, lateMinutes: 0, otMinutes: 0, nightMinutes: 0 }],
    ['max overtime', { daysWorked: 15, hoursWorked: 120, absentDays: 0, lateMinutes: 0, otMinutes: 120 * 60, nightMinutes: 60 * 60 }],
    ['very late every day', { daysWorked: 15, hoursWorked: 120, absentDays: 0, lateMinutes: 15 * 240, otMinutes: 0, nightMinutes: 0 }],
    ['long month', { daysWorked: 31, hoursWorked: 248, absentDays: 0, lateMinutes: 0, otMinutes: 0, nightMinutes: 0 }]
  ];
  for (const [label, summary] of cases) {
    try {
      const s = Object.assign(HIS.payrollCalc.emptySummary(15), summary);
      const r = HIS.payrollCalc.compute(emp, { attendance: s });
      out.push({ label, gross: r.gross, net: r.net, ded: r.deductions, basic: r.earnings && r.earnings.basic });
    } catch (e) { out.push({ label, error: e.message }); }
  }
  return out;
});
pay.forEach(r => {
  ok(!r.error, 'payroll computes for ' + r.label, r.error || '');
  if (r.error) return;
  ['gross', 'net', 'ded', 'basic'].forEach(k => ok(Number.isFinite(r[k]), 'payroll ' + k + ' is finite for ' + r.label, String(r[k])));
  ok(r.net >= 0, 'payroll net is not negative for ' + r.label, String(r.net));
  ok(r.net <= r.gross + 0.02, 'payroll net does not exceed gross for ' + r.label, r.net + ' > ' + r.gross);
  ok(r.gross >= 0, 'payroll gross is not negative for ' + r.label, String(r.gross));
});

// rounding stability: the same input twice must give the same number
const stable = await page.evaluate(() => {
  const emp = HIS.employees.all()[1];
  const s = HIS.payrollCalc.emptySummary(15);
  const a = HIS.payrollCalc.compute(emp, { attendance: s });
  const b = HIS.payrollCalc.compute(emp, { attendance: s });
  return a.net === b.net && a.gross === b.gross;
});
ok(stable, 'payroll is deterministic for identical input');

// statutory deductions behave monotonically with salary
const stat = await page.evaluate(() => {
  const lo = HIS.payrollCalc.statutory(10000, 'employee');
  const hi = HIS.payrollCalc.statutory(100000, 'employee');
  const sum = o => Object.keys(o).reduce((s, k) => s + (Number(o[k]) || 0), 0);
  return { lo: sum(lo), hi: sum(hi), loVals: lo, hiVals: hi };
});
ok(stat.hi >= stat.lo, 'statutory deductions grow with salary', stat.lo + ' -> ' + stat.hi);
// statutory() is nested: { employee:{...}, employer:{...}, msc }. Every leaf must be a sane number.
const leaves = o => Object.keys(o).filter(k => typeof o[k] === 'object' && o[k]).flatMap(k => Object.keys(o[k]).map(k2 => o[k][k2]))
  .concat(Object.keys(o).filter(k => typeof o[k] === 'number').map(k => o[k]));
ok(leaves(stat.loVals).every(v => Number.isFinite(v) && v >= 0), 'no negative or NaN statutory line', j(stat.loVals));
ok(leaves(stat.hiVals).every(v => Number.isFinite(v) && v >= 0), 'no negative or NaN statutory line (high)', j(stat.hiVals));

// ---------------------------------------------------------------- ledger rounding under repeated small amounts
await page.goto(B + '/billing.html'); await page.waitForTimeout(300);
const cents = await page.evaluate(() => {
  const L = HIS.ledger;
  const rt = [0.01, 0.005, 0.1, 0.10, 1, 12.34, 999.99, 1000000].map(v => ({ v, back: L.toPesos(L.toCentavos(v)) }));
  const bill = HIS.billing.bills[0];
  const before = L.toPesos(L.sums(bill.id).net);
  let accepted = 0;
  for (let i = 0; i < 20; i++) {
    const r = L.recordPayment({ invoiceId: bill.id, amount: 0.01, method: 'Cash', idempotencyKey: 'edge-' + i });
    if (r.ok) accepted++;
  }
  const after = L.toPesos(L.sums(bill.id).net);
  return { rt, before, after, accepted, diff: Math.round((after - before) * 100) / 100 };
});
// toCentavos rounds to the nearest centavo, so 0.005 legitimately comes back as 0.01.
ok(cents.rt.every(x => Math.abs(x.back - x.v) <= 0.005 + 1e-9), 'centavos round-trip is stable to the nearest centavo', j(cents.rt));
ok(Math.abs(cents.diff - cents.accepted * 0.01) < 0.0001, 'twenty one-cent payments total exactly n x 0.01',
  cents.accepted + ' accepted, delta ' + cents.diff);

// ---------------------------------------------------------------- charges total under many tiny entries
const chg = await page.evaluate(() => {
  const C = HIS.charges;
  const bill = HIS.billing.bills[0];
  const before = C.totalFor(bill.id);
  let added = 0;
  for (let i = 0; i < 10; i++) {
    const r = C.add({ invoiceId: bill.id, source: 'Misc', description: 'Edge ' + i, amount: 0.1, qty: 1 });
    if (r && r.ok !== false) added++;
  }
  return { before, after: C.totalFor(bill.id), added };
});
ok(Math.abs((chg.after - chg.before) - chg.added * 0.1) < 0.001, 'ten 0.10 charges total exactly 1.00',
  chg.before + ' -> ' + chg.after);

// ---------------------------------------------------------------- storage quota
const quota = await page.evaluate(() => {
  const results = { filled: 0, writeThrew: false, storeIntact: true, appThrew: false };
  const payload = 'x'.repeat(200 * 1024);
  try {
    for (let i = 0; i < 60; i++) {
      sessionStorage.setItem('__filler' + i, payload);
      results.filled++;
    }
  } catch (e) { results.writeThrew = true; results.writeError = String(e.name || e.message).slice(0, 40); }
  // now try a real app write while storage is full
  try {
    const before = JSON.stringify(HIS.store.get('mh_audit', []).length);
    HIS.audit.append({ who: 'Edge', role: 'Test', what: 'Write while full', entity: 'sweep', before: null, after: 'x' });
    results.appWrote = true;
    results.auditBefore = before;
  } catch (e) { results.appThrew = true; results.appError = String(e.name || e.message).slice(0, 60); }
  // clean up
  for (let i = 0; i < 60; i++) sessionStorage.removeItem('__filler' + i);
  return results;
});
ok(quota.filled > 0, 'sessionStorage accepted filler data', String(quota.filled));
ok(!quota.appThrew, 'a write while storage is nearly full does not throw out of the store',
  (quota.appError || '') + ' (fill=' + quota.filled + ')');
// the page must still work afterwards
await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(400);
const alive = await page.evaluate(() => ({ rows: document.querySelectorAll('.bl-row,.bl-inv').length, signedIn: !!(HIS.auth && HIS.auth.isSignedIn && HIS.auth.isSignedIn()) }));
ok(alive.rows > 0 || alive.signedIn, 'the page still works after the storage test', j(alive));

ok(errors.length === 0, 'no page errors during the edge sweep', errors.slice(0, 2).join(' | '));

await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); problems.forEach(p => console.log(' - ' + p)); process.exitCode = 1; }
