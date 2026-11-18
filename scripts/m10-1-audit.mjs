// M10.1 remediation audit. Independent arithmetic, not a replay of the application's formulas.
//
//   1  Pag-IBIG: the 1% tier, its statutory basis and its boundaries
//   2  minimum wage: effective-dated orders, conversion, enforcement
//   3  off-cycle corrections: underpayment, overpayment, duplicates, immutability
//   4  negative balances: every path that could produce one
//
// Usage: PW=<playwright-core> node scripts/m10-1-audit.mjs
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
await new Promise(r => server.listen(8857, r));
const BASE = 'http://127.0.0.1:8857';

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
const r2 = n => Math.round(n * 100) / 100;

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.evaluate(() => HIS.auth.attempt('hr@mediheal.test', 'MediHeal2026!', true));
await page.goto(BASE + '/payroll.html', { waitUntil: 'load' });
await page.waitForTimeout(400);

// =================================================================================================
// 1. PAG-IBIG
// =================================================================================================
console.log('\n--- 1. Pag-IBIG contribution tiers ---');
{
  const r = await page.evaluate(() => {
    const at = m => ({
      monthly: m,
      employee: HIS.payrollCalc.pagibigMonthly(m),
      employer: HIS.payrollCalc.pagibigEmployerMonthly(m),
      statutory: HIS.payrollCalc.statutory(m)
    });
    return {
      rows: [1000, 1500, 1501, 5000, 9999, 10000, 10001, 26100].map(at),
      cfg: HIS.payrollCalc.CONFIG.pagibig
    };
  });

  // RA 9679 s.7: 1% employee at or below 1,500; 2% above; employer 2% at every level; fund salary
  // capped at 10,000 under Circular 460.
  const expected = [
    [1000, 10, 20], [1500, 15, 30], [1501, 30.02, 30.02], [5000, 100, 100],
    [9999, 199.98, 199.98], [10000, 200, 200], [10001, 200, 200], [26100, 200, 200]
  ];
  r.rows.forEach((row, i) => {
    const [m, ee, er] = expected[i];
    ok(`Pag-IBIG ${m}: employee ${ee}`, near(row.employee, ee), row.employee);
    ok(`Pag-IBIG ${m}: employer ${er}`, near(row.employer, er), row.employer);
  });

  ok('the 1% tier ends at 1,500 inclusive', near(r.rows[1].employee, 15) && near(r.rows[2].employee, 30.02),
    r.rows[1].employee + ' / ' + r.rows[2].employee);
  ok('the employer share has no low tier (2% at 1,000)', near(r.rows[0].employer, 20), r.rows[0].employer);
  ok('the fund salary cap binds at 10,000 and above',
    near(r.rows[5].employee, 200) && near(r.rows[6].employee, 200) && near(r.rows[7].employee, 200));
  ok('the statutory basis is RA 9679 section 7', /RA 9679/.test(r.cfg.source), r.cfg.source);
  ok('the rate and the cap carry separate effective dates',
    r.cfg.effectiveFrom === '2009-07-21' && r.cfg.capEffectiveFrom === '2024-02-01',
    r.cfg.effectiveFrom + ' / ' + r.cfg.capEffectiveFrom);
  ok('the low tier is configured as 1% at a 1,500 threshold',
    r.cfg.lowRate === 0.01 && r.cfg.lowThreshold === 1500, r.cfg.lowRate + ' @ ' + r.cfg.lowThreshold);

  // Semi-monthly apportionment of the tiered amount.
  const semi = await page.evaluate(() => ({
    ee: HIS.payrollCalc.compute({ monthlyBasic: 1500, allowances: [], category: 'rank-and-file' }, { frequency: 'semi-monthly', attendance: HIS.payrollCalc.emptySummary(11) }).statutory.pagibig,
    er: HIS.payrollCalc.compute({ monthlyBasic: 1500, allowances: [], category: 'rank-and-file' }, { frequency: 'semi-monthly', attendance: HIS.payrollCalc.emptySummary(11) }).employer.pagibig
  }));
  ok('a semi-monthly period withholds half of 15 = 7.50', near(semi.ee, 7.50), semi.ee);
  ok('the employer share for the same period is 15.00', near(semi.er, 15), semi.er);

  // Existing employees are unaffected: all earn above 1,500.
  const unaffected = await page.evaluate(() => HIS.employees.all().map(e => ({
    id: e.id, monthly: e.monthlyBasic, pag: HIS.payrollCalc.pagibigMonthly(e.monthlyBasic)
  })));
  ok('every existing employee is on the 2% tier and capped at 200',
    unaffected.every(x => x.monthly > 1500 && near(x.pag, 200)), JSON.stringify(unaffected.filter(x => !near(x.pag, 200))));
}

// =================================================================================================
// 2. MINIMUM WAGE
// =================================================================================================
console.log('\n--- 2. minimum wage ---');
{
  const r = await page.evaluate(() => {
    const wf = HIS.wageFloor;
    const emp = (monthly, hours) => ({
      id: 'T', payBasis: 'monthly', monthlyBasic: monthly,
      schedule: { daysPerWeek: 5, hoursPerDay: hours == null ? 8 : hours, paidRestDays: true, paidSpecialDays: true },
      wage: { region: 'NCR', sector: 'non-agriculture' }
    });
    return {
      before: wf.floorFor({ asOf: '2026-09-25' }),
      onDay: wf.floorFor({ asOf: '2026-09-26' }),
      later: wf.floorFor({ asOf: '2027-01-20' }),
      agri: wf.floorFor({ asOf: '2026-09-26', sector: 'agriculture' }),
      otherRegion: wf.floorFor({ asOf: '2026-09-26', region: 'Region VII' }),
      ok755: wf.check(emp(22964.58), '2026-09-26'),
      below: wf.check(emp(20000), '2026-09-26'),
      partTime: wf.check(emp(8000, 4), '2026-09-26'),
      partTimeOk: wf.check(emp(11482.29, 4), '2026-09-26'),
      exempt: wf.check(Object.assign(emp(16000), { wage: { region: 'NCR', sector: 'non-agriculture', hoursPerDay: 8, exemption: { code: 'KAWANI', reference: 'DOLE-EX-2026-014' } } }), '2026-09-26'),
      unknown: wf.check(emp(16000), '2026-08-31'),
      conversion: wf.equivalentDaily(emp(26100))
    };
  });

  ok('no NCR order is in force on 25 September 2026', r.before.status === 'unknown', r.before.status);
  ok('NCR-28 is in force from 26 September 2026 at 755', r.onDay.status === 'in-force' && r.onDay.dailyRate === 755,
    JSON.stringify(r.onDay));
  ok('the suspended NCR-27 is explained, never applied', r.before.suspendedOrder && r.before.suspendedOrder.id === 'NCR-27',
    JSON.stringify(r.before.suspendedOrder));
  ok('the January 2027 tranche is not applied on its date', r.later.dailyRate === 755, r.later.dailyRate);
  ok('agriculture carries the lower 718 rate', r.agri.dailyRate === 718, r.agri.dailyRate);
  ok('a region with no order returns unknown rather than a national rate', r.otherRegion.status === 'unknown', r.otherRegion.status);

  ok('a monthly rate of 22,964.58 converts to exactly 755.00 a day (365 factor)',
    near(r.ok755.equivalentDaily, 755), r.ok755.equivalentDaily);
  ok('22,964.58 a month clears the floor', r.ok755.status === 'ok', r.ok755.status);
  ok('20,000 a month is 657.53 a day and is below the floor',
    r.below.status === 'below' && near(r.below.equivalentDaily, 657.53),
    r.below.status + ' / ' + r.below.equivalentDaily);
  ok('the shortfall is reported in pesos', near(r.below.shortfall, 97.47), r.below.shortfall);
  ok('a part-timer is compared against the floor prorated to their hours', r.partTime.status === 'below', r.partTime.status);
  ok('a part-timer at the prorated floor passes', r.partTimeOk.status === 'ok', r.partTimeOk.status);
  ok('an exemption with a reference clears the block', r.exempt.status === 'exempt', r.exempt.status);
  ok('the period before any order is unknown, not a failure', r.unknown.status === 'unknown', r.unknown.status);
  ok('the conversion uses 365 days for a monthly-paid employee, not 261', near(r.conversion, 858.08), r.conversion);

  // The gate, two ways. The demo period is August 2026, before any NCR order is in force, so the
  // date-based check is exercised with an explicit as-of date; the wiring into approval is
  // exercised by making the checker report a breach.
  const dated = await page.evaluate(() => {
    const realAll = HIS.employees.all;
    const fake = Object.assign({}, realAll()[0], {
      id: 'EMP-001', monthlyBasic: 10000,
      wage: { region: 'NCR', sector: 'non-agriculture', hoursPerDay: 8 }
    });
    HIS.employees.all = function () { return [fake]; };
    const problems = HIS.payrollRuns.wageProblems({ payDate: '2026-10-01' });
    HIS.employees.all = realAll;
    return problems;
  });
  ok('wageProblems reports an employee below the floor on a date with an order in force',
    dated.length === 1 && /below the NCR-28 floor/.test(dated[0]), JSON.stringify(dated));

  const gate = await page.evaluate(() => {
    const run = HIS.payrollRuns.current();
    if (run.status === 'draft') HIS.payrollRuns.review(run.id, 'audit');
    const realCheck = HIS.wageFloor.check;
    HIS.wageFloor.check = function () {
      return { status: 'below', explanation: 'synthetic below-floor rate', dailyRate: 755, orderId: 'NCR-28' };
    };
    const problems = HIS.payrollRuns.wageProblems(HIS.payrollRuns.current());
    const approve = HIS.payrollRuns.approve(run.id, 'audit');
    HIS.wageFloor.check = realCheck;
    return { problems: problems.length, approve: approve.ok, err: approve.error, status: HIS.payrollRuns.current().status };
  });
  ok('every employee is checked at approval', gate.problems === 8, gate.problems);
  ok('approval is refused while a rate is below the floor', gate.approve === false && /below-floor/.test(gate.err), gate.err);
  ok('the run stays in review rather than half-approving', gate.status === 'reviewed', gate.status);
}

// =================================================================================================
// 3. CORRECTION RUNS
// =================================================================================================
console.log('\n--- 3. off-cycle corrections ---');
{
  // Release the period run first: a correction only exists for a released payroll.
  const released = await page.evaluate(() => {
    const run = HIS.payrollRuns.current();
    if (run.status === 'draft') HIS.payrollRuns.review(run.id, 'audit');
    if (HIS.payrollRuns.current().status === 'reviewed') HIS.payrollRuns.approve(run.id, 'audit');
    if (HIS.payrollRuns.current().status === 'approved') HIS.payrollRuns.release(run.id, 'audit');
    return { status: HIS.payrollRuns.current().status, id: run.id, snapshot: JSON.stringify(HIS.payrollRuns.current()) };
  });
  ok('the period payroll is released', released.status === 'released', released.status);

  // Correct an absence away: EMP-008 was absent on 18 August, so removing it creates an underpayment.
  const under = await page.evaluate((runId) => {
    HIS.attendancePeriod.correct('EMP-008', '2026-08-18', { timeIn: '08:00', timeOut: '17:00', status: 'present' }, 'employee was on approved errand');
    HIS.attendancePeriod.approve('EMP-008', 'audit');
    const before = HIS.payrollCorrections.all().length;
    const c1 = HIS.payrollCorrections.create({ originalRunId: runId, reason: 'Absence on 18 August was a paid errand, not unpaid leave' });
    const dup = HIS.payrollCorrections.create({ originalRunId: runId, reason: 'Absence on 18 August was a paid errand, not unpaid leave' });
    return {
      before, ok: c1.ok, err: c1.error, id: c1.correction && c1.correction.id,
      lines: c1.correction && c1.correction.lines,
      totals: c1.correction && c1.correction.totals,
      dup: dup.ok, dupErr: dup.error,
      after: HIS.payrollCorrections.all().length
    };
  }, released.id);

  ok('a correction is created against the released run', under.ok === true, under.err);
  ok('only the employee with a difference is included', under.lines && under.lines.length === 1, under.lines && under.lines.length);
  ok('the difference is an underpayment', under.lines && under.lines[0].kind === 'underpayment', under.lines && under.lines[0].kind);
  ok('the difference equals the corrected net less the original net',
    under.lines && near(under.lines[0].difference, r2(under.lines[0].correctedNet - under.lines[0].originalNet)),
    under.lines && (under.lines[0].correctedNet + ' - ' + under.lines[0].originalNet));
  ok('an identical correction is refused as a duplicate', under.dup === false, under.dupErr);
  ok('the duplicate refusal left one correction on file', under.after === under.before + 1, under.after);

  // The original released payroll must be byte-identical.
  const immutable = await page.evaluate((snap) => JSON.stringify(HIS.payrollRuns.current()) === snap, released.snapshot);
  ok('the original released payroll is unchanged', immutable === true);

  const flow = await page.evaluate((id) => {
    const rev = HIS.payrollCorrections.review(id, 'audit');
    const ap = HIS.payrollCorrections.approve(id, 'audit');
    const rel = HIS.payrollCorrections.release(id, 'audit');
    const st = HIS.payrollCorrections.statement(id);
    const again = HIS.payrollCorrections.release(id, 'audit');
    return { rev: rev.ok, ap: ap.ok, rel: rel.ok, again: again.ok, status: st.status, totals: st.totals };
  }, under.id);
  ok('a correction moves draft -> reviewed -> approved -> released', flow.rev && flow.ap && flow.rel, JSON.stringify(flow));
  ok('releasing a correction twice is refused', flow.again === false);
  ok('the statement reports the released adjustment', flow.status === 'released' && near(flow.totals.underpayment, under.totals.underpayment),
    flow.status + ' / ' + flow.totals.underpayment);

  // A second correction must pay only the increment, and can go the other way.
  const over = await page.evaluate((runId) => {
    HIS.attendancePeriod.correct('EMP-008', '2026-08-19', { timeIn: null, timeOut: null, status: 'absent' }, 'audit: reverse an extra day');
    HIS.attendancePeriod.approve('EMP-008', 'audit');
    const c2 = HIS.payrollCorrections.create({ originalRunId: runId, reason: 'A second day was recorded as present in error' });
    if (!c2.ok) return { ok: false, err: c2.error };
    const line = c2.correction.lines[0];
    const beforeAuth = line.recovery.status;
    const noRef = HIS.payrollCorrections.authorizeRecovery(c2.correction.id, 'EMP-008', {});
    const withRef = HIS.payrollCorrections.authorizeRecovery(c2.correction.id, 'EMP-008', { reference: 'HR-AUTH-2026-09', method: 'payroll-deduction' });
    return {
      ok: true, id: c2.correction.id, kind: line.kind, difference: line.difference,
      alreadyCorrected: line.alreadyCorrected, beforeAuth,
      noRef: noRef.ok, withRef: withRef.ok, status: withRef.correction && withRef.correction.lines[0].recovery.status
    };
  }, released.id);

  ok('a later correction accounts for what was already paid', over.ok && near(over.alreadyCorrected, under.lines[0].difference),
    over.alreadyCorrected + ' vs ' + under.lines[0].difference);
  ok('the second correction is an overpayment', over.kind === 'overpayment', over.kind);
  ok('an overpayment starts unrecorded, never auto-deducted', over.beforeAuth === 'unrecorded', over.beforeAuth);
  ok('recovery without a written reference is refused', over.noRef === false);
  ok('recovery with a reference is recorded as pending deduction', over.withRef === true && over.status === 'authorized-pending-deduction', over.status);

  const pdf = await page.evaluate((id) => HIS.payrollCorrections.statementPdf(id), over.id);
  ok('a correction statement can be produced as a PDF', pdf.ok === true, pdf.error);
}

// =================================================================================================
// 4. NEGATIVE BALANCES
// =================================================================================================
console.log('\n--- 4. negative balances and unapplied coverage ---');
await page.evaluate(() => { HIS.auth.signOut(); HIS.auth.attempt('finance@mediheal.test', 'MediHeal2026!', true); });
await page.goto(BASE + '/claims.html', { waitUntil: 'load' });
await page.waitForTimeout(400);
{
  const r = await page.evaluate(() => {
    const bills = HIS.billing.bills;
    const bill = bills.filter(b => b.id === 'BL-8801')[0];
    const inv = () => HIS.ledger.invariants();
    const trace = [];
    const step = (label, fn) => {
      const before = HIS.ledger.balanceOf(bill);
      const res = fn();
      trace.push({ label, ok: res.ok, err: res.error, before, after: HIS.ledger.balanceOf(bill), inv: inv() });
      return res;
    };

    // 1. coverage larger than the balance is refused, not applied partially
    const overCover = step('over-coverage', () => HIS.ledger.recordCoverage({
      invoiceId: bill.id, kind: 'coverage', amount: HIS.ledger.balanceOf(bill) + 500,
      payer: 'Test', reference: 'OVER', sourceId: 'NEG-1'
    }));

    // 2. a payment larger than the balance is refused
    const overPay = step('over-payment', () => HIS.ledger.recordPayment({
      invoiceId: bill.id, amount: HIS.ledger.balanceOf(bill) + 500, method: 'Cash'
    }));

    // 3. a credit is recorded separately and does not move the balance
    const credit = step('credit', () => HIS.ledger.recordCredit({
      invoiceId: bill.id, amount: 300, method: 'Cash', reference: 'OR-7781'
    }));

    // 4. settle a claim for more than the balance: the excess is unapplied, not posted
    const claim = HIS.claims.create({ invoiceId: bill.id, payer: 'PhilHealth', payerType: 'philhealth', memberRef: 'NEG', requestedAmount: 9000 });
    const id = claim.claim.id;
    HIS.claims.get(id).documents.forEach((d, i) => HIS.claims.setDocument(id, i, true));
    HIS.claims.transition(id, 'send-review', {});
    HIS.claims.transition(id, 'verify', {});
    HIS.claims.transition(id, 'submit', { reference: 'NEG-REF' });
    HIS.claims.transition(id, 'acknowledge', {});
    HIS.claims.transition(id, 'approve', { approvedAmount: 9000 });
    const balBeforeSettle = HIS.ledger.balanceOf(bill);
    const settle = HIS.claims.transition(id, 'settle', {});
    const settled = HIS.claims.get(id);

    // 5. every invoice still satisfies the identity, and no balance is negative
    const rows = bills.map(b => ({
      id: b.id, outstanding: HIS.ledger.balanceOf(b),
      identity: Math.round(b.amount * 100) - HIS.ledger.sums(b.id).net - HIS.ledger.sums(b.id).covered - Math.round(HIS.ledger.balanceOf(b) * 100)
    }));

    return {
      trace, overCover: overCover.ok, overPay: overPay.ok, credit: credit.ok,
      creditTotal: HIS.ledger.creditOf(bill), balBeforeSettle,
      settle: settle.ok, settleErr: settle.error,
      settledAmount: settled.settlement && settled.settlement.amount,
      unapplied: settled.unappliedAmount, unappliedReason: settled.unappliedReason,
      balanceAfter: HIS.ledger.balanceOf(bill),
      rows, inv: inv()
    };
  });

  ok('coverage larger than the balance is refused', r.overCover === false, r.trace[0].err);
  ok('a payment larger than the balance is refused', r.overPay === false, r.trace[1].err);
  ok('a credit is accepted and recorded separately', r.credit === true, r.trace[2].err);
  ok('a credit does not move the invoice balance', near(r.trace[2].before, r.trace[2].after), r.trace[2].before + ' -> ' + r.trace[2].after);
  ok('the credit total is reported on its own', near(r.creditTotal, 300), r.creditTotal);

  ok('a claim approved above the balance still settles', r.settle === true, r.settleErr);
  ok('only the outstanding balance is posted as coverage', near(r.settledAmount, r.balBeforeSettle),
    r.settledAmount + ' of ' + r.balBeforeSettle);
  ok('the excess is recorded as unapplied on the claim', near(r.unapplied, r2(9000 - r.balBeforeSettle)), r.unapplied);
  ok('the unapplied excess explains itself', /outstanding/.test(r.unappliedReason || ''), r.unappliedReason);
  ok('the invoice balance lands on zero, not below it', near(r.balanceAfter, 0), r.balanceAfter);
  ok('no invoice has a negative balance', r.rows.every(x => x.outstanding >= 0), JSON.stringify(r.rows));
  ok('every invoice still satisfies charge = collected + covered + outstanding',
    r.rows.every(x => x.identity === 0), JSON.stringify(r.rows.filter(x => x.identity !== 0)));
  ok('no invariant broke while forcing the edge cases', r.inv.length === 0, JSON.stringify(r.inv));

  // Duplicate settlement remains impossible after the cap change.
  const dup = await page.evaluate(() => {
    const c = HIS.claims.all().filter(x => x.status === 'settled' && x.settlement)[0];
    const again = HIS.claims.transition(c.id, 'settle', {});
    return { ok: again.ok, err: again.error, rows: HIS.ledger.all().filter(t => t.sourceId === c.id).length };
  });
  ok('a settled claim cannot be settled again', dup.ok === false, dup.err);
  ok('it still has exactly one coverage row', dup.rows === 1, dup.rows);
}

ok('the audit ran with no console errors', errs.length === 0, errs[0]);

await mkdir(path.join(ROOT, 'qa', 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'qa', 'audit', 'm10-1.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, failures }, null, 2));

await ctx.close();
await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
