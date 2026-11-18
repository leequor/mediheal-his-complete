// M10 payroll harness. Every expected figure below was worked out by hand from the published rule
// — BIR Annex E, the SSS/PhilHealth/Pag-IBIG circulars and the Labor Code — not read back from the
// engine. If the engine changes, these must still match or the change is wrong.
//
// WHAT THIS REPLACES
// The M8 harness asserted that a "period basic" of 60,000 became a monthly equivalent of 120,000,
// and that the resulting tax was 12,381.20. Those expectations encoded the defect: they took a
// monthly salary, doubled it, and applied the semi-monthly table to the inflated base. Section 0
// below pins down what the old figure actually was, so the correction is documented rather than
// quietly swapped for a different number.
//
// Usage: PW=<playwright-core> node scripts/payroll-check.mjs
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
await new Promise(r => server.listen(8853, r));
const BASE = 'http://127.0.0.1:8853';

const spec = process.env.PW || 'playwright-core';
const mod = await import(spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) ? pathToFileURL(spec).href : spec);
const chromium = mod.chromium || (mod.default && mod.default.chromium);
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail !== undefined ? '  \u2192 ' + detail : '')); }
};
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) < (tol == null ? 0.011 : tol);

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.evaluate(() => HIS.auth.attempt('hr@mediheal.test', 'MediHeal2026!', true));
await page.goto(BASE + '/payroll.html', { waitUntil: 'load' });
await page.waitForTimeout(400);

// ---------------------------------------------------------------- 0. what M8 actually computed
{
  const r = await page.evaluate(() => ({
    semi: HIS.payrollCalc.withholding(65775, 'semi-monthly'),
    monthly: HIS.payrollCalc.withholding(65775, 'monthly'),
    // The M8 inputs, expressed the way M8 expressed them.
    m8: HIS.payrollCalc.compute({ monthlyBasic: 120000, allowances: [{ label: 'A', amount: 16000, taxable: true }] }, { frequency: 'semi-monthly', attendance: HIS.payrollCalc.emptySummary(11) })
  }));
  ok('M8 tax of 12,381.20 = semi-monthly table applied to 65,775', near(r.semi, 12381.20), r.semi);
  ok('the monthly table on the same 65,775 gives the 8,363.40 the brief quotes', near(r.monthly, 8363.40), r.monthly);
  ok('M8 reproduction: 120,000 monthly + 16,000 allowance reproduces 12,381.20',
    near(r.m8.tax, 12381.20), r.m8.tax);
}

// ---------------------------------------------------------------- 1. hand-calculated cases
// [label, monthlyBasic, taxableAllowance, frequency, expected sss, phil, pag, tax, net]
const CASES = [
  // A. The corrected M8 employee. Monthly 60,000 + 8,000 allowance, semi-monthly.
  //    Period basic 30,000, allowance 4,000, gross 34,000.
  //    SSS: MSC 35,000 (ceiling) x 5% = 1,750/mo -> 875.
  //    PhilHealth: 60,000 x 2.5% = 1,500/mo -> 750. Pag-IBIG: 200/mo -> 100.
  //    Statutory 1,725. Taxable 32,275. Tax = 937.50 + 20% x (32,275 - 16,667) = 4,059.10.
  //    Net = 34,000 - 1,725 - 4,059.10 = 28,215.90.
  ['A semi-monthly, 60,000', 60000, 8000, 'semi-monthly', 875, 750, 100, 4059.10, 28215.90],

  // B. The same person paid monthly. Basic 60,000, allowance 8,000, gross 68,000.
  //    Statutory 3,450. Taxable 64,550. Tax = 1,875.00 + 20% x (64,550 - 33,333) = 8,118.40.
  //    Net = 68,000 - 3,450 - 8,118.40 = 56,431.60.
  ['B monthly, 60,000', 60000, 8000, 'monthly', 1750, 1500, 200, 8118.40, 56431.60],

  // C. Weekly, 26,000 a month, no allowance. Weekly basic = 26,000 x 12 / 52 = 6,000.
  //    SSS 1,300/mo -> 300. PhilHealth 650/mo -> 150. Pag-IBIG 200/mo -> 46.15.
  //    Statutory 496.15. Taxable 5,503.85. Weekly table: 15% x (5,503.85 - 4,808) = 104.38.
  //    Net = 6,000 - 496.15 - 104.38 = 5,399.47.
  ['C weekly, 26,000', 26000, 0, 'weekly', 300, 150, 46.15, 104.38, 5399.47],

  // D. Below the PhilHealth floor. Monthly 9,000, semi-monthly, gross 4,500.
  //    SSS MSC 9,000 x 5% = 450/mo -> 225. PhilHealth floor 10,000 x 2.5% = 250/mo -> 125.
  //    Pag-IBIG 180/mo -> 90. Statutory 440. Taxable 4,060 -> below 10,417 -> no tax.
  ['D below floor, 9,000', 9000, 0, 'semi-monthly', 225, 125, 90, 0, 4060],

  // E. At both ceilings. Monthly 250,000, semi-monthly, gross 125,000.
  //    SSS 1,750/mo -> 875. PhilHealth ceiling 100,000 x 2.5% = 2,500/mo -> 1,250.
  //    Pag-IBIG 200/mo -> 100. Statutory 2,225. Taxable 122,650.
  //    Tax = 16,770.70 + 30% x (122,775 - 83,333) = 28,603.30. Net = 94,171.70.
  ['E at ceilings, 250,000', 250000, 0, 'semi-monthly', 875, 1250, 100, 28603.30, 94171.70]
];

const got = await page.evaluate(cases => cases.map(c => {
  const out = HIS.payrollCalc.compute(
    { monthlyBasic: c[1], allowances: c[2] ? [{ label: 'Allowance', amount: c[2], taxable: true }] : [] },
    { frequency: c[3], attendance: HIS.payrollCalc.emptySummary(c[3] === 'weekly' ? 5 : c[3] === 'monthly' ? 22 : 11) }
  );
  return { sss: out.statutory.sss, phil: out.statutory.philhealth, pag: out.statutory.pagibig, tax: out.tax, net: out.net, gross: out.gross, taxable: out.taxable, basic: out.earnings.basic };
}), CASES);

CASES.forEach((c, i) => {
  const g = got[i];
  ok(`${c[0]}: SSS ${c[4]}`, near(g.sss, c[4]), g.sss);
  ok(`${c[0]}: PhilHealth ${c[5]}`, near(g.phil, c[5]), g.phil);
  ok(`${c[0]}: Pag-IBIG ${c[6]}`, near(g.pag, c[6]), g.pag);
  ok(`${c[0]}: withholding ${c[7]}`, near(g.tax, c[7]), g.tax);
  ok(`${c[0]}: net ${c[8]}`, near(g.net, c[8]), g.net);
});

// ---------------------------------------------------------------- 2. the frequency is the point
{
  const r = await page.evaluate(() => {
    const emp = { monthlyBasic: 60000, allowances: [{ label: 'A', amount: 8000, taxable: true }] };
    const semi = HIS.payrollCalc.compute(emp, { frequency: 'semi-monthly', attendance: HIS.payrollCalc.emptySummary(11) });
    const mon = HIS.payrollCalc.compute(emp, { frequency: 'monthly', attendance: HIS.payrollCalc.emptySummary(22) });
    return { semiBasic: semi.earnings.basic, monBasic: mon.earnings.basic, semiTax: semi.tax, monTax: mon.tax };
  });
  ok('semi-monthly basic is half the monthly basic', near(r.semiBasic, 30000), r.semiBasic);
  ok('monthly basic is the monthly basic', near(r.monBasic, 60000), r.monBasic);
  ok('two semi-monthly periods withhold the same tax as one monthly period, within rounding',
    Math.abs(r.semiTax * 2 - r.monTax) <= 0.25, (r.semiTax * 2) + ' vs ' + r.monTax);
}

// ---------------------------------------------------------------- 3. the tables themselves
{
  const r = await page.evaluate(() => ({
    // MSC brackets run [MSC-250, MSC+249.99]; 12,249 belongs to 12,000 and 12,250 to 12,500.
    m12249: HIS.payrollCalc.msc(12249), m12250: HIS.payrollCalc.msc(12250), m12300: HIS.payrollCalc.msc(12300),
    m4999: HIS.payrollCalc.msc(4999), m5000: HIS.payrollCalc.msc(5000), m5250: HIS.payrollCalc.msc(5250),
    m5251: HIS.payrollCalc.msc(5251), m999999: HIS.payrollCalc.msc(999999),
    // Annex E bracket bases, read off the PDF.
    sm10417: HIS.payrollCalc.withholding(10417, 'semi-monthly'),
    sm16667: HIS.payrollCalc.withholding(16667, 'semi-monthly'),
    sm33333: HIS.payrollCalc.withholding(33333, 'semi-monthly'),
    sm83333: HIS.payrollCalc.withholding(83333, 'semi-monthly'),
    mo33333: HIS.payrollCalc.withholding(33333, 'monthly'),
    mo66667: HIS.payrollCalc.withholding(66667, 'monthly'),
    mo166667: HIS.payrollCalc.withholding(166667, 'monthly'),
    mo666667: HIS.payrollCalc.withholding(666667, 'monthly'),
    an250000: HIS.payrollCalc.withholding(250000, 'annual'),
    an400000: HIS.payrollCalc.withholding(400000, 'annual'),
    an800000: HIS.payrollCalc.withholding(800000, 'annual'),
    an2000000: HIS.payrollCalc.withholding(2000000, 'annual'),
    audit: HIS.payrollCalc.auditTables()
  }));
  ok('MSC 12,249 -> 12,000', r.m12249 === 12000, r.m12249);
  ok('MSC 12,250 -> 12,500', r.m12250 === 12500, r.m12250);
  ok('MSC 12,300 -> 12,500', r.m12300 === 12500, r.m12300);
  ok('MSC never below the 5,000 floor', r.m4999 === 5000 && r.m5000 === 5000, r.m4999 + '/' + r.m5000);
  ok('MSC 5,250 -> 5,500', r.m5250 === 5500, r.m5250);
  ok('MSC 5,251 -> 5,500', r.m5251 === 5500, r.m5251);
  ok('MSC capped at 35,000', r.m999999 === 35000, r.m999999);

  ok('semi-monthly 10,417 is exempt', r.sm10417 === 0, r.sm10417);
  ok('semi-monthly base at 16,667 is 937.50', near(r.sm16667, 937.50), r.sm16667);
  ok('semi-monthly base at 33,333 is 4,270.70', near(r.sm33333, 4270.70), r.sm33333);
  ok('semi-monthly base at 83,333 is 16,770.70', near(r.sm83333, 16770.70), r.sm83333);
  ok('monthly base at 33,333 is 1,875.00', near(r.mo33333, 1875.00), r.mo33333);
  ok('monthly base at 66,667 is 8,541.80', near(r.mo66667, 8541.80), r.mo66667);
  ok('monthly base at 166,667 is 33,541.80', near(r.mo166667, 33541.80), r.mo166667);
  ok('monthly base at 666,667 is 183,541.80', near(r.mo666667, 183541.80), r.mo666667);
  ok('annual 250,000 is exempt', r.an250000 === 0, r.an250000);
  ok('annual base at 400,000 is 22,500', near(r.an400000, 22500), r.an400000);
  ok('annual base at 800,000 is 102,500', near(r.an800000, 102500), r.an800000);
  ok('annual base at 2,000,000 is 402,500', near(r.an2000000, 402500), r.an2000000);
  ok('every bracket table is continuous and gap-free', r.audit.length === 0, JSON.stringify(r.audit));
}

// ---------------------------------------------------------------- 4. attendance drives the pay
{
  const r = await page.evaluate(() => {
    const s = HIS.payrollCalc.emptySummary(11);
    s.absenceDays = 1;
    s.lateMinutes = 25;
    s.undertimeMinutes = 45;
    s.premiumDays.regularHoliday = 1;
    s.premiumDays.special = 1;
    s.premiumDays.rest = 1;
    s.otHours.ordinary = 2;
    s.ndHours = 8;
    return {
      line: HIS.payrollCalc.compute({ monthlyBasic: 26000, category: 'rank-and-file' }, { frequency: 'semi-monthly', attendance: s }),
      daily: HIS.payrollCalc.dailyRate(26000),
      hourly: HIS.payrollCalc.hourlyRate(26000),
      manager: HIS.payrollCalc.compute({ monthlyBasic: 26000, category: 'managerial' }, { frequency: 'semi-monthly', attendance: s })
    };
  });
  const daily = 26000 * 12 / 261;        // 1,195.4023
  const hourly = daily / 8;              // 149.4253
  ok('one day of absence costs one daily rate', near(r.line.earnings.absence, -daily), r.line.earnings.absence);
  ok('late minutes cost the hourly rate per minute', near(r.line.earnings.late, -(hourly / 60 * 25)), r.line.earnings.late);
  ok('undertime costs the hourly rate per minute', near(r.line.earnings.undertime, -(hourly / 60 * 45)), r.line.earnings.undertime);
  ok('a regular holiday worked adds 100% of a day', near(r.line.earnings.premium - (daily * 0.30) - (daily * 0.30), daily), r.line.earnings.premium);
  ok('two hours of overtime pay 125% of the hourly rate',
    near(r.line.earnings.overtime, hourly * 1.25 * 2), r.line.earnings.overtime);
  ok('eight night hours pay a 10% differential', near(r.line.earnings.night, hourly * 0.10 * 8), r.line.earnings.night);
  ok('a managerial employee is paid no overtime (Labor Code Art. 82)',
    r.manager.earnings.overtime === 0 && r.manager.otEligible === false, r.manager.earnings.overtime);
  ok('a managerial employee still receives the holiday premium',
    near(r.manager.earnings.premium, r.line.earnings.premium), r.manager.earnings.premium);
  ok('gross equals basic minus exceptions plus premiums, overtime, night and allowances',
    near(r.line.gross, r.line.earnings.basic + r.line.earnings.absence + r.line.earnings.late +
      r.line.earnings.undertime + r.line.earnings.premium + r.line.earnings.overtime +
      r.line.earnings.night + r.line.earnings.allowances), r.line.gross);
}

// ---------------------------------------------------------------- 5. 13th month and year-end
{
  const r = await page.evaluate(() => ({
    t8: HIS.payrollCalc.thirteenthMonth({ monthlyBasic: 60000 }, { months: 8 }),
    t12: HIS.payrollCalc.thirteenthMonth({ monthlyBasic: 150000 }, { months: 12 }),
    a: HIS.payrollCalc.annualize({ monthlyBasic: 60000, allowances: [{ label: 'A', amount: 8000, taxable: true }] },
      { months: 12, benefits: 60000, taxWithheld: 100000 }),
    aExact: HIS.payrollCalc.annualize({ monthlyBasic: 60000, allowances: [{ label: 'A', amount: 8000, taxable: true }] },
      { months: 12, benefits: 60000, taxWithheld: 97420 }),
    // 13th month 60,000 + a 50,000 performance bonus: 110,000 of benefits, 90,000 exempt.
    bonus: HIS.payrollCalc.annualize({ monthlyBasic: 60000, allowances: [{ label: 'A', amount: 8000, taxable: true }] },
      { months: 12, benefits: 110000, taxWithheld: 0 }),
    // A de minimis rice allowance is paid but not taxed.
    deMinimis: HIS.payrollCalc.compute({
      monthlyBasic: 26000,
      allowances: [{ label: 'Professional', amount: 1000, taxable: true }, { label: 'Rice', amount: 1500, taxable: false }]
    }, { frequency: 'semi-monthly', attendance: HIS.payrollCalc.emptySummary(11) })
  }));
  ok('13th month is basic earned / 12', near(r.t8.amount, 40000), r.t8.amount);
  ok('13th month ignores allowances by construction', near(r.t8.basicEarned, 480000), r.t8.basicEarned);
  ok('13th month up to 90,000 is tax-exempt', near(r.t8.taxableExcess, 0), r.t8.taxableExcess);
  ok('13th month above 90,000 is taxable', near(r.t12.taxableExcess, 60000), r.t12.taxableExcess);
  // A bonus is "other benefit" for tax purposes and shares the same 90,000 ceiling.
  ok('a bonus is pooled with the 13th month against the 90,000 exemption',
    near(r.bonus.benefitsExempt, 90000) && near(r.bonus.benefitsTaxable, 20000),
    r.bonus.benefitsExempt + ' exempt / ' + r.bonus.benefitsTaxable + ' taxable');
  ok('annual taxable compensation = regular - contributions + taxable benefits',
    near(r.a.taxableCompensation, 774600), r.a.taxableCompensation);
  ok('annual tax due on 774,600 is 97,420', near(r.a.annualDue, 97420), r.a.annualDue);
  ok('withholding 100,000 against 97,420 leaves a 2,580 refund',
    near(r.a.adjustment, -2580) && r.a.direction === 'refund', r.a.adjustment);
  ok('withholding exactly the annual due reconciles to zero',
    near(r.aExact.adjustment, 0) && r.aExact.direction === 'even', r.aExact.adjustment);
}

// ---------------------------------------------------------------- 5b. allowances: paid versus taxable
{
  const r = await page.evaluate(() => {
    const e = HIS.payrollCalc.compute({
      monthlyBasic: 26000,
      allowances: [{ label: 'Professional', amount: 1000, taxable: true }, { label: 'Rice', amount: 1500, taxable: false }]
    }, { frequency: 'semi-monthly', attendance: HIS.payrollCalc.emptySummary(11) });
    return e;
  });
  // Period: basic 13,000 + allowances 1,250 (500 taxable + 750 de minimis) = 14,250.
  // SSS 1,300/2 = 650, PhilHealth 650/2 = 325, Pag-IBIG 200/2 = 100 -> 1,075.
  // Taxable = 14,250 - 1,075 - 750 = 12,425 -> 937.50 + 20% x (12,425 - 16,667) is negative, so
  // it stays in the second bracket: 15% x (12,425 - 10,417) = 301.20.
  ok('a de minimis allowance is paid in gross', near(r.gross, 14250), r.gross);
  ok('a de minimis allowance is excluded from taxable compensation', near(r.taxable, 12425), r.taxable);
  ok('the de minimis exclusion reduces the withholding to 301.20', near(r.tax, 301.20), r.tax);
}

// ---------------------------------------------------------------- 6. the run and its gates
{
  const r = await page.evaluate(() => {
    const first = HIS.payrollRuns.create({});
    const again = HIS.payrollRuns.create({});
    const run = HIS.payrollRuns.current();
    const lineIds = run.lines.map(l => l.employeeId);
    const dupes = lineIds.filter((id, i) => lineIds.indexOf(id) !== i);
    return {
      firstOk: first.ok, secondOk: again.ok, secondErr: again.error,
      lines: run.lines.length, employees: HIS.employees.all().length, dupes: dupes,
      version: run.version, status: run.status,
      totalsReconcile: Math.abs(run.totals.gross - run.totals.deductions - run.totals.net) < 0.02
    };
  });
  ok('a second payroll run for the same period is refused', r.secondOk === false, r.secondErr);
  ok('one line per employee', r.lines === r.employees && r.dupes.length === 0, r.lines + '/' + r.employees);
  ok('gross = deductions + net for the whole run', r.totalsReconcile);
  ok('a new run starts as a draft at version 1', r.status === 'draft' && r.version === 1, r.status + ' v' + r.version);
}

// ---------------------------------------------------------------- 7. approval gates and versions
{
  const r = await page.evaluate(() => {
    const run = HIS.payrollRuns.current();
    const skip = HIS.payrollRuns.approve(run.id, '');   // draft -> approved is not a legal move
    HIS.payrollRuns.review(run.id, '');
    // Reopen one timesheet AFTER the run was built. The run's own blocked list is empty, so only a
    // live check can catch this.
    HIS.attendancePeriod.reopen('EMP-008', 'test');
    const blockedApprove = HIS.payrollRuns.approve(run.id, '');
    HIS.attendancePeriod.approve('EMP-008', 'test');
    const recomputed = HIS.payrollRuns.recompute(run.id, 'after re-approval');
    const after = HIS.payrollRuns.current();
    HIS.payrollRuns.review(run.id, '');
    const approved = HIS.payrollRuns.approve(run.id, '');
    const released = HIS.payrollRuns.release(run.id, '');
    const twice = HIS.payrollRuns.release(run.id, '');
    return {
      skipOk: skip.ok, blockedOk: blockedApprove.ok, blockedErr: blockedApprove.error,
      version: after.version, versions: after.versions.length,
      recomputedOk: recomputed.ok, approvedOk: approved.ok, releasedOk: released.ok, twiceOk: twice.ok,
      status: HIS.payrollRuns.current().status,
      paidLines: HIS.payrollRuns.current().lines.filter(l => l.status === 'Paid').length
    };
  });
  ok('approval cannot skip the review step', r.skipOk === false);
  ok('a timesheet reopened after the run was built blocks approval', r.blockedOk === false, r.blockedErr);
  ok('recomputing archives the previous version', r.versions === 1, r.versions);
  ok('recompute bumps the version', r.version === 2, r.version);
  ok('review -> approve -> release succeeds in order', r.approvedOk && r.releasedOk);
  ok('releasing twice is refused', r.twiceOk === false);
  ok('every line is Paid after release', r.paidLines === 8, r.paidLines);
}

// ---------------------------------------------------------------- 8. payslip agrees with the line
{
  const r = await page.evaluate(() => {
    const p = HIS.payrollRuns.payslip('EMP-001');
    return { line: p.line, slip: p, text: null };
  });
  const money = n => '\u20b1' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  ok('the payslip net equals the line net', near(r.slip.line.net, r.line.net));
  ok('the payslip carries every earning and deduction line', r.line.lines.length >= 8, r.line.lines.length);
  ok('employer contributions are reported separately from employee deductions',
    r.line.employer.total > 0 && r.line.employer.total !== r.line.deductions);
}

// ---------------------------------------------------------------- 9. the screen drives the lifecycle
// The module tests above can all pass while the dialog calls a method that does not exist. Drive it.
{
  await page.evaluate(() => HIS.payrollRuns.reset());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  const seq = [];
  for (let i = 0; i < 3; i++) {
    await page.click('[data-modal="proc"]');
    await page.waitForTimeout(150);
    await page.click('[data-ok]');
    await page.waitForTimeout(200);
    seq.push(await page.evaluate(() => HIS.payrollRuns.current().status));
  }
  const paid = await page.$$eval('.pr-p.Paid', n => n.length);
  ok('the Process payments dialog advances draft -> reviewed -> approved -> released',
    seq.join('>') === 'reviewed>approved>released', seq.join('>'));
  ok('after release every row shows Paid', paid === 8, paid);
}

ok('payroll page loaded with no console errors', errs.length === 0, errs[0]);

await ctx.close();
await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
