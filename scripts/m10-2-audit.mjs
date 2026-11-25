// M10.2 — wage-conversion audit.
//
// The defect this covers: M10.1 divided every monthly salary by 261, the factor for a daily-paid
// employee who is not paid on Saturdays and Sundays. For a monthly-paid employee that overstates the
// daily equivalent by ~40%, so underpaid staff passed the floor check.
//
// Every expected figure below is computed in this file from the NWPC formulas, not read back from
// the application:
//     monthly-paid      daily equivalent = monthly x 12 / 365
//     daily-paid        EMR = daily x factor / 12
//     factor            393.50 (every day) / 313 (no Sundays) / 310 (same, special days unpaid)
//                       261 (no weekends) / 258 (same, special days unpaid)
//     hourly-paid       daily equivalent = hourly x normal hours
//     part-time         floor prorated to the employee's normal hours (floor x h / 8)
//
// Usage: PW=<playwright-core> node scripts/m10-2-audit.mjs
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
await new Promise(r => server.listen(8858, r));
const BASE = 'http://127.0.0.1:8858';

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

// ---- independent reference ---------------------------------------------------------------
const FLOOR = 755;
const FLOOR_AGRI = 718;
const dailyOfMonthly = m => r2(m * 12 / 365);
const emrOfDaily = (d, factor) => r2(d * factor / 12);
const F = { everyDay: 393.50, noSunday: 313, noSundayNoSpecial: 310, noWeekend: 261, noWeekendNoSpecial: 258 };

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));
await page.goto(BASE + '/payroll.html', { waitUntil: 'load' });
await page.waitForTimeout(400);

const mk = (o) => page.evaluate((cfg) => {
  const e = Object.assign({
    id: 'T', payBasis: 'monthly', monthlyBasic: 0,
    schedule: { daysPerWeek: 5, hoursPerDay: 8, paidRestDays: true, paidSpecialDays: true },
    wage: { region: 'NCR', sector: 'non-agriculture' }
  }, cfg);
  return HIS.wageFloor.check(e, cfg.asOf || '2026-09-26');
}, o);

// =================================================================================================
// 1. MONTHLY-PAID — the 365 factor
// =================================================================================================
console.log('\n--- 1. monthly-paid (365) ---');
{
  const salaries = [16000, 20000, 22000, 22964.58, 22964, 23000, 26100, 35000];
  for (const m of salaries) {
    const r = await mk({ monthlyBasic: m });
    const expectedDaily = dailyOfMonthly(m);
    ok(`monthly ${m.toFixed(2)}: daily equivalent ${expectedDaily.toFixed(2)}`,
      near(r.equivalentDaily, expectedDaily), r.equivalentDaily);
    const shouldPass = expectedDaily + 0.005 >= FLOOR;
    ok(`monthly ${m.toFixed(2)}: ${shouldPass ? 'clears' : 'fails'} the 755 floor`,
      (r.status === 'ok') === shouldPass, r.status + ' at ' + r.equivalentDaily);
  }

  const boundary = await mk({ monthlyBasic: 22964.58 });
  ok('22,964.58 is exactly the monthly equivalent of 755 a day',
    near(boundary.equivalentDaily, 755) && boundary.status === 'ok', boundary.equivalentDaily);

  const justUnder = await mk({ monthlyBasic: 22964 });
  ok('22,964 is one centavo a day short and fails', justUnder.status === 'below', justUnder.status);

  // The defect, stated as a number: 20,000 passes under 261 and fails under 365.
  const wrong261 = r2(20000 * 12 / 261);
  const right365 = dailyOfMonthly(20000);
  ok('the old 261 factor reported 20,000 at 919.54 a day', near(wrong261, 919.54), wrong261);
  ok('the correct 365 factor reports 657.53 a day', near(right365, 657.53), right365);
  ok('20,000 flips from pass to fail once the factor is right',
    wrong261 >= FLOOR && right365 < FLOOR, wrong261 + ' / ' + right365);

  const shift = await mk({ monthlyBasic: 20000 });
  ok('the check reports the factor it used', shift.factor === 365, shift.factor);
  ok('the explanation names the monthly-paid basis', /Monthly-paid equivalent/.test(shift.explanation), shift.explanation);
}

// =================================================================================================
// 2. DAILY-PAID — 393.50 / 313 / 310 / 261 / 258
// =================================================================================================
console.log('\n--- 2. daily-paid factors ---');
{
  const cases = [
    ['5-day week (261)', { payBasis: 'daily', dailyRate: 755, schedule: { daysPerWeek: 5, hoursPerDay: 8, paidSpecialDays: true } }, F.noWeekend],
    ['5-day week, special days unpaid (258)', { payBasis: 'daily', dailyRate: 755, schedule: { daysPerWeek: 5, hoursPerDay: 8, paidSpecialDays: false } }, F.noWeekendNoSpecial],
    ['6-day week (313)', { payBasis: 'daily', dailyRate: 755, schedule: { daysPerWeek: 6, hoursPerDay: 8, paidSpecialDays: true } }, F.noSunday],
    ['6-day week, special days unpaid (310)', { payBasis: 'daily', dailyRate: 755, schedule: { daysPerWeek: 6, hoursPerDay: 8, paidSpecialDays: false } }, F.noSundayNoSpecial],
    ['every day including rest days (393.50)', { payBasis: 'daily', dailyRate: 755, schedule: { daysPerWeek: 7, hoursPerDay: 8, paidSpecialDays: true } }, F.everyDay]
  ];
  for (const [label, cfg, factor] of cases) {
    const r = await mk(cfg);
    ok(`daily ${label}: factor ${factor}`, r.factor === factor, r.factor);
    ok(`daily ${label}: EMR ${emrOfDaily(755, factor)}`, near(r.equivalentMonthly, emrOfDaily(755, factor)), r.equivalentMonthly);
    ok(`daily ${label}: a 755 rate clears the floor`, r.status === 'ok', r.status);
  }

  const atFloor = await mk({ payBasis: 'daily', dailyRate: 755 });
  ok('a daily rate of exactly 755 passes', atFloor.status === 'ok', atFloor.status);
  const under = await mk({ payBasis: 'daily', dailyRate: 754.99 });
  ok('a daily rate of 754.99 fails by one centavo', under.status === 'below', under.status);
  ok('the daily shortfall is 0.01', near(under.shortfall, 0.01), under.shortfall);

  const agri = await mk({ payBasis: 'daily', dailyRate: 718, wage: { region: 'NCR', sector: 'agriculture' } });
  ok('718 a day clears the agriculture floor', agri.status === 'ok' && agri.floor.dailyRate === FLOOR_AGRI,
    agri.status + ' / ' + agri.floor.dailyRate);

  // Part-time daily: the floor is prorated to the normal hours.
  const pt = await mk({ payBasis: 'daily', dailyRate: 377.50, schedule: { daysPerWeek: 5, hoursPerDay: 4, paidSpecialDays: true } });
  ok('a 4-hour daily rate of 377.50 clears the prorated floor of 377.50',
    pt.status === 'ok' && near(pt.floorForHours, 377.50), pt.status + ' / ' + pt.floorForHours);
  const ptUnder = await mk({ payBasis: 'daily', dailyRate: 377.49, schedule: { daysPerWeek: 5, hoursPerDay: 4, paidSpecialDays: true } });
  ok('a 4-hour daily rate of 377.49 fails', ptUnder.status === 'below', ptUnder.status);
}

// =================================================================================================
// 3. HOURLY-PAID
// =================================================================================================
console.log('\n--- 3. hourly-paid ---');
{
  const ok8 = await mk({ payBasis: 'hourly', hourlyRate: 94.375 });
  ok('94.375 an hour x 8 = 755 clears the floor', ok8.status === 'ok' && near(ok8.equivalentDaily, 755), ok8.equivalentDaily);
  const under8 = await mk({ payBasis: 'hourly', hourlyRate: 94.37 });
  ok('94.37 an hour x 8 = 754.96 fails', under8.status === 'below', under8.status);
  const pt = await mk({ payBasis: 'hourly', hourlyRate: 94.375, schedule: { daysPerWeek: 5, hoursPerDay: 4, paidSpecialDays: true } });
  ok('94.375 an hour for 4 hours clears the prorated floor', pt.status === 'ok', pt.status);
  const low = await mk({ payBasis: 'hourly', hourlyRate: 50, schedule: { daysPerWeek: 5, hoursPerDay: 4, paidSpecialDays: true } });
  ok('50 an hour for 4 hours fails', low.status === 'below', low.status);
}

// =================================================================================================
// 4. THE SCHEDULE MUST NOT CHANGE A MONTHLY-PAID EMPLOYEE'S FACTOR
// =================================================================================================
console.log('\n--- 4. factor follows the basis, not the schedule ---');
{
  for (const days of [5, 6, 7]) {
    const r = await mk({ monthlyBasic: 23000, schedule: { daysPerWeek: days, hoursPerDay: 8, paidSpecialDays: true } });
    ok(`a monthly-paid employee on a ${days}-day schedule still uses 365`, r.factor === 365, r.factor);
    ok(`monthly 23,000 on ${days} days still clears the floor`, r.status === 'ok', r.status);
  }
  const d5 = await mk({ payBasis: 'daily', dailyRate: 755, schedule: { daysPerWeek: 5, hoursPerDay: 8 } });
  const d6 = await mk({ payBasis: 'daily', dailyRate: 755, schedule: { daysPerWeek: 6, hoursPerDay: 8 } });
  ok('a daily-paid 6-day employee has a higher EMR than a 5-day one',
    d6.equivalentMonthly > d5.equivalentMonthly, d5.equivalentMonthly + ' vs ' + d6.equivalentMonthly);
  ok('both clear the same daily floor', d5.status === 'ok' && d6.status === 'ok');
}

// =================================================================================================
// 5. WAGE ORDERS AND EFFECTIVE DATES
// =================================================================================================
console.log('\n--- 5. effective-dated orders ---');
{
  const before = await mk({ monthlyBasic: 23000, asOf: '2026-09-25' });
  const onDay = await mk({ monthlyBasic: 23000, asOf: '2026-09-26' });
  const jan = await mk({ monthlyBasic: 23000, asOf: '2027-01-20' });
  const other = await mk({ monthlyBasic: 23000, asOf: '2026-09-26', wage: { region: 'Region I', sector: 'non-agriculture' } });

  ok('25 September 2026 has no order in force', before.status === 'unknown', before.status);
  ok('26 September 2026 applies NCR-28 at 755', onDay.floor.orderId === 'NCR-28' && onDay.floor.dailyRate === 755,
    JSON.stringify(onDay.floor));
  ok('20 January 2027 still applies 755, not the suspended tranche', jan.floor.dailyRate === 755, jan.floor.dailyRate);
  ok('an unverified region refuses rather than borrowing a rate', other.status === 'unverified', other.status);

  const added = await page.evaluate(() => {
    const r = HIS.wageFloor.addOrder({ id: 'R13-TEST', region: 'Region XIII', sector: 'non-agriculture', dailyRate: 600, effectiveFrom: '2026-01-01' });
    const check = HIS.wageFloor.check({
      id: 'T', payBasis: 'monthly', monthlyBasic: 20000,
      schedule: { daysPerWeek: 5, hoursPerDay: 8 }, wage: { region: 'Region XIII', sector: 'non-agriculture' }
    }, '2026-09-26');
    return { ok: r.ok, status: check.status, floor: check.floor.dailyRate };
  });
  ok('a configured order is applied for its region', added.ok && added.floor === 600, JSON.stringify(added));
  ok('the same 20,000 passes in a region with a lower floor', added.status === 'ok', added.status);
}

// =================================================================================================
// 6. EXEMPTIONS
// =================================================================================================
console.log('\n--- 6. exemptions ---');
{
  const withRef = await mk({
    monthlyBasic: 20000,
    wage: { region: 'NCR', sector: 'non-agriculture', exemption: { code: 'DISTRESSED', reference: 'DOLE-EX-2026-021' } }
  });
  ok('a below-floor rate with an exemption and a reference is exempt', withRef.status === 'exempt', withRef.status);
  const noRef = await mk({
    monthlyBasic: 20000,
    wage: { region: 'NCR', sector: 'non-agriculture', exemption: { code: 'DISTRESSED', reference: '' } }
  });
  ok('an exemption without a reference is not an exemption', noRef.status === 'below', noRef.status);
  const atFloor = await mk({
    monthlyBasic: 23000,
    wage: { region: 'NCR', sector: 'non-agriculture', exemption: { code: 'X', reference: 'Y' } }
  });
  ok('an exemption does not turn a compliant rate into an exempt one', atFloor.status === 'ok', atFloor.status);
}

// =================================================================================================
// 7. PAYROLL INTEGRATION
// =================================================================================================
console.log('\n--- 7. payroll integration ---');
{
  const r = await page.evaluate(() => {
    const daily = {
      id: 'D-1', name: 'Daily Paid', payBasis: 'daily', dailyRate: 755,
      schedule: { daysPerWeek: 5, hoursPerDay: 8, paidRestDays: false, paidSpecialDays: true },
      wage: { region: 'NCR', sector: 'non-agriculture' }, category: 'rank-and-file', allowances: []
    };
    const monthly = HIS.payrollCalc.monthlyOf(daily);
    const line = HIS.payrollCalc.compute(daily, { frequency: 'semi-monthly', attendance: HIS.payrollCalc.emptySummary(11) });
    return { monthly, basic: line.earnings.basic, sss: line.statutory.sss, net: line.net };
  });
  // 755 x 261 / 12 = 16,421.25; half of that is 8,210.63.
  ok('a daily-paid employee converts to a monthly equivalent of 16,421.25', near(r.monthly, 16421.25), r.monthly);
  ok('the semi-monthly basic is half of that, 8,210.63', near(r.basic, 8210.63), r.basic);
  // SSS on 16,421.25 -> MSC 16,500 x 5% = 825/mo -> 412.50 a period.
  ok('statutory contributions are keyed on the equivalent monthly rate', near(r.sss, 412.50), r.sss);

  const gate = await page.evaluate(() => {
    const realAll = HIS.employees.all;
    const fake = Object.assign({}, realAll()[0], {
      id: 'EMP-001', payBasis: 'monthly', monthlyBasic: 20000,
      schedule: { daysPerWeek: 5, hoursPerDay: 8 }, wage: { region: 'NCR', sector: 'non-agriculture' }
    });
    HIS.employees.all = function () { return [fake]; };
    const problems = HIS.payrollRuns.wageProblems({ payDate: '2026-10-01' });
    HIS.employees.all = realAll;
    return problems;
  });
  ok('the payroll gate blocks a monthly-paid rate of 20,000 under NCR-28',
    gate.length === 1 && /below the NCR-28 floor/.test(gate[0]), JSON.stringify(gate));
}

// =================================================================================================
// 8. PAG-IBIG PRESERVED
// =================================================================================================
console.log('\n--- 8. Pag-IBIG unchanged ---');
{
  const r = await page.evaluate(() => ({
    e1500: HIS.payrollCalc.pagibigMonthly(1500),
    e1501: HIS.payrollCalc.pagibigMonthly(1501),
    e10000: HIS.payrollCalc.pagibigMonthly(10000),
    e10001: HIS.payrollCalc.pagibigMonthly(10001),
    er1000: HIS.payrollCalc.pagibigEmployerMonthly(1000),
    cfg: HIS.payrollCalc.CONFIG.pagibig
  }));
  ok('Pag-IBIG 1,500 still pays 1% = 15', near(r.e1500, 15), r.e1500);
  ok('Pag-IBIG 1,501 still pays 2% = 30.02', near(r.e1501, 30.02), r.e1501);
  ok('Pag-IBIG caps at 200 from 10,000', near(r.e10000, 200) && near(r.e10001, 200));
  ok('the employer share is still 2% with no tier', near(r.er1000, 20), r.er1000);
  ok('the statutory basis is still recorded', /RA 9679/.test(r.cfg.source), r.cfg.source);
}

// =================================================================================================
// 9. THE DEMO EMPLOYEES
// =================================================================================================
{
  const r = await page.evaluate(() => HIS.employees.all().map(e => {
    const c = HIS.wageFloor.check(e, '2026-09-26');
    return { id: e.id, basis: c.basis, daily: c.equivalentDaily, status: c.status, factor: c.factor };
  }));
  ok('every demo employee is classified as monthly-paid', r.every(x => x.basis === 'monthly'), JSON.stringify(r.map(x => x.basis)));
  ok('every demo employee clears the 755 floor on a date where it applies', r.every(x => x.status === 'ok'),
    JSON.stringify(r.filter(x => x.status !== 'ok')));
  ok('the lowest demo daily equivalent is 26,000 x 12 / 365 = 854.79',
    near(Math.min.apply(null, r.map(x => x.daily)), 854.79), Math.min.apply(null, r.map(x => x.daily)));
}

ok('the audit ran with no console errors', errs.length === 0, errs[0]);

await mkdir(path.join(ROOT, 'qa', 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'qa', 'audit', 'm10-2.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, failures }, null, 2));

await ctx.close();
await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
