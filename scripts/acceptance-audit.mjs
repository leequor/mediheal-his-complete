// M10 acceptance audit. Independent of the implementation's own test fixtures.
//
// Every expected figure below is derived in this file from a published rule or from arithmetic that
// does not call the application's calculator. Where the engine and this file disagree, one of them
// is wrong and the audit fails.
//
// Sections
//   1  attendance -> payroll (absence, leave, overtime, night, holiday, approval gates, versions)
//   2  statutory rules (independent Annex E table, contribution floors/ceilings, minimum wage)
//   3  claims: every transition, every invalid transition, financial integrity after each one
//   4  payslips: line-by-line against hand calculations, monthly and semi-monthly
//
// Usage: PW=<playwright-core> node scripts/acceptance-audit.mjs
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
await new Promise(r => server.listen(8856, r));
const BASE = 'http://127.0.0.1:8856';

const spec = process.env.PW || 'playwright-core';
const mod = await import(spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) ? pathToFileURL(spec).href : spec);
const chromium = mod.chromium || (mod.default && mod.default.chromium);
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else {
    fail++; failures.push({ name, detail: detail === undefined ? null : String(detail) });
    console.log('FAIL ' + name + (detail !== undefined ? '  \u2192 ' + detail : ''));
  }
};
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) < (tol == null ? 0.011 : tol);
const r2 = n => Math.round(n * 100) / 100;

// ---- independent reference arithmetic ---------------------------------------------------------
// Annex E, effective 1 January 2023. Encoded here from the published PDF, separately from the
// application's CONFIG, so a typo in either is caught.
const AE = {
  semiMonthly: [
    [10417, 0, 0, 0], [16666, 0, 0.15, 10417], [33332, 937.50, 0.20, 16667],
    [83332, 4270.70, 0.25, 33333], [333332, 16770.70, 0.30, 83333], [Infinity, 91770.70, 0.35, 333333]
  ],
  monthly: [
    [20833, 0, 0, 0], [33332, 0, 0.15, 20833], [66666, 1875.00, 0.20, 33333],
    [166666, 8541.80, 0.25, 66667], [666666, 33541.80, 0.30, 166667], [Infinity, 183541.80, 0.35, 666667]
  ],
  annual: [
    [250000, 0, 0, 0], [400000, 0, 0.15, 250000], [800000, 22500, 0.20, 400000],
    [2000000, 102500, 0.25, 800000], [8000000, 402500, 0.30, 2000000], [Infinity, 2202500, 0.35, 8000000]
  ]
};
function taxRef(table, amount) {
  for (const [upTo, base, rate, over] of table) {
    if (amount <= upTo) return rate ? r2(base + (amount - over) * rate) : 0;
  }
  return 0;
}
// SSS MSC: the bracket [MSC-250, MSC+249.99] that contains the salary.
function mscRef(monthly) {
  let m = Math.ceil((monthly - 249.99) / 500) * 500;
  return Math.min(35000, Math.max(5000, m));
}
const sssRef = m => r2(mscRef(m) * 0.05);
const philRef = m => r2(Math.min(100000, Math.max(10000, m)) * 0.025);
// RA 9679 s.7: 1% employee at or below 1,500, 2% above, capped at a 10,000 fund salary.
const pagRef = m => r2(Math.min(10000, m) * (m <= 1500 ? 0.01 : 0.02));

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
// 1. ATTENDANCE -> PAYROLL
// =================================================================================================
console.log('\n--- 1. attendance and payroll integration ---');
{
  // 26,100 a month gives a daily rate of exactly 1,200 and an hourly rate of exactly 150
  // (26,100 x 12 / 261 = 1,200), so every hand calculation below is exact.
  const r = await page.evaluate(() => {
    const MONTHLY = 26100, DAY = 1200, HOUR = 150;
    const base = () => ({
      scheduledDays: 11, workedDays: 11, absenceDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0,
      lateMinutes: 0, undertimeMinutes: 0, totalHours: 88,
      otHours: { ordinary: 0, rest: 0, regularHoliday: 0, special: 0 },
      ndHours: 0, ndOtHours: 0,
      premiumDays: { rest: 0, regularHoliday: 0, special: 0, restRegularHoliday: 0, restSpecial: 0 }
    });
    const emp = { id: 'AUD-1', name: 'Audit Employee', monthlyBasic: MONTHLY, category: 'rank-and-file', allowances: [] };
    const run = (patch) => {
      const s = base();
      Object.keys(patch || {}).forEach(k => {
        if (k === 'otHours' || k === 'premiumDays') Object.assign(s[k], patch[k]);
        else s[k] = patch[k];
      });
      return HIS.payrollCalc.compute(emp, { frequency: 'semi-monthly', attendance: s });
    };
    const mgr = HIS.payrollCalc.compute(
      { id: 'AUD-M', monthlyBasic: MONTHLY, category: 'managerial', allowances: [] },
      { frequency: 'semi-monthly', attendance: Object.assign(base(), {
        otHours: { ordinary: 2, rest: 0, regularHoliday: 0, special: 0 }, ndHours: 8,
        premiumDays: { rest: 0, regularHoliday: 1, special: 0, restRegularHoliday: 0, restSpecial: 0 }
      }) }
    );
    return {
      day: DAY, hour: HOUR,
      clean: run({}), abs: run({ absenceDays: 1 }), leave: run({ paidLeaveDays: 1 }),
      late: run({ lateMinutes: 30 }), under: run({ undertimeMinutes: 60 }),
      ot: run({ otHours: { ordinary: 2 } }), otRest: run({ otHours: { rest: 2 } }),
      otHol: run({ otHours: { regularHoliday: 2 } }),
      nd: run({ ndHours: 8 }),
      hol: run({ premiumDays: { regularHoliday: 1 } }),
      spec: run({ premiumDays: { special: 1 } }),
      rest: run({ premiumDays: { rest: 1 } }),
      combo: run({ premiumDays: { rest: 1, regularHoliday: 1, special: 1 } }),
      mgr
    };
  });

  ok('a clean period pays exactly half the monthly salary', near(r.clean.earnings.basic, 13050), r.clean.earnings.basic);
  ok('a clean period has no exception lines',
    r.clean.earnings.absence === 0 && r.clean.earnings.late === 0 && r.clean.earnings.undertime === 0);

  // 1.1 unpaid absence
  ok('one unpaid absence deducts exactly one daily rate (1,200)', near(r.abs.earnings.absence, -r.day), r.abs.earnings.absence);
  ok('an absence lowers gross by exactly that amount', near(r.clean.gross - r.abs.gross, r.day), r.clean.gross - r.abs.gross);
  ok('an absence lowers net pay', r.abs.net < r.clean.net, r.clean.net + ' -> ' + r.abs.net);

  // 1.2 approved leave: paid, so no deduction
  ok('approved paid leave deducts nothing', r.leave.earnings.absence === 0, r.leave.earnings.absence);
  ok('approved paid leave pays the same gross as a worked day', near(r.leave.gross, r.clean.gross), r.leave.gross + ' vs ' + r.clean.gross);

  // 1.3 late and undertime
  ok('30 minutes late deducts 30 x 150 / 60 = 75', near(r.late.earnings.late, -75), r.late.earnings.late);
  ok('60 minutes undertime deducts 150', near(r.under.earnings.undertime, -150), r.under.earnings.undertime);

  // 1.4 overtime
  ok('two hours of ordinary overtime pay 125% of 150 = 375', near(r.ot.earnings.overtime, 375), r.ot.earnings.overtime);
  ok('overtime raises gross by exactly the overtime pay', near(r.ot.gross - r.clean.gross, 375), r.ot.gross - r.clean.gross);
  ok('rest-day overtime pays 169% of 150 = 507', near(r.otRest.earnings.overtime, 507), r.otRest.earnings.overtime);
  ok('regular-holiday overtime pays 260% of 150 = 780', near(r.otHol.earnings.overtime, 780), r.otHol.earnings.overtime);

  // 1.5 night differential
  ok('eight night hours pay 10% of 150 = 120', near(r.nd.earnings.night, 120), r.nd.earnings.night);
  ok('night differential is additive to gross', near(r.nd.gross - r.clean.gross, 120), r.nd.gross - r.clean.gross);

  // 1.6 holiday and rest-day premiums
  ok('a regular holiday worked adds 100% of a day (1,200)', near(r.hol.earnings.premium, 1200), r.hol.earnings.premium);
  ok('a special non-working day worked adds 30% of a day (360)', near(r.spec.earnings.premium, 360), r.spec.earnings.premium);
  ok('a rest day worked adds 30% of a day (360)', near(r.rest.earnings.premium, 360), r.rest.earnings.premium);
  ok('premiums are additive (360 + 1,200 + 360 = 1,920)', near(r.combo.earnings.premium, 1920), r.combo.earnings.premium);

  // 1.7 a managerial employee gets no OT or ND but keeps premiums
  ok('a managerial employee receives no overtime', r.mgr.earnings.overtime === 0, r.mgr.earnings.overtime);
  ok('a managerial employee receives no night differential', r.mgr.earnings.night === 0, r.mgr.earnings.night);
  ok('a managerial employee still receives the holiday premium', near(r.mgr.earnings.premium, 1200), r.mgr.earnings.premium);

  // 1.8 the gross identity holds in every case
  const identity = ['clean', 'abs', 'leave', 'late', 'under', 'ot', 'otRest', 'otHol', 'nd', 'hol', 'spec', 'rest', 'combo'];
  const broken = identity.filter(k => {
    const l = r[k];
    return !near(l.gross, l.earnings.basic + l.earnings.absence + l.earnings.late + l.earnings.undertime +
      l.earnings.premium + l.earnings.overtime + l.earnings.night + l.earnings.allowances);
  });
  ok('gross equals basic plus every earnings line, in all 13 scenarios', broken.length === 0, broken.join(','));
}

// 1.7 payroll cannot be approved on unapproved attendance
{
  const r = await page.evaluate(() => {
    const run = HIS.payrollRuns.current();
    if (run.status === 'draft') HIS.payrollRuns.review(run.id, 'audit');
    HIS.attendancePeriod.reopen('EMP-006', 'acceptance audit');
    const approve = HIS.payrollRuns.approve(run.id, 'audit');
    HIS.attendancePeriod.approve('EMP-006', 'audit');
    const after = HIS.payrollRuns.approve(run.id, 'audit');
    return { blocked: approve.ok, err: approve.error, okAfter: after.ok, status: HIS.payrollRuns.current().status };
  });
  ok('approval is refused while a timesheet is unapproved', r.blocked === false, r.err);
  ok('approval succeeds once every timesheet is approved', r.okAfter === true && r.status === 'approved', r.status);
}

// 1.8 release cannot use attendance that changed after approval
{
  const r = await page.evaluate(() => {
    const run = HIS.payrollRuns.current();
    HIS.attendancePeriod.reopen('EMP-002', 'changed after approval');
    const release = HIS.payrollRuns.release(run.id, 'audit');
    return { released: release.ok, err: release.error, status: HIS.payrollRuns.current().status };
  });
  ok('release is refused when attendance changed after approval', r.released === false, r.err);
  ok('the run stays approved rather than half-released', r.status === 'approved', r.status);
}

// 1.9 a changed timesheet invalidates the approval and versions the calculation
{
  const r = await page.evaluate(() => {
    const run = HIS.payrollRuns.current();
    const before = { version: run.version, net: run.totals.net, emp: run.lines.filter(l => l.employeeId === 'EMP-002')[0].net };
    // Change EMP-002 from present to absent on one day.
    HIS.attendancePeriod.correct('EMP-002', '2026-08-18', { timeIn: null, timeOut: null, status: 'absent' }, 'audit correction');
    HIS.attendancePeriod.approve('EMP-002', 'audit');
    const rec = HIS.payrollRuns.recompute(run.id, 'attendance corrected');
    const after = HIS.payrollRuns.current();
    return {
      recomputed: rec.ok, err: rec.error,
      versionBefore: before.version, versionAfter: after.version,
      status: after.status,
      approvedAtCleared: !after.approvedAt,
      versions: after.versions.length,
      netBefore: before.net, netAfter: after.totals.net,
      empBefore: before.emp, empAfter: after.lines.filter(l => l.employeeId === 'EMP-002')[0].net,
      historyHasInvalidation: after.history.some(h => h.action === 'approval invalidated')
    };
  });
  ok('a changed timesheet allows the approved run to be recomputed', r.recomputed === true, r.err);
  ok('recompute archives the approved version', r.versions === 1, r.versions);
  ok('recompute bumps the version number', r.versionAfter === r.versionBefore + 1, r.versionBefore + ' -> ' + r.versionAfter);
  ok('recompute clears the stale approval', r.approvedAtCleared === true);
  ok('the invalidation is recorded in the run history', r.historyHasInvalidation === true);
  ok('the corrected absence reduces the employee net pay', r.empAfter < r.empBefore, r.empBefore + ' -> ' + r.empAfter);
  ok('the run total falls by the same amount', r.netAfter < r.netBefore, r.netBefore + ' -> ' + r.netAfter);
  ok('the recomputed run returns to draft', r.status === 'draft', r.status);
}

// 1.10 a released run is final
{
  const r = await page.evaluate(() => {
    const run = HIS.payrollRuns.current();
    HIS.payrollRuns.review(run.id, 'audit');
    const ap = HIS.payrollRuns.approve(run.id, 'audit');
    const rel = HIS.payrollRuns.release(run.id, 'audit');
    const recomp = HIS.payrollRuns.recompute(run.id, 'audit');
    const second = HIS.payrollRuns.create({});
    return { ap: ap.ok, rel: rel.ok, recomp: recomp.ok, recompErr: recomp.error, second: second.ok, status: HIS.payrollRuns.current().status };
  });
  ok('a corrected run can be re-approved and released', r.ap && r.rel, r.ap + '/' + r.rel);
  ok('a released run cannot be recomputed', r.recomp === false, r.recompErr);
  ok('a second run for the same period is refused', r.second === false);
  ok('the released run is the final version', r.status === 'released', r.status);
}

// =================================================================================================
// 2. STATUTORY RULES
// =================================================================================================
console.log('\n--- 2. statutory rules ---');
{
  const r = await page.evaluate(() => ({
    msc: [4999, 5000, 5250, 12249, 12250, 12300, 35000, 35001, 500000].map(v => [v, HIS.payrollCalc.msc(v)]),
    sss: [9000, 26100, 60000, 250000].map(v => [v, HIS.payrollCalc.sssMonthly(v)]),
    phil: [5000, 10000, 26100, 60000, 100000, 250000].map(v => [v, HIS.payrollCalc.philhealthMonthly(v)]),
    pag: [1000, 10000, 26100, 250000].map(v => [v, HIS.payrollCalc.pagibigMonthly(v)]),
    emp: [26100, 250000].map(v => [v, HIS.payrollCalc.statutory(v).employer, HIS.payrollCalc.statutory(v).employee]),
    tax: [
      ['semi', 10417], ['semi', 10418], ['semi', 16666], ['semi', 16667], ['semi', 33332], ['semi', 33333],
      ['semi', 83332], ['semi', 83333], ['semi', 400000],
      ['monthly', 20833], ['monthly', 33333], ['monthly', 66667], ['monthly', 166667], ['monthly', 700000],
      ['annual', 250000], ['annual', 400001], ['annual', 800001]
    ].map(([f, v]) => [f, v, HIS.payrollCalc.withholding(v, f === 'semi' ? 'semi-monthly' : f)]),
    cfg: HIS.payrollCalc.CONFIG
  }));

  const mscExpected = [[4999, 5000], [5000, 5000], [5250, 5500], [12249, 12000], [12250, 12500],
    [12300, 12500], [35000, 35000], [35001, 35000], [500000, 35000]];
  ok('SSS MSC brackets match the independent reference', r.msc.every(([v, got], i) => got === mscExpected[i][1]),
    JSON.stringify(r.msc.filter(([v, got], i) => got !== mscExpected[i][1])));

  ok('SSS employee share is 5% of the MSC', r.sss.every(([v, got]) => near(got, sssRef(v))),
    JSON.stringify(r.sss.map(([v, got]) => [v, got, sssRef(v)])));
  ok('PhilHealth employee share is 2.5% within 10,000-100,000', r.phil.every(([v, got]) => near(got, philRef(v))),
    JSON.stringify(r.phil.map(([v, got]) => [v, got, philRef(v)])));
  ok('Pag-IBIG employee share is 2% capped at a 10,000 fund salary', r.pag.every(([v, got]) => near(got, pagRef(v))),
    JSON.stringify(r.pag.map(([v, got]) => [v, got, pagRef(v)])));

  ok('the employer SSS share is 10% of the MSC', r.emp.every(([v, er]) => near(er.sss, r2(mscRef(v) * 0.10))),
    JSON.stringify(r.emp.map(([v, er]) => [v, er.sss, r2(mscRef(v) * 0.10)])));
  ok('the employer PhilHealth share equals the employee share', r.emp.every(([v, er, ee]) => near(er.philhealth, ee.philhealth)));
  ok('the employer Pag-IBIG share equals the employee share', r.emp.every(([v, er, ee]) => near(er.pagibig, ee.pagibig)));
  ok('the employer total exceeds the employee total', r.emp.every(([v, er, ee]) => er.total > ee.total));

  const tableFor = f => f === 'semi' ? AE.semiMonthly : f === 'monthly' ? AE.monthly : AE.annual;
  ok('withholding matches the independent Annex E tables at every boundary',
    r.tax.every(([f, v, got]) => near(got, taxRef(tableFor(f), v))),
    JSON.stringify(r.tax.map(([f, v, got]) => [f, v, got, taxRef(tableFor(f), v)]).filter(x => !near(x[2], x[3]))));

  // Effective dates and sources must be recorded, not implied.
  const c = r.cfg;
  const sourced = [c.sss, c.philhealth, c.pagibig, c.bir, c.labor, c.thirteenth];
  ok('every rule carries a source and an effective date',
    sourced.every(x => x.source && /^\d{4}-\d{2}-\d{2}$/.test(x.effectiveFrom)),
    JSON.stringify(sourced.filter(x => !x.source || !/^\d{4}-\d{2}-\d{2}$/.test(x.effectiveFrom)).map(x => x.source)));
  ok('the SSS table is effective January 2025', c.sss.effectiveFrom === '2025-01-01', c.sss.effectiveFrom);
  ok('the BIR table is effective January 2023', c.bir.effectiveFrom === '2023-01-01', c.bir.effectiveFrom);
  ok('the 13th-month exemption is 90,000', c.thirteenth.taxExemptCap === 90000, c.thirteenth.taxExemptCap);

  // Minimum wage: NCR Wage Order NCR-28, effective 26 September 2026, P718.00-P755.00 a day.
  // The demo does not enforce a wage floor; this proves the lowest salary in the demo clears it.
  const floor = await page.evaluate(() => {
    const lows = HIS.employees.all().map(e => ({ id: e.id, daily: e.monthlyBasic * 12 / 261 }));
    lows.sort((a, b) => a.daily - b.daily);
    return lows[0];
  });
  ok('the lowest salary in the demo clears the NCR-28 minimum of 755.00 a day',
    floor.daily > 755, floor.id + ' at ' + r2(floor.daily));
}

// =================================================================================================
// 3. CLAIMS
// =================================================================================================
console.log('\n--- 3. claims and financial integrity ---');
await page.evaluate(() => { HIS.auth.signOut(); HIS.auth.attempt('finance@mediheal.test', 'MediHeal2026!', true); });
await page.goto(BASE + '/claims.html', { waitUntil: 'load' });
await page.waitForTimeout(400);
{
  // Ids must stay unique and readable over repeated creation. The first implementation stripped
  // every non-digit, concatenating the year into the sequence until two claims collided.
  const seq = await page.evaluate(() => {
    const made = [];
    for (let i = 0; i < 12; i++) {
      const c = HIS.claims.create({ invoiceId: 'BL-8798', payer: 'PhilHealth', payerType: 'philhealth', memberRef: 'SEQ', requestedAmount: 100 });
      made.push(c.claim && c.claim.id);
    }
    const ids = HIS.claims.all().map(c => c.id);
    return { made, unique: new Set(ids).size === ids.length, short: made.every(id => id && id.length <= 14), last: made[made.length - 1] };
  });
  ok('claim ids stay unique and sequential over repeated creation', seq.unique && seq.short, JSON.stringify(seq.made));
}

{
  // Build a claim in any status by walking the real state machine, never by writing the status.
  const matrix = await page.evaluate(() => {
    const PATHS = {
      'draft': [],
      'pending-documentation': [['prepare', {}]],
      'ready-for-review': [['prepare', {}], ['docs-complete', {}]],
      'ready-for-submission': [['prepare', {}], ['docs-complete', {}], ['verify', {}]],
      'submitted': [['prepare', {}], ['docs-complete', {}], ['verify', {}], ['submit', { reference: 'AUD-REF' }]],
      'under-review': [['prepare', {}], ['docs-complete', {}], ['verify', {}], ['submit', { reference: 'AUD-REF' }], ['acknowledge', {}]],
      'additional-info': [['prepare', {}], ['docs-complete', {}], ['verify', {}], ['submit', { reference: 'AUD-REF' }], ['acknowledge', {}], ['request-info', { reason: 'missing' }]],
      'approved': [['prepare', {}], ['docs-complete', {}], ['verify', {}], ['submit', { reference: 'AUD-REF' }], ['acknowledge', {}], ['approve', { approvedAmount: 1000 }]],
      'partially-approved': [['prepare', {}], ['docs-complete', {}], ['verify', {}], ['submit', { reference: 'AUD-REF' }], ['acknowledge', {}], ['partial', { approvedAmount: 600, reason: 'case rate' }]],
      'denied': [['prepare', {}], ['docs-complete', {}], ['verify', {}], ['submit', { reference: 'AUD-REF' }], ['acknowledge', {}], ['deny', { reason: 'not covered' }]],
      'appeal': [['prepare', {}], ['docs-complete', {}], ['verify', {}], ['submit', { reference: 'AUD-REF' }], ['acknowledge', {}], ['deny', { reason: 'not covered' }], ['appeal', { reason: 'contest' }]],
      'settled': [['prepare', {}], ['docs-complete', {}], ['verify', {}], ['submit', { reference: 'AUD-REF' }], ['acknowledge', {}], ['approve', { approvedAmount: 1000 }], ['settle', {}]],
      'closed': [['prepare', {}], ['docs-complete', {}], ['verify', {}], ['submit', { reference: 'AUD-REF' }], ['acknowledge', {}], ['deny', { reason: 'not covered' }], ['close', {}]]
    };
    const payload = {
      approvedAmount: 1000, reason: 'audit', reference: 'AUD-REF',
      settlementDate: '2026-08-31', note: 'audit'
    };
    const makeAt = (status) => {
      const c = HIS.claims.create({ invoiceId: 'BL-8798', payer: 'PhilHealth', payerType: 'philhealth', memberRef: 'AUDIT', requestedAmount: 1000 });
      const id = c.claim.id;
      HIS.claims.get(id).documents.forEach((d, i) => HIS.claims.setDocument(id, i, true));
      (PATHS[status] || []).forEach(([action, p]) => {
        const res = HIS.claims.transition(id, action, Object.assign({}, payload, p));
        if (!res.ok) throw new Error('walk to ' + status + ' failed at ' + action + ': ' + res.error);
      });
      return id;
    };

    const statuses = Object.keys(HIS.claims.STATUS);
    const actions = Array.from(new Set(HIS.claims.TRANSITIONS.map(t => t.action)));
    const grid = [];
    statuses.forEach(status => {
      const id = makeAt(status);
      actions.forEach(action => {
        const before = HIS.claims.get(id);
        const legal = HIS.claims.TRANSITIONS.some(t => t.from === status && t.action === action);
        // Do not actually mutate for the legal ones except the last status we inspect; instead use
        // available() for legality and transition() on a throwaway copy for refusal.
        if (!legal) {
          const res = HIS.claims.transition(id, action, payload);
          grid.push({ status, action, legal, ok: res.ok, err: res.error });
        } else {
          grid.push({ status, action, legal, ok: true, offered: HIS.claims.available(before).some(t => t.action === action) });
        }
      });
    });

    // Role gating: a cashier cannot record a payer decision; an auditor cannot transition at all.
    const underId = makeAt('under-review');
    HIS.auth.signOut(); HIS.auth.attempt('cashier@mediheal.test', 'MediHeal2026!', true);
    const cashierApprove = HIS.claims.transition(underId, 'approve', { approvedAmount: 1000 });
    const cashierSubmitOk = HIS.claims.available(HIS.claims.get(underId)).map(t => t.action);
    HIS.auth.signOut(); HIS.auth.attempt('auditor@mediheal.test', 'MediHeal2026!', true);
    const auditorDeny = HIS.claims.transition(underId, 'deny', { reason: 'x' });
    const auditorOffered = HIS.claims.available(HIS.claims.get(underId)).length;
    HIS.auth.signOut(); HIS.auth.attempt('finance@mediheal.test', 'MediHeal2026!', true);

    return {
      grid, statuses: statuses.length, actions: actions.length,
      cashierApprove: cashierApprove.ok, cashierErr: cashierApprove.error,
      cashierOffered: cashierSubmitOk, auditorDeny: auditorDeny.ok, auditorOffered
    };
  });

  const illegal = matrix.grid.filter(g => !g.legal);
  ok(`every status was reachable (${matrix.statuses}) and every action enumerated (${matrix.actions})`, matrix.grid.length === matrix.statuses * matrix.actions);
  ok('every transition that does not apply to a status is refused',
    illegal.every(g => g.ok === false),
    JSON.stringify(illegal.filter(g => g.ok).slice(0, 5)));
  ok('every transition that does apply is offered to the role',
    matrix.grid.filter(g => g.legal).every(g => g.offered !== false),
    JSON.stringify(matrix.grid.filter(g => g.legal && g.offered === false)));
  ok('a cashier cannot record a payer decision', matrix.cashierApprove === false, matrix.cashierErr);
  ok('an auditor is offered no transition at all', matrix.auditorOffered === 0, matrix.auditorOffered);
  ok('an auditor cannot record a denial', matrix.auditorDeny === false);
}

// 3.1 financial integrity of each decision
{
  const r = await page.evaluate(() => {
    const inv = [];
    const check = (label) => {
      const bad = HIS.ledger.invariants();
      if (bad.length) inv.push({ label, bad });
    };
    const bill = HIS.billing.bills.filter(b => b.id === 'BL-8798')[0];
    const start = HIS.ledger.balanceOf(bill);
    const walk = (id, steps) => steps.map(([a, p]) => HIS.claims.transition(id, a, p || {}));

    // -- partial approval
    const c1 = HIS.claims.create({ invoiceId: 'BL-8798', payer: 'Maxicare', payerType: 'hmo', memberRef: 'AUD-P', requestedAmount: 1000 });
    const id1 = c1.claim.id;
    HIS.claims.get(id1).documents.forEach((d, i) => HIS.claims.setDocument(id1, i, true));
    walk(id1, [['send-review'], ['verify'], ['submit', { reference: 'R1' }], ['acknowledge']]);
    check('after submission');
    const paymentsBefore = HIS.ledger.all().filter(t => t.kind === 'payment').length;
    const balBeforeApprove = HIS.ledger.balanceOf(bill);
    const ap = HIS.claims.transition(id1, 'partial', { approvedAmount: 600, reason: 'case rate applied' });
    check('after partial approval');
    const balAfterApprove = HIS.ledger.balanceOf(bill);
    const paymentsAfter = HIS.ledger.all().filter(t => t.kind === 'payment').length;
    const settle = HIS.claims.transition(id1, 'settle', {});
    const claim1 = HIS.claims.get(id1);
    check('after settlement');
    const balAfterSettle = HIS.ledger.balanceOf(bill);
    const coverage1 = HIS.ledger.all().filter(t => t.sourceId === id1);
    const settleAgain = HIS.claims.transition(id1, 'settle', {});

    // -- denial
    const c2 = HIS.claims.create({ invoiceId: 'BL-8798', payer: 'Medicard', payerType: 'hmo', memberRef: 'AUD-D', requestedAmount: 900 });
    const id2 = c2.claim.id;
    HIS.claims.get(id2).documents.forEach((d, i) => HIS.claims.setDocument(id2, i, true));
    walk(id2, [['send-review'], ['verify'], ['submit', { reference: 'R2' }], ['acknowledge']]);
    const balBeforeDeny = HIS.ledger.balanceOf(bill);
    HIS.claims.transition(id2, 'deny', { reason: 'excluded procedure' });
    check('after denial');
    const balAfterDeny = HIS.ledger.balanceOf(bill);
    const denied = HIS.claims.get(id2);

    // -- appeal preserves history
    const histBefore = denied.history.length;
    const firstEntry = JSON.stringify(denied.history[0]);
    HIS.claims.transition(id2, 'appeal', { reason: 'grounds' });
    const appealed = HIS.claims.get(id2);
    const firstStill = JSON.stringify(appealed.history[0]) === firstEntry;
    HIS.claims.transition(id2, 'reopen', {});
    const reopened = HIS.claims.get(id2);

    return {
      partial: { ok: ap.ok, approved: claim1.approvedAmount, share: claim1.patientShare,
        paymentsBefore, paymentsAfter, balBeforeApprove, balAfterApprove },
      settle: { ok: settle.ok, tx: claim1.settlement && claim1.settlement.transactionId,
        coverageRows: coverage1.length, coverageAmount: coverage1[0] && coverage1[0].amount / 100,
        balAfterSettle, again: settleAgain.ok },
      denial: { ok: true, balBeforeDeny, balAfterDeny, approved: denied.approvedAmount, status: denied.status },
      appeal: { status: appealed.status, reopened: reopened.status, histBefore, histAfter: appealed.history.length, firstStill },
      start, inv
    };
  });

  ok('a partial approval records the approved amount, not the requested one', r.partial.ok && near(r.partial.approved, 600), r.partial.approved);
  ok('a partial approval sets the patient share to the outstanding balance less the approved amount',
    near(r.partial.share, r.partial.balBeforeApprove - 600), r.partial.share + ' vs ' + (r.partial.balBeforeApprove - 600));
  ok('approval creates no payment transaction', r.partial.paymentsAfter === r.partial.paymentsBefore,
    r.partial.paymentsBefore + ' -> ' + r.partial.paymentsAfter);
  ok('approval leaves the invoice balance unchanged', near(r.partial.balBeforeApprove, r.partial.balAfterApprove),
    r.partial.balBeforeApprove + ' -> ' + r.partial.balAfterApprove);

  ok('settlement posts exactly one coverage row', r.settle.coverageRows === 1, r.settle.coverageRows);
  ok('the coverage row carries the approved amount', near(r.settle.coverageAmount, 600), r.settle.coverageAmount);
  ok('settlement reduces the balance by exactly the approved amount',
    near(r.partial.balAfterApprove - r.settle.balAfterSettle, 600), r.partial.balAfterApprove + ' -> ' + r.settle.balAfterSettle);
  ok('the claim records the ledger transaction id', !!r.settle.tx, r.settle.tx);
  ok('a duplicate settlement is refused', r.settle.again === false);

  ok('a denial leaves the invoice balance untouched', near(r.denial.balBeforeDeny, r.denial.balAfterDeny),
    r.denial.balBeforeDeny + ' -> ' + r.denial.balAfterDeny);
  ok('a denial records no approved amount', r.denial.approved === 0, r.denial.approved);
  ok('a denied claim is not open', r.denial.status === 'denied', r.denial.status);

  ok('filing an appeal moves the claim to Appeal requested', r.appeal.status === 'appeal', r.appeal.status);
  ok('an accepted appeal returns the claim to review', r.appeal.reopened === 'under-review', r.appeal.reopened);
  ok('an appeal appends history without rewriting it',
    r.appeal.histAfter > r.appeal.histBefore && r.appeal.firstStill === true,
    r.appeal.histBefore + ' -> ' + r.appeal.histAfter + ', first intact: ' + r.appeal.firstStill);

  ok('no ledger invariant broke during any claim decision', r.inv.length === 0, JSON.stringify(r.inv));
}

// 3.2 patient balances stay accurate end to end
{
  const r = await page.evaluate(() => {
    const rows = HIS.billing.bills.map(b => {
      const s = HIS.ledger.sums(b.id);
      return { id: b.id, charge: b.amount, collected: s.net / 100, covered: s.covered / 100,
        outstanding: HIS.ledger.balanceOf(b),
        identity: Math.round(b.amount * 100) - s.net - s.covered - Math.round(HIS.ledger.balanceOf(b) * 100) };
    });
    const rec = HIS.ledger.reconcile();
    return { rows, rec, inv: HIS.ledger.invariants() };
  });
  ok('every invoice still satisfies charge = collected + covered + outstanding',
    r.rows.every(x => x.identity === 0), JSON.stringify(r.rows.filter(x => x.identity !== 0)));
  ok('no invoice balance is negative', r.rows.every(x => x.outstanding >= 0));
  ok('the ledger totals still agree with the per-invoice detail', r.rec.totalsMatch === true);
  ok('coverage is still reported separately from collections', r.rec.covered > 0 && r.rec.collected > 0);
  ok('no ledger invariant is broken at the end of the claims audit', r.inv.length === 0, JSON.stringify(r.inv));
}

// =================================================================================================
// 4. PAYSLIPS
// =================================================================================================
console.log('\n--- 4. payslips ---');
await page.evaluate(() => { HIS.auth.signOut(); HIS.auth.attempt('hr@mediheal.test', 'MediHeal2026!', true); });
await page.goto(BASE + '/payroll.html', { waitUntil: 'load' });
await page.waitForTimeout(400);
{
  const cases = await page.evaluate(() => {
    const out = [];
    const mk = (monthlyBasic, frequency, extra) => {
      const e = Object.assign({ monthlyBasic, category: 'rank-and-file', allowances: [] }, extra || {});
      return HIS.payrollCalc.compute(e, { frequency, attendance: HIS.payrollCalc.emptySummary(frequency === 'monthly' ? 22 : 11) });
    };
    out.push({ id: 'semi-26100', line: mk(26100, 'semi-monthly') });
    out.push({ id: 'monthly-26100', line: mk(26100, 'monthly') });
    out.push({ id: 'semi-60000', line: mk(60000, 'semi-monthly', { allowances: [{ label: 'Professional', amount: 8000, taxable: true }] }) });
    out.push({ id: 'monthly-60000', line: mk(60000, 'monthly', { allowances: [{ label: 'Professional', amount: 8000, taxable: true }] }) });
    out.push({ id: 'min-wage', line: mk(16421.25, 'semi-monthly') });
    out.push({ id: 'max-contrib', line: mk(250000, 'semi-monthly') });
    out.push({ id: 'high-income', line: mk(500000, 'monthly') });
    return out;
  });

  // Independent expectations, derived here.
  const expect = (monthly, freq, allowanceMonthly) => {
    const per = freq === 'monthly' ? 1 : 2;
    const basic = r2(monthly / per);
    const allow = r2((allowanceMonthly || 0) / per);
    const gross = r2(basic + allow);
    const sss = r2(sssRef(monthly) / per);
    const phil = r2(philRef(monthly) / per);
    const pag = r2(pagRef(monthly) / per);
    const taxable = r2(gross - sss - phil - pag);
    const tax = taxRef(freq === 'monthly' ? AE.monthly : AE.semiMonthly, taxable);
    const net = r2(gross - sss - phil - pag - tax);
    return { basic, allow, gross, sss, phil, pag, taxable, tax, net };
  };

  const spec = {
    'semi-26100': [26100, 'semi-monthly', 0],
    'monthly-26100': [26100, 'monthly', 0],
    'semi-60000': [60000, 'semi-monthly', 8000],
    'monthly-60000': [60000, 'monthly', 8000],
    'min-wage': [16421.25, 'semi-monthly', 0],
    'max-contrib': [250000, 'semi-monthly', 0],
    'high-income': [500000, 'monthly', 0]
  };

  cases.forEach(c => {
    const [monthly, freq, allow] = spec[c.id];
    const e = expect(monthly, freq, allow);
    const l = c.line;
    const tag = c.id + ' (' + freq + ')';
    ok(`${tag}: basic ${e.basic}`, near(l.earnings.basic, e.basic), l.earnings.basic);
    ok(`${tag}: allowances ${e.allow}`, near(l.earnings.allowances, e.allow), l.earnings.allowances);
    ok(`${tag}: gross ${e.gross}`, near(l.gross, e.gross), l.gross);
    ok(`${tag}: SSS ${e.sss}`, near(l.statutory.sss, e.sss), l.statutory.sss);
    ok(`${tag}: PhilHealth ${e.phil}`, near(l.statutory.philhealth, e.phil), l.statutory.philhealth);
    ok(`${tag}: Pag-IBIG ${e.pag}`, near(l.statutory.pagibig, e.pag), l.statutory.pagibig);
    ok(`${tag}: taxable ${e.taxable}`, near(l.taxable, e.taxable), l.taxable);
    ok(`${tag}: withholding ${e.tax}`, near(l.tax, e.tax), l.tax);
    ok(`${tag}: net ${e.net}`, near(l.net, e.net), l.net);
    ok(`${tag}: gross = deductions + net`, near(l.gross, l.deductions + l.net), l.gross + ' vs ' + (l.deductions + l.net));
    ok(`${tag}: employer contributions are not part of deductions`,
      l.employer.total > 0 && !near(l.employer.total, 0) && near(l.deductions, l.statutory.total + l.tax + l.other),
      l.deductions + ' vs ' + (l.statutory.total + l.tax));
    ok(`${tag}: the payslip itemises every line`, l.lines.length >= 8, l.lines.length);
  });

  // Minimum-wage case: 755 a day x 261 / 12 = 16,421.25 a month. Contributions still apply.
  const mw = cases.find(c => c.id === 'min-wage').line;
  ok('a minimum-wage employee still contributes to SSS and PhilHealth',
    mw.statutory.sss > 0 && mw.statutory.philhealth > 0 && mw.statutory.pagibig > 0,
    JSON.stringify(mw.statutory));
  ok('a minimum-wage employee pays no withholding tax', mw.tax === 0, mw.tax);

  // Max contribution: both SSS and PhilHealth are at their ceilings.
  const mx = cases.find(c => c.id === 'max-contrib').line;
  ok('at the ceiling the SSS employee share is 875 a period', near(mx.statutory.sss, 875), mx.statutory.sss);
  ok('at the ceiling the PhilHealth employee share is 1,250 a period', near(mx.statutory.philhealth, 1250), mx.statutory.philhealth);
  ok('at the ceiling the Pag-IBIG employee share is 100 a period', near(mx.statutory.pagibig, 100), mx.statutory.pagibig);

  // High income: the top marginal bracket.
  const hi = cases.find(c => c.id === 'high-income').line;
  ok('a 500,000 monthly salary reaches the 30% bracket', hi.tax > 0 && near(hi.tax, r2(taxRef(AE.monthly, hi.taxable))), hi.tax);
}

// 4.1 the rendered payslip matches the final run
{
  const r = await page.evaluate(() => {
    const run = HIS.payrollRuns.current();
    const emp = HIS.employees.all()[0];
    const line = HIS.payrollRuns.lineFor(emp.id);
    const slip = HIS.payrollRuns.payslip(emp.id);
    return { runId: run.id, status: run.status, empId: emp.id, lineNet: line.net, slipNet: slip.line.net,
      linesMatch: slip.line.lines.length === line.lines.length, version: slip.version };
  });
  ok('the payslip is generated from the final run', r.runId && r.status === 'released', r.runId + '/' + r.status);
  ok('the payslip net equals the run line net', near(r.slipNet, r.lineNet), r.slipNet + ' vs ' + r.lineNet);
  ok('the payslip carries the same line count as the run', r.linesMatch === true);
}
{
  // Drive the real payslip dialog and read what it prints.
  await page.goto(BASE + '/payroll.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.click('[data-slip]');
  await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const text = document.querySelector('.pr-modal').innerText;
    const line = HIS.payrollRuns.lineFor('EMP-001');
    const money = n => '\u20b1' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return { text, net: money(line.net), gross: money(line.gross), sss: money(line.statutory.sss),
      employer: money(line.employer.total), rows: document.querySelectorAll('.pr-slip-row').length };
  });
  ok('the payslip dialog prints the computed net pay', r.text.indexOf(r.net) > -1, r.net);
  ok('the payslip dialog prints the computed gross pay', r.text.indexOf(r.gross) > -1, r.gross);
  ok('the payslip dialog prints the employee SSS share', r.text.indexOf(r.sss) > -1, r.sss);
  ok('the payslip dialog separates the employer contribution block', r.text.indexOf('Employer contributions are not deducted') > -1);
  ok('the payslip itemises more than a single breakdown line', r.rows >= 8, r.rows);
}

ok('the audit ran with no console errors', errs.length === 0, errs[0]);

// ---- machine-readable summary for the report ------------------------------------------------
await mkdir(path.join(ROOT, 'qa', 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'qa', 'audit', 'm10-acceptance.json'), JSON.stringify({
  at: new Date().toISOString(), pass, fail, failures
}, null, 2));

await ctx.close();
await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
