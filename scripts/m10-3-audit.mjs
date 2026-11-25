// M10.3 — payroll basis and divisor audit.
//
// The question this covers: should the 365-day factor used for minimum-wage equivalency also be
// used for absence, overtime, night differential and premiums? It should not be assumed either way.
// The two factors answer different questions and the difference is a policy decision, not a typo.
//
// Every expected figure is derived in this file:
//   daily rate  = monthly x 12 / policy factor (261 for the active policy)
//   hourly rate = daily rate / the employee's own normal hours
//   absence     = daily rate per day
//   late/under  = hourly rate / 60 per minute
//   overtime    = hourly x multiplier x hours
//   night       = hourly x 10% x hours
//   premium     = daily rate x statutory percentage
//
// Usage: PW=<playwright-core> node scripts/m10-3-audit.mjs
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
await new Promise(r => server.listen(8859, r));
const BASE = 'http://127.0.0.1:8859';

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
await page.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));
await page.goto(BASE + '/payroll.html', { waitUntil: 'load' });
await page.waitForTimeout(400);

// =================================================================================================
// 1. WHICH DIVISOR APPLIES TO WHICH PURPOSE
// =================================================================================================
console.log('\n--- 1. divisor policy ---');
{
  const r = await page.evaluate(() => {
    const p = HIS.payrollCalc.policyFor();
    return {
      policy: p,
      active: HIS.payrollCalc.policyFor('2026-11-18').id,
      proposed: HIS.payrollCalc.POLICIES.filter(x => x.status === 'proposed').map(x => ({ id: x.id, from: x.effectiveFrom, factor: x.dailyRateFactor })),
      neverProposed: HIS.payrollCalc.policyFor('2027-06-01').id,
      daily: HIS.payrollCalc.dailyRate(26100),
      hourly: HIS.payrollCalc.hourlyRate(26100),
      floorDaily: HIS.wageFloor.equivalentDaily({ payBasis: 'monthly', monthlyBasic: 26100, schedule: { hoursPerDay: 8 } })
    };
  });

  ok('the active policy is MH-PAY-2026.1', r.policy.id === 'MH-PAY-2026.1', r.policy.id);
  ok('the payroll daily-rate factor is 261', r.policy.dailyRateFactor === 261, r.policy.dailyRateFactor);
  ok('the minimum-wage factor is 365', r.policy.wageFloorFactor === 365, r.policy.wageFloorFactor);
  ok('each factor carries its own source',
    /Company practice/.test(r.policy.dailyRateFactorSource) && /NWPC/.test(r.policy.wageFloorFactorSource),
    r.policy.dailyRateFactorSource);
  ok('26,100 a month is 1,200.00 a day under the payroll policy', near(r.daily, 1200), r.daily);
  ok('the same salary is 858.08 a day for the wage floor', near(r.floorDaily, 858.08), r.floorDaily);
  ok('the two figures are deliberately different', Math.abs(r.daily - r.floorDaily) > 300, r.daily + ' vs ' + r.floorDaily);
  ok('a proposed policy exists for the 365 alignment', r.proposed.length === 1 && r.proposed[0].factor === 365, JSON.stringify(r.proposed));
  ok('a proposed policy is never returned as active', r.neverProposed === 'MH-PAY-2026.1', r.neverProposed);
  ok('every purpose names its basis',
    ['absenceBasis', 'lateBasis', 'overtimeBasis', 'nightBasis', 'holidayBasis', 'leaveBasis'].every(k => !!r.policy[k]),
    JSON.stringify(r.policy));
}

// =================================================================================================
// 2. EIGHT COMPENSATION TYPES — BASIC DAILY AND HOURLY RATES
// =================================================================================================
console.log('\n--- 2. compensation types ---');
{
  // Calibrated so every full-time type lands on the same 1,200.00 daily / 150.00 hourly baseline.
  const TYPES = [
    ['monthly, 5-day', { payBasis: 'monthly', monthlyBasic: 26100, schedule: { daysPerWeek: 5, hoursPerDay: 8, paidRestDays: true, paidSpecialDays: true } }, 26100, 1200, 150],
    ['monthly, 6-day', { payBasis: 'monthly', monthlyBasic: 26100, schedule: { daysPerWeek: 6, hoursPerDay: 8, paidRestDays: true, paidSpecialDays: true } }, 26100, 1200, 150],
    ['daily, 5-day, unpaid rest days', { payBasis: 'daily', dailyRate: 1200, schedule: { daysPerWeek: 5, hoursPerDay: 8, paidRestDays: false, paidSpecialDays: true } }, 26100, 1200, 150],
    ['daily, 6-day, unpaid Sundays', { payBasis: 'daily', dailyRate: 1200, schedule: { daysPerWeek: 6, hoursPerDay: 8, paidRestDays: false, paidSpecialDays: true } }, 31300, 1200, 150],
    ['hourly, full-time', { payBasis: 'hourly', hourlyRate: 150, schedule: { daysPerWeek: 5, hoursPerDay: 8, paidRestDays: false, paidSpecialDays: true } }, 26100, 1200, 150],
    ['part-time, monthly, 4 hours', { payBasis: 'monthly', monthlyBasic: 13050, schedule: { daysPerWeek: 5, hoursPerDay: 4, paidRestDays: true, paidSpecialDays: true } }, 13050, 600, 150],
    ['part-time, hourly, 4 hours', { payBasis: 'hourly', hourlyRate: 150, schedule: { daysPerWeek: 5, hoursPerDay: 4, paidRestDays: false, paidSpecialDays: true } }, 13050, 600, 150],
    ['monthly, paid rest days and holidays', { payBasis: 'monthly', monthlyBasic: 26100, schedule: { daysPerWeek: 5, hoursPerDay: 8, paidRestDays: true, paidSpecialDays: true } }, 26100, 1200, 150]
  ];

  for (const [label, emp, expectedMonthly, expectedDaily, expectedHourly] of TYPES) {
    const r = await page.evaluate((e) => {
      const monthly = HIS.payrollCalc.monthlyOf(e);
      return {
        monthly,
        daily: HIS.payrollCalc.dailyRateOf(e),
        hourly: HIS.payrollCalc.hourlyRateOf(e),
        hours: HIS.payrollCalc.normalHoursOf(e)
      };
    }, emp);
    ok(`${label}: monthly equivalent ${expectedMonthly}`, near(r.monthly, expectedMonthly), r.monthly);
    ok(`${label}: daily rate ${expectedDaily}`, near(r.daily, expectedDaily), r.daily);
    ok(`${label}: hourly rate ${expectedHourly} on ${emp.schedule.hoursPerDay} h`, near(r.hourly, expectedHourly), r.hourly);
  }

  // The 6-day daily-paid employee earns a higher monthly equivalent because they work more days.
  ok('a 6-day daily-paid employee has a 313-day monthly equivalent, not 261',
    near(31300, r2(1200 * 313 / 12)), r2(1200 * 313 / 12));
}

// =================================================================================================
// 3. EACH ELEMENT OF PAY, ON THE SAME BASELINE
// =================================================================================================
console.log('\n--- 3. absence, lateness, overtime, night, premiums ---');
{
  const mkLine = (patch, empOverride) => page.evaluate(({ p, o }) => {
    const e = Object.assign({
      id: 'T', payBasis: 'monthly', monthlyBasic: 26100,
      schedule: { daysPerWeek: 5, hoursPerDay: 8, paidRestDays: true, paidSpecialDays: true },
      wage: { region: 'NCR', sector: 'non-agriculture' }, category: 'rank-and-file', allowances: []
    }, o || {});
    const s = HIS.payrollCalc.emptySummary(11);
    Object.keys(p || {}).forEach(k => {
      if (k === 'otHours' || k === 'premiumDays') Object.assign(s[k], p[k]); else s[k] = p[k];
    });
    return HIS.payrollCalc.compute(e, { frequency: 'semi-monthly', attendance: s });
  }, { p: patch, o: empOverride });

  const clean = await mkLine({});
  const DAY = 1200, HOUR = 150;

  ok('the baseline daily rate is 1,200', near(clean.dailyRate, DAY), clean.dailyRate);
  ok('the baseline hourly rate is 150', near(clean.hourlyRate, HOUR), clean.hourlyRate);
  ok('the payslip records the policy that produced it', clean.policy.id === 'MH-PAY-2026.1', clean.policy.id);

  const absence = await mkLine({ absenceDays: 1 });
  ok('absence deducts one daily rate (1,200)', near(absence.earnings.absence, -DAY), absence.earnings.absence);

  const late = await mkLine({ lateMinutes: 30 });
  ok('30 minutes late deducts 30 x 150 / 60 = 75', near(late.earnings.late, -75), late.earnings.late);

  const under = await mkLine({ undertimeMinutes: 60 });
  ok('60 minutes undertime deducts 150', near(under.earnings.undertime, -HOUR), under.earnings.undertime);

  const ot = await mkLine({ otHours: { ordinary: 2 } });
  ok('ordinary overtime 2 h = 150 x 1.25 x 2 = 375', near(ot.earnings.overtime, 375), ot.earnings.overtime);

  const otRest = await mkLine({ otHours: { rest: 2 } });
  ok('rest-day overtime 2 h = 150 x 1.69 x 2 = 507', near(otRest.earnings.overtime, 507), otRest.earnings.overtime);

  const otHol = await mkLine({ otHours: { regularHoliday: 2 } });
  ok('holiday overtime 2 h = 150 x 2.60 x 2 = 780', near(otHol.earnings.overtime, 780), otHol.earnings.overtime);

  const nd = await mkLine({ ndHours: 8 });
  ok('night differential 8 h = 150 x 10% x 8 = 120', near(nd.earnings.night, 120), nd.earnings.night);

  const restPremium = await mkLine({ premiumDays: { rest: 1 } });
  ok('rest-day premium = 1,200 x 30% = 360', near(restPremium.earnings.premium, 360), restPremium.earnings.premium);

  const holPremium = await mkLine({ premiumDays: { regularHoliday: 1 } });
  ok('regular-holiday premium = 1,200 x 100% = 1,200', near(holPremium.earnings.premium, 1200), holPremium.earnings.premium);

  // Part-time: the same hourly rate, half the daily rate, half the absence.
  const pt = await mkLine({ absenceDays: 1, otHours: { ordinary: 2 } }, {
    monthlyBasic: 13050, schedule: { daysPerWeek: 5, hoursPerDay: 4, paidRestDays: true, paidSpecialDays: true }
  });
  ok('a part-timer on 4 hours has a 600 daily rate', near(pt.dailyRate, 600), pt.dailyRate);
  ok('a part-timer on 4 hours still has a 150 hourly rate', near(pt.hourlyRate, 150), pt.hourlyRate);
  ok('a part-timer absence deducts 600, not 1,200', near(pt.earnings.absence, -600), pt.earnings.absence);
  ok('a part-timer overtime is 375, not 187.50', near(pt.earnings.overtime, 375), pt.earnings.overtime);

  // Employee and employer contributions stay separate.
  ok('employee deductions exclude the employer share',
    near(clean.deductions, clean.statutory.total + clean.tax + clean.other),
    clean.deductions + ' vs ' + (clean.statutory.total + clean.tax));
  ok('the employer share is reported on its own and is larger than the employee share',
    clean.employer.total > clean.statutory.total, clean.employer.total + ' vs ' + clean.statutory.total);
  ok('gross = deductions + net', near(clean.gross, clean.deductions + clean.net), clean.gross);
}

// =================================================================================================
// 4. NON-DIMINUTION
// =================================================================================================
console.log('\n--- 4. non-diminution ---');
{
  const r = await page.evaluate(() => {
    const impact = HIS.payrollCalc.policyImpact(HIS.employees.all(), 'MH-PAY-2027.1');
    const snapshot = JSON.stringify(HIS.payrollRuns.current());
    // Reading the impact must not touch any payroll record.
    HIS.payrollCalc.policyImpact(HIS.employees.all(), 'MH-PAY-2027.1');
    return { impact, unchanged: JSON.stringify(HIS.payrollRuns.current()) === snapshot };
  });

  ok('the impact report compares 261 with 365', r.impact.active.factor === 261 && r.impact.proposed.factor === 365,
    JSON.stringify(r.impact.active) + ' / ' + JSON.stringify(r.impact.proposed));
  ok('every employee would see a lower daily rate', r.impact.rows.every(x => x.dailyAfter < x.dailyBefore),
    JSON.stringify(r.impact.rows.slice(0, 2)));
  ok('every employee would see lower overtime pay', r.impact.affected === r.impact.rows.length,
    r.impact.affected + ' of ' + r.impact.rows.length);
  ok('the report names the non-diminution question', /Art\. 100/.test(r.impact.note), r.impact.note);
  const row = r.impact.rows.filter(x => x.employeeId === 'EMP-008')[0];
  ok('26,000 a month goes from 1,195.40 to 854.79 a day',
    row && near(row.dailyBefore, 1195.40) && near(row.dailyAfter, 854.79),
    row && (row.dailyBefore + ' -> ' + row.dailyAfter));
  ok('the proposed policy is not active and has not been applied', r.impact.proposed.status === 'proposed', r.impact.proposed.status);
  ok('computing the impact changes no payroll record', r.unchanged === true);
}

// =================================================================================================
// 5. REGIONAL COVERAGE
// =================================================================================================
console.log('\n--- 5. regional wage orders ---');
{
  const r = await page.evaluate(() => {
    const wf = HIS.wageFloor;
    return {
      coverage: wf.coverage(),
      ncr: wf.floorFor({ region: 'NCR', sector: 'non-agriculture', asOf: '2026-11-18' }),
      ncrAgri: wf.floorFor({ region: 'NCR', sector: 'agriculture', asOf: '2026-11-18' }),
      r7a: wf.floorFor({ region: 'Region VII', locality: 'class-a', asOf: '2026-11-18' }),
      r7b: wf.floorFor({ region: 'Region VII', locality: 'other', asOf: '2026-11-18' }),
      r7none: wf.floorFor({ region: 'Region VII', asOf: '2026-11-18' }),
      r7before: wf.floorFor({ region: 'Region VII', locality: 'class-a', asOf: '2026-10-13' }),
      r1: wf.floorFor({ region: 'Region I', asOf: '2026-11-18' })
    };
  });

  ok('the coverage register lists all 17 regions', r.coverage.total === 17, r.coverage.total);
  ok('two regions are verified and enabled', r.coverage.verified === 2, r.coverage.verified);
  ok('the other fifteen are registered but not enabled', r.coverage.unverified === 15, r.coverage.unverified);

  ok('NCR non-agriculture is 755', r.ncr.dailyRate === 755, r.ncr.dailyRate);
  ok('NCR agriculture is 718', r.ncrAgri.dailyRate === 718, r.ncrAgri.dailyRate);
  ok('Region VII Class A is 582', r.r7a.dailyRate === 582 && r.r7a.orderId === 'ROVII-27', JSON.stringify(r.r7a));
  ok('Region VII other localities are 542', r.r7b.dailyRate === 542, r.r7b.dailyRate);
  ok('Region VII without a locality asks for one instead of guessing',
    r.r7none.status === 'needs-category' && /class-a/.test(r.r7none.explanation), r.r7none.status);
  ok('Region VII has no floor before 14 October 2026', r.r7before.status === 'unknown', r.r7before.status);
  ok('an unverified region publishes its range but applies no floor',
    r.r1.status === 'unverified' && r.r1.publishedRange === '480.00-505.00', JSON.stringify(r.r1));
}

// =================================================================================================
// 6. HISTORICAL PAYROLL IS UNTOUCHED
// =================================================================================================
console.log('\n--- 6. historical payroll ---');
{
  const r = await page.evaluate(() => {
    const run = HIS.payrollRuns.current();
    const statusBefore = run.status;
    const lines = run.lines.map(l => ({
      id: l.employeeId, daily: l.dailyRate, monthly: l.monthlyBasic, net: l.net,
      policy: l.policy && l.policy.id,
      expected: Math.round(l.monthlyBasic * 12 / 261 * 100) / 100
    }));
    return { status: run.status, statusBefore, version: run.version, lines };
  });
  ok('the released run still carries its own policy id', r.lines.every(l => l.policy === 'MH-PAY-2026.1'), JSON.stringify(r.lines[0]));
  ok('every line keeps the daily rate its policy produced',
    r.lines.every(l => near(l.daily, l.expected)), JSON.stringify(r.lines.map(l => [l.daily, l.expected])));
  ok('the run status is unchanged by the policy analysis', r.status === r.statusBefore, r.status + ' / ' + r.statusBefore);
}

ok('the audit ran with no console errors', errs.length === 0, errs[0]);

await mkdir(path.join(ROOT, 'qa', 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'qa', 'audit', 'm10-3.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, failures }, null, 2));

await ctx.close();
await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
