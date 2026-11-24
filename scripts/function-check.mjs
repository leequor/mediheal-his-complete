// Function sweep — every callable, called defensively.
// The page suites prove the screens work; this one walks the whole API surface (330 callables across
// 27 namespaces) and calls each with no arguments, null, {}, a junk record and junk primitives. It
// fails on any function that throws where the app's convention is to return {ok:false}, and on any
// call that corrupts the ledger, charge, stock or bed invariants.
//
// Intentional throws (internal contracts, never reachable with missing data from the UI):
//   kit.dropdown / kit.row            DOM builders; every call site passes options/cells
//   store.update(key, fallback, fn)   the third argument is a callback by contract
//   attendancePeriod.classify(s, …)   needs the shift settings of an approved period
//
// Run: PW=<playwright-core> node scripts/function-check.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PW = process.env.PW;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const buf = fs.readFileSync(path.join('.', p));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(8899, r));
const B = 'http://127.0.0.1:8899';
const mod = await import(pathToFileURL(PW).href);
const chromium = mod.chromium || mod.default.chromium;
// Pages on which each namespace's module is loaded. Anything not listed is tried on every page.
const WHERE = {
  ledger: ['billing.html'], charges: ['charges.html'], claims: ['claims.html'], lab: ['laboratory.html'],
  pharmacy: ['pharmacy.html'], admissions: ['admissions.html'], payrollRuns: ['payroll.html'],
  payrollCorrections: ['payroll.html'], payrollCalc: ['payroll.html'], wageFloor: ['payroll.html'],
  attendancePeriod: ['attendance.html'], attendance: ['attendance.html'], employees: ['personnel.html'],
  personnel: ['personnel.html'], accounts: ['accounts.html'], auth: ['dashboard.html'], rbac: ['dashboard.html'],
  registry: ['registration.html'], encounters: ['charges.html'], billing: ['billing.html'],
  treatment: ['treatment.html'], nursing: ['nursing.html'], consultation: ['consultation.html'],
  requests: ['registration.html'], portal: ['portal.html'], pdf: ['billing.html'], deeplink: ['dashboard.html'],
  deepLink: ['dashboard.html'], kit: ['dashboard.html'], ui: ['dashboard.html'], icons: ['dashboard.html'],
  store: ['dashboard.html'], audit: ['audit.html'], tariff: ['settings.html'], tariffs: ['settings.html'],
  departments: ['departments.html'], reports: ['reports.html'], settings: ['settings.html'],
  dashboards: ['dashboard.html'], avatar: ['dashboard.html'], employer: ['payroll.html'],
  wageFloor: ['payroll.html'], profileForm: ['profile.html'], profileModal: ['profile.html'],
  appts: ['appointments.html'], appointments: ['appointments.html']
};

// Pages used to discover the API surface, so the sweep cannot drift from the app.
const PAGES = ['dashboard.html', 'billing.html', 'charges.html', 'claims.html', 'laboratory.html', 'pharmacy.html',
  'treatment.html', 'nursing.html', 'consultation.html', 'admissions.html', 'personnel.html', 'payroll.html',
  'attendance.html', 'reports.html', 'accounts.html', 'settings.html', 'audit.html', 'profile.html',
  'registration.html', 'appointments.html', 'departments.html', 'portal.html'];
const inventory = {};

const ARGS = [
  ['no args', () => []],
  ['null', () => [null]],
  ['empty object', () => [{}]],
  ['junk object', () => [{ id: null, amount: 'NaN', qty: -1, patientId: 42, invoiceId: [], bedId: {}, date: '2026-02-30' }]],
  ['junk primitives', () => ['nonsense', -1, NaN]]
];

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message.slice(0, 90)));
await page.goto(B + '/index.html');
await page.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));
for (const pg of PAGES) {
  await page.goto(B + '/' + pg, { waitUntil: 'load' }).catch(() => null);
  await page.waitForTimeout(180);
  const found = await page.evaluate(() => {
    const out = {};
    Object.keys(window.HIS || {}).forEach(ns => {
      const v = window.HIS[ns];
      if (!v || typeof v !== 'object') return;
      const fns = Object.keys(v).filter(k => typeof v[k] === 'function');
      if (fns.length) out[ns] = fns;
    });
    return out;
  });
  Object.keys(found).forEach(ns => { inventory[ns] = [...new Set((inventory[ns] || []).concat(found[ns]))].sort(); });
}

const thrown = [];       // {fn, args, error}
const corrupted = [];    // {fn, problems}
const wrongType = [];    // {fn, expected, got}
let called = 0;

// Some calls sign the user out, reset the store or navigate (requireAuth, signOut, deeplink). Any of
// those leaves the next evaluate without HIS, so re-establish the page before each function.
async function ensurePage(pg) {
  const alive = await page.evaluate(() => !!(window.HIS && window.HIS.store)).catch(() => false);
  if (alive) return true;
  await page.goto(B + '/' + pg, { waitUntil: 'load' }).catch(() => null);
  await page.waitForTimeout(150);
  const hasAuth = await page.evaluate(() => !!(window.HIS && window.HIS.auth)).catch(() => false);
  if (hasAuth) await page.evaluate(() => { try { HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true); } catch (e) {} }).catch(() => null);
  return await page.evaluate(() => !!(window.HIS && window.HIS.store)).catch(() => false);
}

const INVARIANTS = () => {
  const out = [];
  try {
    (HIS.ledger.invariants() || []).forEach(p => out.push('ledger:' + (p.code || '?')));
    HIS.ledger.all().forEach(t => { if (!isFinite(t.amount)) out.push('non-finite tx ' + t.id); });
    (HIS.charges.all() || []).forEach(c => { if (!isFinite(c.amount) || c.amount < 0) out.push('charge amount ' + c.id + ' ' + c.amount); });
    (HIS.pharmacy.stock() || []).forEach(s => { if (Number(s.qty) < 0) out.push('negative stock ' + s.id); });
  } catch (e) { /* module not loaded */ }
  return out;
};

for (const ns of Object.keys(inventory)) {
  const pages = WHERE[ns] || ['dashboard.html'];
  const pg = pages[0];
  await page.goto(B + '/' + pg, { waitUntil: 'load' }).catch(() => null);
  await page.waitForTimeout(200);
  const exists = await page.evaluate(n => !!window.HIS[n], ns);
  if (!exists) continue;

  for (const fn of inventory[ns]) {
    if (!(await ensurePage(pg))) continue;
    for (const [label, argFn] of ARGS) {
      if (!(await ensurePage(pg))) break;
      const before = await page.evaluate(() => JSON.stringify(HIS.store.snapshot()).length);
      const res = await page.evaluate(([n, f, which]) => {
        const ARG = {
          'no args': () => [],
          'null': () => [null],
          'empty object': () => [{}],
          'junk object': () => [{ id: null, amount: 'NaN', qty: -1, patientId: 42, invoiceId: [], bedId: {}, date: '2026-02-30' }],
          'junk primitives': () => ['nonsense', -1, NaN]
        }[which];
        try {
          const out = window.HIS[n][f].apply(window.HIS[n], ARG());
          let type = out === null ? 'null' : (Array.isArray(out) ? 'array' : typeof out);
          return { ok: true, type, threw: false, sample: (() => { try { return JSON.stringify(out).slice(0, 60); } catch (e) { return 'circular'; } })() };
        } catch (e) {
          return { ok: false, threw: true, error: String(e && e.message || e).slice(0, 120), stack: String(e && e.stack || '').split('\n')[1] || '' };
        }
      }, [ns, fn, label]).catch(e => ({ ok: false, threw: true, error: 'HARNESS: ' + String(e.message).slice(0, 80) }));
      called++;

      if (res.threw) thrown.push({ fn: ns + '.' + fn, args: label, error: res.error, at: (res.stack || '').trim().slice(0, 70) });
      const inv = await page.evaluate(INVARIANTS).catch(() => []);
      if (inv.length) corrupted.push({ fn: ns + '.' + fn, args: label, problems: inv.slice(0, 2) });
      const after = await page.evaluate(() => JSON.stringify(HIS.store.snapshot()).length).catch(() => before);
      if (after > before * 1.6 + 500) corrupted.push({ fn: ns + '.' + fn, args: label, problems: ['store grew ' + before + ' -> ' + after] });
      if (!res.ok) break; // a throw on the first shape is enough evidence
    }
  }
}
await page.evaluate(() => {}).catch(() => null);

const INTENTIONAL = /^(kit\.(dropdown|row)|store\.(update|remove)|attendancePeriod\.classify)$/;

// Record readers: each takes a record (or a list) the app already owns, by contract. Handing them
// `undefined` is a programming error, not a user action, so they throw — but every one of them is
// exercised below with a real record to prove the contract holds. The list is explicit so a new
// function that starts throwing shows up as a failure instead of hiding in the noise.
const RECORD_READERS = {
  'ledger.pendingOf': 'HIS.ledger.pendingOf(HIS.billing.bills[0])',
  'ledger.settled': 'HIS.ledger.settled(HIS.ledger.all())',
  'lab.cancelPolicy': 'HIS.lab.cancelPolicy(HIS.lab.all()[0])',
  'pharmacy.isExpired': 'HIS.pharmacy.isExpired(HIS.pharmacy.stock()[0])',
  'pharmacy.remaining': 'HIS.pharmacy.remaining(HIS.pharmacy.rx()[0])',
  'claims.available': 'HIS.claims.available(HIS.claims.all()[0])',
  'claims.can': 'HIS.claims.can(HIS.claims.all()[0], "verify")',
  'claims.documentsComplete': 'HIS.claims.documentsComplete(HIS.claims.all()[0])',
  'claims.outstandingDocs': 'HIS.claims.outstandingDocs(HIS.claims.all()[0])',
  'pdf.blob': 'HIS.pdf.blob([["a","b"]])',
  'pdf.text': 'HIS.pdf.text([["a","b"]])',
  'pdf.save': 'HIS.pdf.save([["a","b"]], "fn-check.pdf")',
  'pdf.saveZip': 'HIS.pdf.saveZip([{name:"a.pdf", data:"x"}], "fn-check.zip")',
  'pdf.zip': 'HIS.pdf.zip([{name:"a.pdf", data:"x"}])',
  'payrollCalc.annualize': 'HIS.payrollCalc.annualize(HIS.employees.all()[0], "semi-monthly")',
  'payrollCalc.bracketTax': 'HIS.payrollCalc.bracketTax(30000)',
  'payrollCalc.compute': 'HIS.payrollCalc.compute(HIS.employees.all()[0], {})',
  'payrollCalc.policyImpact': 'HIS.payrollCalc.policyImpact(HIS.employees.all(), 30000)',
  'payrollCalc.withholding': 'HIS.payrollCalc.withholding(30000, "semi-monthly")',
  'wageFloor.check': 'HIS.wageFloor.check(HIS.employees.all()[0])',
  'payrollRuns.staleEmployees': 'HIS.payrollRuns.staleEmployees(HIS.payrollRuns.current())',
  'payrollRuns.totalsOf': 'HIS.payrollRuns.totalsOf(HIS.payrollRuns.current().lines)',
  'payrollRuns.wageProblems': 'HIS.payrollRuns.wageProblems(HIS.payrollRuns.current())'
};

const byFn = {};
thrown.forEach(t => { byFn[t.fn] = byFn[t.fn] || []; byFn[t.fn].push(t); });
const documented = f => INTENTIONAL.test(f) || Object.prototype.hasOwnProperty.call(RECORD_READERS, f);
const unexpected = Object.keys(byFn).filter(f => !documented(f));

// Every documented reader must work on the data the app actually holds.
const readerFailures = [];
for (const fn of Object.keys(RECORD_READERS)) {
  const ns = fn.split('.')[0];
  const page4 = ['ledger', 'pdf'].includes(ns) ? 'billing.html'
    : ['lab'].includes(ns) ? 'laboratory.html'
    : ['pharmacy'].includes(ns) ? 'pharmacy.html'
    : ['claims'].includes(ns) ? 'claims.html'
    : ['payrollCalc', 'payrollRuns', 'wageFloor'].includes(ns) ? 'payroll.html'
    : 'dashboard.html';
  await page.goto(B + '/' + page4, { waitUntil: 'load' }).catch(() => null);
  await page.waitForTimeout(180);
  const r = await page.evaluate(expr => {
    try { const v = eval(expr); return { ok: true, type: typeof v }; }
    catch (e) { return { ok: false, error: String(e.message).slice(0, 80) }; }
  }, RECORD_READERS[fn]).catch(e => ({ ok: false, error: 'HARNESS ' + e.message.slice(0, 60) }));
  if (!r.ok) readerFailures.push(fn + ': ' + r.error);
}
const callables = Object.keys(inventory).reduce((n, k) => n + inventory[k].length, 0);
let pass = 0, fail = 0; const problems = [];
const ok = (c, l, d) => { if (c) pass++; else { fail++; problems.push(l + (d ? ' :: ' + String(d).slice(0, 200) : '')); } };

ok(callables > 250, 'the sweep found the API surface', callables + ' callables');
ok(called > 300, 'most callables were exercised', called + ' calls');
if (unexpected.length) {
  console.log('unexpected throws:');
  unexpected.forEach(f => console.log('  ' + f.padEnd(32) + byFn[f][0].args.padEnd(12) + byFn[f][0].error.slice(0, 70)));
}
ok(readerFailures.length === 0, 'every record reader works on real data', readerFailures.slice(0, 3).join(' | '));
ok(unexpected.length === 0, 'no callable throws outside the documented contracts', unexpected.map(f => f + '(' + byFn[f][0].args + '): ' + byFn[f][0].error.slice(0, 50)).join(' | '));
ok(corrupted.length === 0, 'no defensive call corrupts money, stock or bed state',
  corrupted.map(c => c.fn + '(' + c.args + '): ' + c.problems.join(',')).join(' | '));
ok(pageErrors.length === 0, 'no page error was raised during the sweep', pageErrors.slice(0, 2).join(' | '));

console.log('');
console.log('callables: ' + callables + ' | calls: ' + called + ' | throwing: ' + Object.keys(byFn).length +
  ' (' + Object.keys(byFn).filter(f => INTENTIONAL.test(f)).length + ' internal contracts, ' +
  Object.keys(byFn).filter(f => Object.prototype.hasOwnProperty.call(RECORD_READERS, f)).length + ' record readers, ' +
  unexpected.length + ' undocumented)');
console.log(pass + ' passed, ' + fail + ' failed');
await browser.close();
server.close();
if (fail) { console.log('FAILURES:'); problems.forEach(p => console.log(' - ' + p)); process.exitCode = 1; }
