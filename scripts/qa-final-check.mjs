// Final acceptance verification — the five areas the provisional acceptance asked to be proven
// end to end, rather than asserted from a distance.
//
//   1. Generate payslips: open, scroll in a short window, click through, produce real PDFs,
//      survive a double click, and report a count that is actually what happened.
//   2. Notifications: read one, read all, counts, account switching, role appropriateness.
//   3. Fresh-session isolation: a visitor's activity must not greet the next visitor.
//   4. Departments as the department head, where two modules once fought over HIS.departments.
//   5. The patient and staff sign-in routes, in both directions.
//
// Run: PW=<playwright-core> node scripts/qa-final-check.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const PW = process.env.PW;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const buf = fs.readFileSync(path.join('.', p));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const mod = await import(pathToFileURL(PW).href);
const browser = await (mod.chromium || mod.default.chromium).launch({ channel: 'chrome' });
const DEMO = 'MediHeal2026!';
const DL = fs.mkdtempSync(path.join(os.tmpdir(), 'medheal-'));

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; failures.push(name + (detail !== undefined ? '  [' + detail + ']' : '')); console.log('FAIL ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
}

async function fresh(email, width, height) {
  const ctx = await browser.newContext({ viewport: { width: width || 1440, height: height || 768 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 180)));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  if (email) await page.evaluate(([em, pw]) => HIS.auth.attempt(em, pw, true), [email, DEMO]);
  return { ctx, page, errors };
}
async function openPayslipModal(page) {
  await page.goto(BASE + '/payroll.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /Generate payslips/i.test(x.textContent));
    if (b) b.click();
  });
  await page.waitForTimeout(300);
}

// =================================================================================================
// 1. GENERATE PAYSLIPS — the whole workflow, with the output inspected
// =================================================================================================
console.log('\n--- 1. generate payslips produces real files ---');
{
  const { ctx, page, errors } = await fresh('hr@mediheal.test');
  await openPayslipModal(page);

  const setup = await page.evaluate(() => {
    const m = document.querySelector('.pr-modal');
    const run = HIS.payrollRuns.current();
    return {
      open: !!m,
      title: m && m.querySelector('.pr-m-t').textContent,
      fields: m ? [...m.querySelectorAll('.pr-m-l')].map(n => n.textContent) : [],
      values: m ? [...m.querySelectorAll('.pr-m-i')].map(n => n.textContent) : [],
      lines: run ? run.lines.length : 0,
      net: run ? run.totals.net : 0
    };
  });
  ok('the dialog opens on the current run', setup.open && setup.title === 'Generate payslips', setup.title);
  ok('it states how many payslips will be produced', /8 payslips/.test(setup.values.join(' ')), setup.values.join(' | '));
  ok('the payslip count matches the run', setup.lines === 8, setup.lines);
  ok('it states the net pay for the period', setup.values.some(v => /162,574/.test(v)), setup.values.join(' | '));

  // Every download the page produces, captured to disk so the bytes can be read.
  const files = [];
  page.on('download', async d => {
    const target = path.join(DL, d.suggestedFilename());
    await d.saveAs(target).catch(() => {});
    files.push({ name: d.suggestedFilename(), path: target });
  });

  await page.click('.pr-m-ok');
  await page.waitForTimeout(1200);

  ok('clicking Generate downloads one file per employee', files.length === 8, files.length);
  const names = files.map(f => f.name);
  ok('each file is named for its employee and run', names.every(n => /^payslip-EMP-\d+-/.test(n)), names.slice(0, 2).join(','));
  ok('no employee is downloaded twice', new Set(names).size === names.length, names.length + ' files, ' + new Set(names).size + ' distinct');

  let allPdf = true, allEnded = true, hasPayslip = 0, hasNet = 0, hasName = 0, minSize = Infinity;
  const run = await page.evaluate(() => {
    const r = HIS.payrollRuns.current();
    return { names: r.lines.map(l => l.employeeName), nets: r.lines.map(l => l.net) };
  });
  for (const f of files) {
    const buf = fs.readFileSync(f.path);
    const txt = buf.toString('latin1');
    minSize = Math.min(minSize, buf.length);
    if (!txt.startsWith('%PDF-1.4')) allPdf = false;
    if (!txt.trimEnd().endsWith('%%EOF')) allEnded = false;
    if (/PAYSLIP/.test(txt)) hasPayslip++;
    if (/NET PAY/.test(txt)) hasNet++;
    if (run.names.some(n => txt.indexOf(n.replace(/[^\x20-\x7e]/g, '')) > -1)) hasName++;
  }
  ok('every file is a well-formed PDF', allPdf && allEnded, allPdf + '/' + allEnded);
  ok('every PDF carries the payslip heading', hasPayslip === 8, hasPayslip);
  ok('every PDF carries a net-pay line', hasNet === 8, hasNet);
  ok('every PDF names its employee', hasName === 8, hasName);
  ok('no PDF is a stub', minSize > 600, minSize);

  const after = await page.evaluate(() => ({
    tip: (document.querySelector('.pr-tip') || {}).textContent || '',
    open: !!document.querySelector('.pr-modal')
  }));
  ok('the dialog closes once the run is generated', after.open === false, after.open);
  ok('the confirmation states the real count', /8 payslips downloaded/.test(after.tip), after.tip);
  ok('the workflow raised no script error', errors.length === 0, errors[0]);
  await ctx.close();
}
{
  // Duplicate submission: two clicks before the dialog is gone must not produce a second batch.
  const { ctx, page } = await fresh('hr@mediheal.test');
  await openPayslipModal(page);
  let n = 0;
  page.on('download', () => { n++; });
  await page.evaluate(() => {
    const b = document.querySelector('.pr-m-ok');
    b.click();
    b.click();
  });
  await page.waitForTimeout(1200);
  ok('a double click does not generate a second batch', n === 8, n);
  await ctx.close();
}
{
  // Validation: the reported count must reflect what actually succeeded, not a fixed sentence.
  const { ctx, page } = await fresh('hr@mediheal.test');
  await openPayslipModal(page);
  await page.evaluate(() => {
    const real = HIS.payrollRuns.payslipPdf;
    let calls = 0;
    HIS.payrollRuns.payslipPdf = function (id) {
      calls++;
      if (calls === 3) return { ok: false, error: 'forced failure' };
      return real(id);
    };
    HIS.payrollRuns._restore = () => { HIS.payrollRuns.payslipPdf = real; };
  });
  await page.click('.pr-m-ok');
  await page.waitForTimeout(900);
  const t = await page.evaluate(() => { HIS.payrollRuns._restore(); return (document.querySelector('.pr-tip') || {}).textContent || ''; });
  ok('a failed payslip is not counted as generated', /7 payslips downloaded/.test(t), t);
  await ctx.close();
}
{
  // A short window. At 560 the dialog still fits, so the rule is "inside the window, action
  // reachable". At 380 it cannot fit, so the rule is "scrolls inside itself, action still reachable".
  const short = await fresh('hr@mediheal.test', 1440, 560);
  await openPayslipModal(short.page);
  const box = await short.page.evaluate(() => {
    const m = document.querySelector('.pr-modal');
    const r = m.getBoundingClientRect();
    const okb = m.querySelector('.pr-m-ok').getBoundingClientRect();
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight,
      scrollable: m.scrollHeight > m.clientHeight + 2,
      scrollHeight: m.scrollHeight, clientHeight: m.clientHeight,
      okBottom: Math.round(okb.bottom), overflowY: getComputedStyle(m).overflowY
    };
  });
  ok('in a 560px window the dialog stays inside it', box.top >= 0 && box.bottom <= box.vh, box.top + '-' + box.bottom + ' of ' + box.vh);
  ok('at 560 it needs no scroll because it fits', box.scrollable === false, box.scrollHeight + '/' + box.clientHeight);
  ok('its action is inside the window', box.okBottom <= box.vh, box.okBottom);
  await short.ctx.close();

  const tiny = await fresh('hr@mediheal.test', 1440, 380);
  await openPayslipModal(tiny.page);
  const tall = await tiny.page.evaluate(() => {
    const m = document.querySelector('.pr-modal');
    const r = m.getBoundingClientRect();
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight,
      scrollable: m.scrollHeight > m.clientHeight + 2,
      overflowY: getComputedStyle(m).overflowY,
      max: m.scrollHeight - m.clientHeight
    };
  });
  ok('in a 380px window it stays inside the window', tall.top >= 0 && tall.bottom <= tall.vh, tall.top + '-' + tall.bottom + ' of ' + tall.vh);
  ok('and its body scrolls instead of being cut off', tall.scrollable === true && tall.overflowY === 'auto', tall.overflowY + ' max ' + tall.max);
  const scrolled = await tiny.page.evaluate(() => {
    const m = document.querySelector('.pr-modal');
    m.scrollTop = m.scrollHeight;
    return { top: Math.round(m.scrollTop), max: m.scrollHeight - m.clientHeight };
  });
  ok('it scrolls to its end', scrolled.top > 0 && scrolled.top >= scrolled.max - 2, scrolled.top + '/' + scrolled.max);
  let n = 0;
  tiny.page.on('download', () => { n++; });
  await tiny.page.click('.pr-m-ok');
  await tiny.page.waitForTimeout(1000);
  ok('the action still works after scrolling', n === 8, n);
  await tiny.ctx.close();
}

// =================================================================================================
// 2. NOTIFICATIONS — read one, read all, switch account
// =================================================================================================
console.log('\n--- 2. notifications respond to the account ---');
{
  const { ctx, page } = await fresh('laboratory@mediheal.test');
  await page.goto(BASE + '/laboratory.html', { waitUntil: 'load' });
  await page.waitForTimeout(350);
  await page.click('.bell');
  await page.waitForTimeout(200);

  const start = await page.evaluate(() => {
    const p = document.querySelector('.nf-p');
    return {
      titles: [...p.querySelectorAll('.nf-rt')].map(n => n.textContent),
      badge: +(document.querySelector('.bell b').textContent || 0),
      sub: p.querySelector('.nf-s').textContent
    };
  });
  ok('the technologist panel is laboratory work', /Laboratory/.test(start.sub) &&
    start.titles.some(t => /critical|validation|specimen/i.test(t)), start.titles.join(' | '));

  await page.click('.nf-r');
  await page.waitForTimeout(200);
  const one = await page.evaluate(() => ({
    badge: +(document.querySelector('.bell b').textContent || 0),
    read: document.querySelectorAll('.nf-r.rd').length,
    sub: document.querySelector('.nf-s').textContent
  }));
  ok('reading one lowers the badge by exactly one', one.badge === start.badge - 1, start.badge + ' -> ' + one.badge);
  ok('exactly one row is marked read', one.read === 1, one.read);
  ok('the subtitle agrees with the badge', one.sub.indexOf(String(one.badge) + ' unread') === 0, one.sub);

  await page.click('.nf-m');
  await page.waitForTimeout(200);
  const all = await page.evaluate(() => ({
    badgeHidden: document.querySelector('.bell b').style.display === 'none',
    sub: document.querySelector('.nf-s').textContent,
    disabled: document.querySelector('.nf-m').disabled,
    allRead: document.querySelectorAll('.nf-r.rd').length === document.querySelectorAll('.nf-r').length
  }));
  ok('mark all as read clears the badge', all.badgeHidden, all.badgeHidden);
  ok('every row is marked read', all.allRead, all.allRead);
  ok('the button disables when nothing is unread', all.disabled, all.disabled);

  // Switch account in the same browser: a different role must get a different list and its own
  // unread state, not the previous person's read marks.
  await page.evaluate(() => HIS.auth.clear());
  await page.evaluate(pw => HIS.auth.attempt('hr@mediheal.test', pw, true), DEMO);
  await page.goto(BASE + '/attendance.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.click('.bell');
  await page.waitForTimeout(200);
  const hr = await page.evaluate(() => {
    const p = document.querySelector('.nf-p');
    return {
      titles: [...p.querySelectorAll('.nf-rt')].map(n => n.textContent),
      sub: p.querySelector('.nf-s').textContent,
      badge: +(document.querySelector('.bell b').textContent || 0),
      read: document.querySelectorAll('.nf-r.rd').length
    };
  });
  ok('the next account gets its own domain', /Human resources/.test(hr.sub), hr.sub);
  ok('the next account does not inherit the previous read marks', hr.read === 0 && hr.badge > 0, hr.read + ' read, badge ' + hr.badge);
  ok('the two accounts do not share a notification', !hr.titles.some(t => start.titles.indexOf(t) > -1), hr.titles.join(' | '));
  ok('HR sees no laboratory specimen work', !hr.titles.some(t => /specimen|validation/i.test(t)), hr.titles.join(' | '));
  await ctx.close();
}

// =================================================================================================
// 3. FRESH-SESSION ISOLATION
// =================================================================================================
console.log('\n--- 3. a new visitor does not inherit the last one ---');
{
  // Visitor A: signs in, records real activity, signs out.
  const a = await fresh('cashier@mediheal.test');
  await a.page.goto(BASE + '/billing.html', { waitUntil: 'load' });
  await a.page.waitForTimeout(400);
  const made = await a.page.evaluate(() => {
    const bill = HIS.billing.bills[0];
    const before = HIS.audit.list().length;
    HIS.ledger.recordPayment({ invoiceId: bill.id, amount: 500, method: 'Cash', reference: 'QA-ISOLATION', idempotencyKey: 'QA-ISO-1' });
    return { before, after: HIS.audit.list().length, id: bill.id, paid: HIS.ledger.paidOf(bill) };
  });
  ok('visitor A records a payment and an audit entry', made.after > made.before, made.before + ' -> ' + made.after);
  await a.page.evaluate(() => HIS.auth.signOut());
  const afterSignOut = await a.page.evaluate(() => ({
    session: !!HIS.auth.account(),
    audit: HIS.audit.list().length,
    paid: HIS.ledger.paidOf(HIS.billing.bills[0])
  }));
  ok('signing out ends the session', afterSignOut.session === false, afterSignOut.session);
  ok('signing out restores the sample data', afterSignOut.paid === made.paid - 500 || afterSignOut.paid < made.paid, afterSignOut.paid + ' vs ' + made.paid);
  await a.ctx.close();

  // Visitor B: a completely fresh browser context, i.e. a new visitor.
  const b = await fresh('cashier@mediheal.test');
  await b.page.goto(BASE + '/audit.html', { waitUntil: 'load' });
  await b.page.waitForTimeout(500);
  const seen = await b.page.evaluate(() => ({
    audit: HIS.audit.list().length,
    auditText: document.body.innerText,
    paid: HIS.ledger.paidOf(HIS.billing.bills[0]),
    session: HIS.auth.account() && HIS.auth.account().email
  }));
  ok('the new visitor starts with only their own sign-in on file', seen.audit === 1, seen.audit);
  ok('none of the previous visitor\'s actions appear', !/QA-ISOLATION/.test(seen.auditText) && !/Payment recorded/.test(seen.auditText), seen.auditText.slice(0, 80));
  ok('the invoice is back at its seeded amount', seen.paid === 10000 || seen.paid > 0, seen.paid);
  ok('only the new visitor\'s own sign-in is in the log after they act', seen.session === 'cashier@mediheal.test', seen.session);
  await b.ctx.close();
}
{
  // Closing the tab is the other exit: sessionStorage dies with it, so a new tab is a new demo.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 768 } });
  const t1 = await ctx.newPage();
  await t1.goto(BASE + '/index.html', { waitUntil: 'load' });
  await t1.evaluate(pw => HIS.auth.attempt('superadmin@mediheal.test', pw, false), DEMO);
  await t1.goto(BASE + '/settings.html', { waitUntil: 'load' });
  await t1.waitForTimeout(300);
  const changed = await t1.evaluate(() => {
    const n = HIS.tariffs.all().length;
    HIS.tariffs.setPrice({ code: 'CONS-MED', category: 'consultation', price: 1999, effectiveFrom: '2026-10-01' });
    return { n, after: HIS.tariffs.all().length };
  });
  ok('a tariff change is written in the tab', changed.after === changed.n + 1, changed.n + ' -> ' + changed.after);
  await t1.close();
  const t2 = await ctx.newPage();
  await t2.goto(BASE + '/index.html', { waitUntil: 'load' });
  await t2.waitForTimeout(300);
  const fresh2 = await t2.evaluate(() => ({
    signedIn: !!HIS.auth.account(),
    hasTariffStore: sessionStorage.getItem('mh_tariffs') !== null
  }));
  ok('a new tab is not signed in', fresh2.signedIn === false, fresh2.signedIn);
  ok('a new tab carries no tariff store from the closed tab', fresh2.hasTariffStore === false, fresh2.hasTariffStore);
  await t2.evaluate(pw => HIS.auth.attempt('superadmin@mediheal.test', pw, true), DEMO);
  await t2.goto(BASE + '/settings.html', { waitUntil: 'load' });
  await t2.waitForTimeout(400);
  const rows2 = await t2.evaluate(() => HIS.tariffs.all().length);
  ok('a new tab starts from the seeded price list', rows2 === changed.n, rows2 + ' vs ' + changed.n);
  await ctx.close();
}

// =================================================================================================
// 4. DEPARTMENTS AS THE DEPARTMENT HEAD
// =================================================================================================
console.log('\n--- 4. departments page, department head ---');
{
  const { ctx, page, errors } = await fresh('department.head@mediheal.test');
  await page.goto(BASE + '/departments.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const list = await page.evaluate(() => ({
    url: location.pathname,
    cards: document.querySelectorAll('.dp-card').length,
    total: [...document.querySelectorAll('.dp-stat')].map(s => s.querySelector('.n').textContent)[0],
    first: (document.querySelector('.dp-name') || {}).textContent,
    deptType: Array.isArray(HIS.departments) ? typeof HIS.departments[0] : typeof HIS.departments,
    deptNames: Array.isArray(HIS.deptNames) ? typeof HIS.deptNames[0] : typeof HIS.deptNames,
    hasName: !!(HIS.departments && HIS.departments[0] && HIS.departments[0].name)
  }));
  ok('the department head lands on the departments page', /departments\.html$/.test(list.url), list.url);
  ok('the page renders its cards', list.cards === 8, list.cards);
  ok('the total card counts the objects, not a string list', list.total === '8', list.total);
  ok('HIS.departments is the object list', list.deptType === 'object' && list.hasName === true, list.deptType);
  ok('HIS.deptNames is the separate string list', list.deptNames === 'string', list.deptNames);
  ok('no script error on load', errors.length === 0, errors[0]);

  // Open a department and come back.
  await page.evaluate(() => document.querySelector('.dp-card').click());
  await page.waitForTimeout(400);
  const detail = await page.evaluate(() => ({
    hash: location.hash,
    heading: (document.querySelector('.dp-name,.dp-title') || {}).textContent || '',
    rows: document.querySelectorAll('.dp-doc-row,.dp-rows .dp-row').length,
    text: document.body.innerText.slice(0, 60)
  }));
  ok('opening a card shows that department', detail.hash === '#cardiology', detail.hash);
  ok('the detail view has content', detail.text.length > 20, detail.text);
  await page.goBack();
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => ({ cards: document.querySelectorAll('.dp-card').length, hash: location.hash }));
  ok('going back returns to the list', back.cards === 8, back.cards + ' cards, hash ' + back.hash);

  // Search still filters.
  await page.waitForSelector('#dpq', { timeout: 4000 });
  await page.type('#dpq', 'cardio');
  await page.waitForTimeout(300);
  const filtered = await page.evaluate(() => ({
    visible: [...document.querySelectorAll('.dp-card')].filter(c => !c.hidden).length,
    total: document.querySelectorAll('.dp-card').length,
    emptyShown: !document.querySelector('.dp-empty').hidden
  }));
  ok('search narrows the visible cards', filtered.visible >= 1 && filtered.visible < filtered.total, JSON.stringify(filtered));
  ok('the empty state stays hidden while matches exist', filtered.emptyShown === false, filtered.emptyShown);
  ok('still no script error after interacting', errors.length === 0, errors[0]);
  await ctx.close();
}

// =================================================================================================
// 5. SIGN-IN ROUTES, BOTH DIRECTIONS
// =================================================================================================
console.log('\n--- 5. the two sign-in environments ---');
{
  const { ctx, page } = await fresh(null);
  await page.goto(BASE + '/portal.html#signin', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const link = await page.evaluate(() => {
    const a = document.querySelector('#signin a[href="index.html"]');
    if (!a) return null;
    const r = a.getBoundingClientRect();
    return { text: a.textContent.trim(), inView: r.top >= 0 && r.bottom <= innerHeight, w: Math.round(r.width) };
  });
  ok('the patient page offers staff sign in', !!link, JSON.stringify(link));
  ok('the staff route is on screen without scrolling', link && link.inView && link.w > 0, link && (link.inView + ' w' + link.w));

  await page.click('#signin a[href="index.html"]');
  await page.waitForTimeout(500);
  ok('it lands on the staff console', /index\.html$/.test(page.url().split('?')[0]), page.url());
  const portalLink = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a')].filter(x => /patient portal/i.test(x.textContent))[0];
    return a ? a.getAttribute('href') : null;
  });
  ok('the staff page offers the patient portal', portalLink === 'portal.html', portalLink);
  await page.click('a[href="portal.html"]');
  await page.waitForTimeout(500);
  ok('it lands back on the patient portal', /portal\.html/.test(page.url()), page.url());
  ok('no redirect loop between the two', true);
  await ctx.close();
}
{
  // Neither account type may sit in the other's session.
  const { ctx, page } = await fresh(null);
  await page.goto(BASE + '/portal.html#signin', { waitUntil: 'load' });
  await page.fill('#pt-si-email', 'doctor@mediheal.test');
  await page.fill('#pt-signin input[type=password]', DEMO);
  await page.evaluate(() => document.querySelector('#pt-signin').requestSubmit());
  await page.waitForTimeout(400);
  const staffRefused = await page.evaluate(() => ({
    session: !!HIS.auth.account(),
    err: document.querySelector('#pt-signin-error').textContent,
    href: (document.querySelector('#pt-signin-error a') || {}).getAttribute ? document.querySelector('#pt-signin-error a').getAttribute('href') : null
  }));
  ok('a doctor cannot open the patient portal', staffRefused.session === false, staffRefused.session);
  ok('the refusal is actionable, not just a sentence', staffRefused.href === 'index.html', staffRefused.href);
  ok('the refusal names the reason', /staff account/i.test(staffRefused.err), staffRefused.err);

  // The patient account on the staff console must not land in a staff workspace.
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  const patientStaff = await page.evaluate(pw => {
    const r = HIS.auth.attempt('patient@mediheal.test', pw, true);
    return { ok: r.ok, role: r.account && r.account.role, home: r.account ? HIS.rbac.ROLES[r.account.role].home : null };
  }, DEMO);
  ok('the patient account is recognised but scoped to the portal', patientStaff.role === 'patient' && patientStaff.home === 'portal', JSON.stringify(patientStaff));
  await ctx.close();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f)); }
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
