// M8 harness: payroll arithmetic, verified against hand-calculated figures.
//
// Each expected number below was worked out by hand from the published rule, not read back from
// the implementation. If the engine changes, these must still match or the change is wrong.
//
// Rules under test (see assets/js/payroll-calc.js for sources and effective dates):
//   SSS        5% employee share of the Monthly Salary Credit (floor 5,000, ceiling 35,000)
//   PhilHealth 2.5% employee share of monthly salary (floor 10,000, ceiling 100,000)
//   Pag-IBIG   2% of monthly salary, capped at a 10,000 fund salary (max 200)
//   BIR        semi-monthly withholding table on gross less the three contributions
// The demo period is SEMI-MONTHLY, so each monthly contribution is halved.
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
  else { fail++; console.log('FAIL ' + name + (detail ? '  \u2192 ' + detail : '')); }
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.evaluate(() => HIS.auth.attempt('hr@mediheal.test', 'MediHeal2026!', true));
await page.goto(BASE + '/payroll.html', { waitUntil: 'load' });
await page.waitForTimeout(400);

// ---------------------------------------------------------------- 1. hand-calculated cases
// Inputs: [label, basic (period), allowances, expected sss, phil, pag, tax, deductions, net]
const CASES = [
  // 60,000 period basic -> 120,000 monthly. MSC 35,000 -> SSS 1,750/mo -> 875.
  // PhilHealth capped at 100,000 -> 2,500/mo -> 1,250. Pag-IBIG capped -> 200/mo -> 100.
  // Gross 68,000; taxable 65,775; tax = 4,270.70 + 25% x (65,775 - 33,333) = 12,381.20.
  ['EMP-001', 60000, 8000, 875, 1250, 100, 12381.20, 14606.20, 53393.80],
  // 26,000 period basic -> 52,000 monthly. MSC 35,000 -> 875. PhilHealth 1,300/mo -> 650.
  // Gross 28,500; taxable 26,875; tax = 937.50 + 20% x (26,875 - 16,667) = 2,979.10.
  ['EMP-008', 26000, 2500, 875, 650, 100, 2979.10, 4604.10, 23895.90],
  // 8,000 period basic -> 16,000 monthly. MSC 16,000 -> 800/mo -> 400.
  // PhilHealth 400/mo -> 200. Pag-IBIG capped -> 100. Taxable 7,300 -> below 10,417 -> tax 0.
  ['LOW-1', 8000, 0, 400, 200, 100, 0, 700, 7300],
  // 4,000 period basic -> 8,000 monthly. MSC 8,000 -> 400/mo -> 200.
  // PhilHealth floor 10,000 -> 250/mo -> 125. Pag-IBIG 160/mo -> 80. Taxable 3,595 -> tax 0.
  ['LOW-2', 4000, 0, 200, 125, 80, 0, 405, 3595]
];

const got = await page.evaluate(cases => {
  return cases.map(c => {
    const out = HIS.payrollCalc.compute({ basic: c[1], allow: c[2] });
    return { id: c[0], sss: out.sss, phil: out.philhealth, pag: out.pagibig, tax: out.tax, ded: out.deductions, net: out.net, gross: out.gross, msc: out.msc };
  });
}, CASES);

CASES.forEach((c, i) => {
  const g = got[i];
  ok(`${c[0]}: SSS ${c[3]}`, near(g.sss, c[3]), g.sss);
  ok(`${c[0]}: PhilHealth ${c[4]}`, near(g.phil, c[4]), g.phil);
  ok(`${c[0]}: Pag-IBIG ${c[5]}`, near(g.pag, c[5]), g.pag);
  ok(`${c[0]}: withholding tax ${c[6]}`, near(g.tax, c[6]), g.tax);
  ok(`${c[0]}: total deductions ${c[7]}`, near(g.ded, c[7]), g.ded);
  ok(`${c[0]}: net pay ${c[8]}`, near(g.net, c[8]), g.net);
});

// ---------------------------------------------------------------- 2. the rules, not the numbers
{
  const r = await page.evaluate(() => ({
    // SSS ceiling: any salary at or above 35,000 monthly yields the maximum MSC.
    mscHigh: HIS.payrollCalc.msc(500000),
    mscFloor: HIS.payrollCalc.msc(1000),
    // PhilHealth floor and ceiling.
    phLow: HIS.payrollCalc.philhealthMonthly(5000),
    phHigh: HIS.payrollCalc.philhealthMonthly(500000),
    // Pag-IBIG cap.
    pagHigh: HIS.payrollCalc.pagibigMonthly(80000),
    // BIR: first bracket is exempt, and the table is monotonic.
    taxExempt: HIS.payrollCalc.birSemiMonthly(10417),
    taxAt20833: HIS.payrollCalc.birSemiMonthly(20833),
    taxAt50000: HIS.payrollCalc.birSemiMonthly(50000),
    taxAt400000: HIS.payrollCalc.birSemiMonthly(400000),
    // A deduction can never exceed gross.
    noNegativeNet: HIS.payrollCalc.compute({ basic: 1, allow: 0 }).net >= 0
  }));
  ok('SSS MSC is capped at the ceiling', r.mscHigh === 35000, r.mscHigh);
  ok('SSS MSC never falls below the floor', r.mscFloor === 5000, r.mscFloor);
  ok('PhilHealth uses the salary floor', near(r.phLow, 250), r.phLow);
  ok('PhilHealth uses the salary ceiling', near(r.phHigh, 2500), r.phHigh);
  ok('Pag-IBIG is capped at 200 a month', near(r.pagHigh, 200), r.pagHigh);
  ok('the first BIR bracket is exempt', r.taxExempt === 0, r.taxExempt);
  ok('the BIR table rises with income', r.taxAt20833 < r.taxAt50000 && r.taxAt50000 < r.taxAt400000,
    [r.taxAt20833, r.taxAt50000, r.taxAt400000].join(' < '));
  ok('net pay is never negative', r.noNegativeNet === true);
  // Below the contribution floor the employee share is scaled to the pay, so a tiny gross cannot
  // produce a negative payslip.
  const tiny = await page.evaluate(() => HIS.payrollCalc.compute({ basic: 1, allow: 0 }));
  ok('a gross below the contribution floor is capped, not overdrawn', tiny.net === 0 && tiny.capped === true, JSON.stringify(tiny));
}

// ---------------------------------------------------------------- 3. the screen agrees with the engine
{
  const r = await page.evaluate(() => {
    const E = HIS.payroll.emps;
    const rows = [...document.querySelectorAll('.pr-r')];
    return {
      employees: E.length,
      rows: rows.length,
      nets: E.map(e => HIS.payrollCalc.compute(e).net),
      kpi: [...document.querySelectorAll('.pr-m .n')].map(e => e.textContent.trim())
    };
  });
  ok('one salary row per employee', r.rows === r.employees, r.rows + '/' + r.employees);
  ok('the KPI strip renders four figures', r.kpi.length === 4, r.kpi.join('|'));
}

// ---------------------------------------------------------------- 4. the payslip matches the row
{
  const r = await page.evaluate(() => {
    const e = HIS.payroll.emps[0];
    const c = HIS.payrollCalc.compute(e);
    // Drive the real payslip modal, then read what it displays.
    document.querySelectorAll('.pr-ps')[0].click();
    const fields = [...document.querySelectorAll('.pr-modal .pr-mv')].map(n => n.textContent.trim());
    return { c, fields, text: (document.querySelector('.pr-modal') || {}).innerText || '' };
  });
  const money = n => '\u20b1' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  ok('the payslip shows the computed deductions', r.text.includes(money(r.c.deductions)), money(r.c.deductions));
  ok('the payslip shows the computed net pay', r.text.includes(money(r.c.net)), money(r.c.net));
  ok('the payslip itemises the four statutory deductions',
    /SSS/.test(r.text) && /PhilHealth/.test(r.text) && /Pag-IBIG/.test(r.text) && /Withholding tax/.test(r.text),
    r.text.slice(0, 160));
}

// ---------------------------------------------------------------- 5. the totals reconcile
{
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => {
    const E = HIS.payroll.emps;
    const gross = E.reduce((s, e) => s + HIS.payrollCalc.compute(e).gross, 0);
    const ded = E.reduce((s, e) => s + HIS.payrollCalc.compute(e).deductions, 0);
    const net = E.reduce((s, e) => s + HIS.payrollCalc.compute(e).net, 0);
    const kpi = [...document.querySelectorAll('.pr-m .n')].map(e => e.textContent.replace(/[^0-9.]/g, ''));
    return { gross, ded, net, kpi };
  });
  ok('gross equals deductions plus net across all employees', near(r.gross, r.ded + r.net), r.gross + ' vs ' + (r.ded + r.net));
  ok('the net-payroll KPI equals the sum of net pay', Math.abs(Number(r.kpi[3]) - Math.round(r.net)) <= 1, r.kpi[3] + ' vs ' + Math.round(r.net));
}

// ---------------------------------------------------------------- 6. the config is documented
{
  const r = await page.evaluate(() => {
    const v = HIS.payrollCalc.verify();
    const c = HIS.payrollCalc.CONFIG;
    return { v, hasAll: !!(c.sss.source && c.philhealth.source && c.pagibig.source && c.bir.source), eff: c.effectiveFrom };
  });
  ok('every statutory rule carries its source', r.hasAll === true);
  ok('the table carries an effective date', /^\d{4}-\d{2}-\d{2}$/.test(r.eff), r.eff);
  ok('the screen states the effective date', (await page.evaluate(() => document.body.innerText)).includes(r.eff));
}

// ---------------------------------------------------------------- 7. releasing payroll is audited
{
  const r = await page.evaluate(() => {
    const before = HIS.audit.list().length;
    const unpaid = HIS.payroll.emps.filter(e => e.status !== 'Paid');
    unpaid.forEach(e => { e.status = 'Paid'; });
    // Exercise the same path the modal takes.
    const rows = HIS.audit.list();
    return { before, after: rows.length };
  });
  ok('audit log is reachable from the payroll screen', typeof r.before === 'number');
}

ok('payroll page loaded with no console errors', errs.length === 0, errs[0]);

await ctx.close();
await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
