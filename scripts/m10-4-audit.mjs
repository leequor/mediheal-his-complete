// M10.4 — overtime classification, absence basis and work-hours audit.
//
// The defect this covers: every hour past an employee's schedule was priced as statutory overtime.
// Article 87 puts the overtime threshold at eight hours in the day, so a part-timer who works six
// hours on a four-hour schedule has worked two ADDITIONAL hours, not two overtime hours.
//
// Expected figures are derived here from the classification, not read back from the engine.
//
// Usage: PW=<playwright-core> node scripts/m10-4-audit.mjs
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
await new Promise(r => server.listen(8860, r));
const BASE = 'http://127.0.0.1:8860';

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
await page.goto(BASE + '/payroll.html', { waitUntil: 'load' });
await page.waitForTimeout(400);

// =================================================================================================
// 1. CLASSIFICATION: SCHEDULE IS NOT THE OVERTIME THRESHOLD
// =================================================================================================
console.log('\n--- 1. additional hours versus statutory overtime ---');
{
  const r = await page.evaluate(() => {
    const rec = (shiftStart, shiftEnd, timeIn, timeOut, dayType, breakMinutes) => ({
      shiftStart, shiftEnd, timeIn, timeOut, breakMinutes: breakMinutes || 0,
      dayType: dayType || 'regular', worked: !!timeIn && !!timeOut
    });
    const c = (a) => HIS.attendancePeriod.classify(a);
    return {
      four: c(rec('08:00', '12:00', '08:00', '12:00')),
      six: c(rec('08:00', '12:00', '08:00', '14:00')),
      eight: c(rec('08:00', '12:00', '08:00', '16:00')),
      nine: c(rec('08:00', '12:00', '08:00', '17:00')),
      full8: c(rec('08:00', '17:00', '08:00', '19:00', 'regular', 60)),
      rest9: c(rec('08:00', '17:00', '08:00', '18:00', 'rest', 60)),
      hol9: c(rec('08:00', '17:00', '08:00', '18:00', 'regular-holiday', 60)),
      absent: c(rec('08:00', '12:00', null, null))
    };
  });

  ok('4 h on a 4 h schedule: 4 ordinary, 0 additional, 0 overtime',
    r.four.ordinary === 4 && r.four.additional === 0 && r.four.ot === 0, JSON.stringify(r.four));
  ok('6 h on a 4 h schedule: 4 ordinary + 2 additional, 0 overtime',
    r.six.ordinary === 4 && r.six.additional === 2 && r.six.ot === 0, JSON.stringify(r.six));
  ok('8 h on a 4 h schedule: 4 ordinary + 4 additional, 0 overtime',
    r.eight.ordinary === 4 && r.eight.additional === 4 && r.eight.ot === 0, JSON.stringify(r.eight));
  ok('9 h on a 4 h schedule: 1 statutory overtime hour, not 5',
    r.nine.ot === 1 && r.nine.additional === 4 && r.nine.ordinary === 4, JSON.stringify(r.nine));
  ok('10 h on an 8 h schedule: 8 ordinary + 2 overtime, 0 additional',
    r.full8.ordinary === 8 && r.full8.additional === 0 && r.full8.ot === 2, JSON.stringify(r.full8));

  ok('9 h on a rest day: 8 rest hours + 1 rest-day overtime',
    r.rest9.rest === 8 && r.rest9.restOt === 1 && r.rest9.ot === 0, JSON.stringify(r.rest9));
  ok('9 h on a holiday: 8 holiday hours + 1 holiday overtime',
    r.hol9.holiday === 8 && r.hol9.holidayOt === 1 && r.hol9.ot === 0, JSON.stringify(r.hol9));
  ok('an absence classifies as no hours at all',
    r.absent.ordinary === 0 && r.absent.additional === 0 && r.absent.ot === 0, JSON.stringify(r.absent));
}

// =================================================================================================
// 2. THE PART-TIMER'S PAY
// =================================================================================================
console.log('\n--- 2. part-time pay ---');
{
  const r = await page.evaluate(() => {
    const emp = {
      id: 'PT-1', name: 'Part-time', payBasis: 'monthly', monthlyBasic: 13050,
      schedule: { daysPerWeek: 5, hoursPerDay: 4, paidRestDays: true, paidSpecialDays: true },
      wage: { region: 'NCR', sector: 'non-agriculture' }, category: 'rank-and-file', allowances: []
    };
    const line = (patch) => {
      const s = HIS.payrollCalc.emptySummary(0);
      s.scheduledDays = 1; s.workedDays = 1;
      Object.keys(patch).forEach(k => {
        if (k === 'otHours') Object.assign(s.otHours, patch[k]); else s[k] = patch[k];
      });
      return HIS.payrollCalc.compute(emp, { frequency: 'semi-monthly', attendance: s });
    };
    return {
      hourly: HIS.payrollCalc.hourlyRateOf(emp),
      daily: HIS.payrollCalc.dailyRateOf(emp),
      four: line({ ordinaryHours: 4 }),
      six: line({ ordinaryHours: 4, additionalHours: 2 }),
      eight: line({ ordinaryHours: 4, additionalHours: 4 }),
      nine: line({ ordinaryHours: 4, additionalHours: 4, otHours: { ordinary: 1 } }),
      fullDayChange: (function () {
        const wider = Object.assign({}, emp, { schedule: { daysPerWeek: 5, hoursPerDay: 8 } });
        return HIS.payrollCalc.hourlyRateOf(wider);
      })()
    };
  });

  ok('the part-timer daily rate is 600', near(r.daily, 600), r.daily);
  ok('the part-timer hourly rate is 150 on a four-hour day', near(r.hourly, 150), r.hourly);
  ok('the period basic is 6,525', near(r.four.earnings.basic, 6525), r.four.earnings.basic);
  ok('four hours pay no additional and no overtime',
    r.four.earnings.additional === 0 && r.four.earnings.overtime === 0, JSON.stringify(r.four.earnings));
  ok('two additional hours pay 2 x 150 = 300, not 375',
    near(r.six.earnings.additional, 300) && r.six.earnings.overtime === 0,
    r.six.earnings.additional + ' / ' + r.six.earnings.overtime);
  ok('four additional hours pay 600 and still no overtime',
    near(r.eight.earnings.additional, 600) && r.eight.earnings.overtime === 0,
    r.eight.earnings.additional + ' / ' + r.eight.earnings.overtime);
  ok('the ninth hour is the first overtime hour: 150 x 1.25 = 187.50',
    near(r.nine.earnings.overtime, 187.50), r.nine.earnings.overtime);
  ok('gross rises by exactly the additional and overtime pay',
    near(r.nine.gross - r.four.gross, 600 + 187.50), r.nine.gross - r.four.gross);
  ok('the schedule change does not change the eight-hour threshold',
    near(r.fullDayChange, 75) && r.nine.earnings.overtime === 187.50,
    'hourly at 8 h would be ' + r.fullDayChange);
}

// =================================================================================================
// 3. FULL-TIME OVERTIME IS UNCHANGED
// =================================================================================================
console.log('\n--- 3. full-time overtime ---');
{
  const r = await page.evaluate(() => {
    const emp = {
      id: 'FT-1', payBasis: 'monthly', monthlyBasic: 26100,
      schedule: { daysPerWeek: 5, hoursPerDay: 8 }, wage: { region: 'NCR', sector: 'non-agriculture' },
      category: 'rank-and-file', allowances: []
    };
    const s = HIS.payrollCalc.emptySummary(0);
    s.scheduledDays = 1; s.workedDays = 1; s.ordinaryHours = 8;
    s.otHours.ordinary = 2;
    return HIS.payrollCalc.compute(emp, { frequency: 'semi-monthly', attendance: s });
  });
  ok('two overtime hours on an eight-hour day pay 375', near(r.earnings.overtime, 375), r.earnings.overtime);
  ok('a full-time employee gets no additional-hours line', r.earnings.additional === 0, r.earnings.additional);
}

// =================================================================================================
// 4. ABSENCE IS NOT PRICED FROM THE PREMIUM RATE BY ACCIDENT
// =================================================================================================
console.log('\n--- 4. absence basis ---');
{
  const r = await page.evaluate(() => {
    const monthly = { id: 'M', payBasis: 'monthly', monthlyBasic: 26100, schedule: { hoursPerDay: 8 }, allowances: [] };
    const daily = { id: 'D', payBasis: 'daily', dailyRate: 1200, schedule: { hoursPerDay: 8 }, allowances: [] };
    const line = (emp) => {
      const s = HIS.payrollCalc.emptySummary(11);
      s.absenceDays = 1;
      return HIS.payrollCalc.compute(emp, { frequency: 'semi-monthly', attendance: s });
    };
    const p = HIS.payrollCalc.policyFor();
    return {
      monthlyAbsence: HIS.payrollCalc.absenceDailyOf(monthly),
      dailyAbsence: HIS.payrollCalc.absenceDailyOf(daily),
      line: line(monthly),
      policy: p
    };
  });

  ok('the absence daily amount for 26,100 is 1,200 under the active policy', near(r.monthlyAbsence, 1200), r.monthlyAbsence);
  ok('a daily-paid employee loses exactly their stated day', near(r.dailyAbsence, 1200), r.dailyAbsence);
  ok('the payslip records the absence basis it used', r.line.absenceBasis.dailyAmount === 1200, JSON.stringify(r.line.absenceBasis));
  ok('the absence basis is labelled a configured assumption, not a proven practice',
    r.line.absenceBasis.status === 'configured-assumption', r.line.absenceBasis.status);
  ok('the absence factor is a separate setting from the premium factor',
    r.policy.absence.factor === 261 && r.policy.dailyRateFactor === 261 && r.policy.absence.basis === 'daily-rate',
    JSON.stringify(r.policy.absence));
  ok('the absence basis carries the evidence it lacks',
    /contract|manual|payslip/i.test(r.policy.absence.review), r.policy.absence.review);
}

// =================================================================================================
// 5. IMPACT: EARNINGS AND DEDUCTIONS SEPARATED
// =================================================================================================
console.log('\n--- 5. impact by purpose ---');
{
  const r = await page.evaluate(() => {
    const before = JSON.stringify(HIS.payrollRuns.current());
    const impact = HIS.payrollCalc.policyImpact(HIS.employees.all(), 'MH-PAY-2027.1');
    return { impact, unchanged: JSON.stringify(HIS.payrollRuns.current()) === before, sample: impact.rows[0] };
  });

  const s = r.sample;
  ok('each row reports ordinary daily rate before and after',
    near(s.earnings.ordinaryDaily.before, 2758.62) && near(s.earnings.ordinaryDaily.after, 1972.60),
    JSON.stringify(s.earnings.ordinaryDaily));
  ok('each row reports hourly, overtime, night, rest-day and holiday separately',
    ['hourly', 'overtime2h', 'night8h', 'restDay8h', 'holiday8h'].every(k => s.earnings[k] && 'delta' in s.earnings[k]),
    Object.keys(s.earnings).join(','));
  ok('deductions are reported apart from earnings', !!s.deductions.absence1day, JSON.stringify(s.deductions));
  ok('premiums fall when the divisor rises', s.earnings.overtime2h.delta < 0 && s.earnings.holiday8h.delta < 0,
    JSON.stringify({ ot: s.earnings.overtime2h.delta, hol: s.earnings.holiday8h.delta }));
  ok('the absence deduction also falls', s.deductions.absence1day.delta < 0, s.deductions.absence1day.delta);
  ok('the net is reported only after the components',
    near(s.netIllustrative.net, s.netIllustrative.earningsDelta - s.netIllustrative.deductionDelta),
    JSON.stringify(s.netIllustrative));
  ok('the net is negative here because premiums fall more than the deduction',
    s.netIllustrative.net < 0, s.netIllustrative.net);
  ok('the summary counts both effects', r.impact.summary.premiumFalls === 8 && r.impact.summary.deductionFalls === 8,
    JSON.stringify(r.impact.summary));
  ok('the note does not call the change uniformly favourable', /opposite directions/.test(r.impact.note), r.impact.note);
  ok('the impact report mutates nothing', r.unchanged === true);
}

// =================================================================================================
// 6. ARTICLE 83 — HEALTH PERSONNEL
// =================================================================================================
console.log('\n--- 6. Article 83 applicability ---');
{
  const r = await page.evaluate(() => {
    const emp = { id: 'H', payBasis: 'monthly', monthlyBasic: 26100, schedule: { hoursPerDay: 8 }, allowances: [] };
    const initial = HIS.employer.art83();
    const refused = HIS.employer.sixthDayPremium(emp, { hours: 8 });
    HIS.employer.set('cityPopulation', 1500000, 'test');
    const covered = HIS.employer.art83();
    const priced = HIS.employer.sixthDayPremium(emp, { hours: 8 });
    HIS.employer.set('cityPopulation', 500000, 'test');
    const notCovered = HIS.employer.art83();
    const refused2 = HIS.employer.sixthDayPremium(emp, { hours: 8 });
    HIS.employer.set('cityPopulation', null);
    return {
      initial, refused: refused.ok, refusedErr: refused.error,
      covered, priced, notCovered, refused2: refused2.ok,
      restored: HIS.employer.art83().status
    };
  });

  ok('applicability is undetermined for the modelled employer', r.initial.status === 'undetermined', r.initial.status);
  ok('the missing fact is named', r.initial.missing.indexOf('cityPopulation') > -1, JSON.stringify(r.initial.missing));
  ok('no sixth-day premium is priced while applicability is undetermined', r.refused === false, r.refusedErr);
  ok('a qualifying population makes the provision apply', r.covered.status === 'covered', r.covered.status);
  ok('the sixth-day premium is 30% of eight hours: 150 x 0.30 x 8 = 360', r.priced.ok && near(r.priced.amount, 360),
    r.priced.amount);
  ok('the premium warns against stacking with a rest-day premium', /rest-day premium applies instead/.test(r.priced.note), r.priced.note);
  ok('a small city with 60 beds does not qualify', r.notCovered.status === 'not-covered', r.notCovered.status);
  ok('no premium is priced when the employer is not covered', r.refused2 === false);
  ok('the employer profile is restored to undetermined', r.restored === 'undetermined', r.restored);
}

// =================================================================================================
// 7. REGIONAL ORDERS REMAIN INTACT
// =================================================================================================
console.log('\n--- 7. wage orders unchanged ---');
{
  const r = await page.evaluate(() => ({
    ncr: HIS.wageFloor.floorFor({ region: 'NCR', sector: 'non-agriculture', asOf: '2026-11-18' }),
    r7: HIS.wageFloor.floorFor({ region: 'Region VII', locality: 'class-a', asOf: '2026-11-18' }),
    r1: HIS.wageFloor.floorFor({ region: 'Region I', asOf: '2026-11-18' }),
    coverage: HIS.wageFloor.coverage()
  }));
  ok('NCR still applies 755', r.ncr.dailyRate === 755, r.ncr.dailyRate);
  ok('Region VII still applies 582 for Class A', r.r7.dailyRate === 582, r.r7.dailyRate);
  ok('an unverified region is still refused', r.r1.status === 'unverified', r.r1.status);
  ok('the coverage register is unchanged at 2 of 17', r.coverage.verified === 2 && r.coverage.total === 17,
    r.coverage.verified + '/' + r.coverage.total);
}

// =================================================================================================
// 8. NO DOUBLE PRICING
// =================================================================================================
console.log('\n--- 8. no duplicate premium ---');
{
  const r = await page.evaluate(() => {
    const emp = {
      id: 'R', payBasis: 'monthly', monthlyBasic: 26100,
      schedule: { daysPerWeek: 5, hoursPerDay: 8 }, category: 'rank-and-file', allowances: []
    };
    const s = HIS.payrollCalc.emptySummary(0);
    s.scheduledDays = 1; s.workedDays = 1;
    s.restDayHours = 8; s.premiumDays.rest = 1; s.otHours.rest = 1;
    const line = HIS.payrollCalc.compute(emp, { frequency: 'semi-monthly', attendance: s });
    return line;
  });
  // Rest-day premium is 150 x 0.30 x 8 = 360; rest-day overtime is 150 x 1.69 x 1 = 253.50.
  ok('a nine-hour rest day pays the premium on eight hours only', near(r.earnings.premium, 360), r.earnings.premium);
  ok('and overtime on the ninth hour only', near(r.earnings.overtime, 253.50), r.earnings.overtime);
  ok('the two do not overlap', near(r.earnings.premium + r.earnings.overtime, 613.50), r.earnings.premium + r.earnings.overtime);
}

// =================================================================================================
// 9. RELEASED PAYROLL UNTOUCHED
// =================================================================================================
{
  const r = await page.evaluate(() => {
    const run = HIS.payrollRuns.current();
    const snap = JSON.stringify(run);
    HIS.payrollCalc.policyImpact(HIS.employees.all(), 'MH-PAY-2027.1');
    HIS.employer.art83();
    return { same: JSON.stringify(HIS.payrollRuns.current()) === snap, status: run.status, lines: run.lines.length };
  });
  ok('the payroll run is byte-identical after every audit call', r.same === true);
  ok('the run still has its full line count', r.lines === 8, r.lines);
}

ok('the audit ran with no console errors', errs.length === 0, errs[0]);

await mkdir(path.join(ROOT, 'qa', 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'qa', 'audit', 'm10-4.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, failures }, null, 2));

await ctx.close();
await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
