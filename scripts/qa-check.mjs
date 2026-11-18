// QA acceptance suite — the presentation and interaction defects found in real browser use.
// Every case here is a rule a visitor can see broken: a dead end at sign-in, a KPI that disagrees
// with its table, one photograph for six people, payroll notifications for a medical technologist,
// a dialog whose primary action sits below the window, and a bed form that accepts anything typed.
//
// Run: PW=<playwright-core> node scripts/qa-check.mjs
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
await new Promise(r => server.listen(8896, r));
const BASE = 'http://127.0.0.1:8896';

const mod = await import(pathToFileURL(PW).href);
const browser = await (mod.chromium || mod.default.chromium).launch({ channel: 'chrome' });
const DEMO = 'MediHeal2026!';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; failures.push(name + (detail !== undefined ? '  [' + detail + ']' : '')); console.log('FAIL ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
}
const near = (a, b, t) => Math.abs(a - b) <= (t || 0.01);

async function fresh(email, width, height) {
  const ctx = await browser.newContext({ viewport: { width: width || 1440, height: height || 768 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  if (email) await page.evaluate(([em, pw]) => HIS.auth.attempt(em, pw, true), [email, DEMO]);
  return { ctx, page, errors };
}

// =================================================================================================
// 1. SIGN-IN NAVIGATION — neither environment may be a dead end
// =================================================================================================
console.log('\n--- 1. patient and staff sign-in are one click apart ---');
{
  const { ctx, page } = await fresh(null);
  await page.goto(BASE + '/portal.html#signin', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const portal = await page.evaluate(() => {
    const a = document.querySelector('#signin a[href="index.html"]');
    return a ? { href: a.getAttribute('href'), text: a.textContent.trim(), visible: a.getBoundingClientRect().width > 0 } : null;
  });
  ok('the patient sign-in page offers a staff sign-in link', !!portal, JSON.stringify(portal));
  ok('the staff link points at the staff console', portal && portal.href === 'index.html', portal && portal.href);
  ok('the staff link is visible without scrolling the panel', portal && portal.visible, portal && portal.visible);

  // A staff account must not be able to sit in a patient session, and the refusal must be actionable.
  await page.fill('#pt-si-email', 'cashier@mediheal.test');
  await page.fill('#pt-signin form input[type=password], #pt-signin input[type=password]', DEMO);
  await page.evaluate(() => document.querySelector('#pt-signin').requestSubmit());
  await page.waitForTimeout(300);
  const refused = await page.evaluate(() => ({
    err: document.querySelector('#pt-signin-error').textContent,
    link: (document.querySelector('#pt-signin-error a') || {}).getAttribute ? document.querySelector('#pt-signin-error a').getAttribute('href') : null,
    signedIn: !!HIS.auth.account()
  }));
  ok('a staff account cannot enter the patient portal', refused.signedIn === false, refused.signedIn);
  ok('the refusal names the staff console', /staff account/i.test(refused.err), refused.err);
  ok('the refusal links to the staff console', refused.link === 'index.html', refused.link);
  await ctx.close();
}
{
  const { ctx, page } = await fresh(null);
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  const staff = await page.evaluate(() => {
    const a = [...document.querySelectorAll('a')].filter(x => /patient portal/i.test(x.textContent))[0];
    return a ? a.getAttribute('href') : null;
  });
  ok('the staff sign-in page offers the patient portal', staff === 'portal.html', staff);
  await ctx.close();
}
{
  // Patient sign-out lands on the portal sign-in, not on a blank or the landing page.
  const { ctx, page } = await fresh('patient@mediheal.test');
  await page.goto(BASE + '/portal.html#home', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const b = document.querySelector('#pt-signout'); if (b) b.click(); });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    hash: location.hash,
    signedIn: !!HIS.auth.account(),
    staffLink: !!document.querySelector('#signin a[href="index.html"]')
  }));
  ok('patient sign-out ends the session', after.signedIn === false, after.signedIn);
  ok('patient sign-out returns to the sign-in view', after.hash === '#signin', after.hash);
  ok('the staff route is still on screen after sign-out', after.staffLink === true, after.staffLink);
  await ctx.close();
}

// =================================================================================================
// 2. APPOINTMENT STATISTICS — the cards, the footer and the rows must agree
// =================================================================================================
console.log('\n--- 2. appointment counts come from the records ---');
{
  const { ctx, page, errors } = await fresh('admissions@mediheal.test');
  await page.goto(BASE + '/appointments.html', { waitUntil: 'load' });
  await page.waitForTimeout(350);
  const r = await page.evaluate(() => {
    const kpis = [...document.querySelectorAll('.akpi')].map(k => ({
      label: k.querySelector('.at span').textContent, value: +k.querySelector('.aval').textContent
    }));
    const rows = document.querySelectorAll('#rows .a-row').length;
    return {
      kpis, rows,
      total: HIS.appointments.length,
      byStatus: HIS.apptStatuses.reduce((m, s) => (m[s] = HIS.appointments.filter(a => a.status === s).length, m), {}),
      count: document.querySelector('#count').textContent,
      pageButtons: document.querySelectorAll('#pages button').length
    };
  });
  ok('the total card equals the number of appointments on file', r.kpis[0].value === r.total, r.kpis[0].value + ' vs ' + r.total);
  ok('the Confirmed card equals the confirmed records', r.kpis[1].value === r.byStatus.Confirmed, r.kpis[1].value + ' vs ' + r.byStatus.Confirmed);
  ok('the Pending card equals the pending records', r.kpis[2].value === r.byStatus.Pending, r.kpis[2].value + ' vs ' + r.byStatus.Pending);
  ok('the Cancelled card equals the cancelled records', r.kpis[3].value === r.byStatus.Cancelled, r.kpis[3].value + ' vs ' + r.byStatus.Cancelled);
  ok('the fifth card reports Completed, which the data supports', /Completed/.test(r.kpis[4].label), r.kpis[4].label);
  ok('no card claims a walk-in count the records cannot support', !r.kpis.some(k => /Walk-In/i.test(k.label)), JSON.stringify(r.kpis.map(k => k.label)));
  ok('the footer states the real total', /of 6 appointments$/.test(r.count), r.count);
  ok('the footer range matches the rows drawn', new RegExp('Showing 1\\u2013' + r.rows + ' of').test(r.count), r.count);
  ok('no page buttons appear while everything fits on one page', r.pageButtons === 0, r.pageButtons);
  ok('the seeded list is six rows', r.rows === 6, r.rows);

  // Cancelling through the row menu must move the numbers, not just the pill.
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('#rows .a-row')].filter(r => /Confirmed/.test(r.textContent))[0];
    row.querySelector('[data-more]').click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.a-menu button')].filter(x => /Cancel appointment/i.test(x.textContent))[0];
    if (b) b.click();
  });
  await page.waitForTimeout(250);
  await page.click('.ap-ok');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    kpis: [...document.querySelectorAll('.akpi')].map(k => +k.querySelector('.aval').textContent),
    cancelledRows: [...document.querySelectorAll('#rows .a-row')].filter(r => /Cancelled/.test(r.textContent)).length
  }));
  ok('cancelling a visit moves Confirmed and Cancelled together',
    after.kpis[1] === 2 && after.kpis[3] === 2, JSON.stringify(after.kpis));
  ok('the cancelled row is shown as cancelled', after.cancelledRows === 2, after.cancelledRows);

  // Filters act on the same set the footer reports.
  await page.fill('#q', 'Tobias');
  await page.waitForTimeout(200);
  const filtered = await page.evaluate(() => ({
    rows: document.querySelectorAll('#rows .a-row').length,
    count: document.querySelector('#count').textContent
  }));
  ok('search narrows the rows', filtered.rows === 1, filtered.rows);
  ok('search narrows the footer count too', /of 1 appointment/.test(filtered.count), filtered.count);
  await page.fill('#q', 'zzzz');
  await page.waitForTimeout(200);
  const empty = await page.evaluate(() => document.querySelector('#rows').textContent);
  ok('an empty search result says so', /No appointments match/.test(empty), empty.slice(0, 60));
  ok('the appointment page raised no script error', errors.length === 0, errors[0]);
  await ctx.close();
}

// =================================================================================================
// 3. IDENTITY — one person, one avatar
// =================================================================================================
console.log('\n--- 3. every account has its own initials avatar ---');
{
  const seen = [];
  for (const email of ['superadmin@mediheal.test', 'admissions@mediheal.test', 'laboratory@mediheal.test', 'hr@mediheal.test']) {
    const { ctx, page } = await fresh(email);
    await page.goto(BASE + '/dashboard.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    const a = await page.evaluate(() => {
      const av = document.querySelector('#profile .av-d');
      const img = document.querySelector('#profile img');
      return {
        name: document.querySelector('#profile .nm').textContent,
        ini: av ? av.textContent.trim() : null,
        tint: av ? av.style.background : null,
        label: av ? av.getAttribute('aria-label') : null,
        hasPhoto: !!img
      };
    });
    seen.push(a);
    ok('no shared photograph is drawn in the header', a.hasPhoto === false, a.hasPhoto);
    ok('the avatar carries the person\'s initials', a.ini && a.ini.length === 2 && a.ini === a.ini.toUpperCase(), a.ini);
    ok('the avatar is labelled for a screen reader', !!a.label && a.label === a.name, a.label);
    await ctx.close();
  }
  const inis = seen.map(s => s.ini);
  ok('four different accounts show four different initials', new Set(inis).size === 4, inis.join(','));
  const tints = seen.map(s => s.tint);
  ok('the tint is not identical for every account', new Set(tints).size > 1, tints.join(','));
  ok('initials derive from the name', seen[0].ini === 'EC' && seen[1].ini === 'JA', inis.join(','));
}
{
  // The same account must keep the same avatar on every page.
  const { ctx, page } = await fresh('laboratory@mediheal.test');
  const got = [];
  for (const p of ['dashboard.html', 'laboratory.html', 'appointments.html']) {
    await page.goto(BASE + '/' + p, { waitUntil: 'load' });
    await page.waitForTimeout(200);
    got.push(await page.evaluate(() => {
      const av = document.querySelector('#profile .av-d');
      return av ? av.textContent.trim() + '|' + av.style.background : null;
    }));
  }
  ok('the same account keeps one avatar across pages', new Set(got).size === 1, got.join(' / '));
  await ctx.close();
}

// =================================================================================================
// 4. NOTIFICATIONS — derived from the role's own records
// =================================================================================================
console.log('\n--- 4. notifications follow the account, not a fixed list ---');
{
  const byRole = {};
  for (const [email, role] of [['laboratory@mediheal.test', 'lab'], ['pharmacy@mediheal.test', 'pharmacist'],
    ['cashier@mediheal.test', 'cashier'], ['hr@mediheal.test', 'hr'], ['admissions@mediheal.test', 'registration'],
    ['auditor@mediheal.test', 'auditor']]) {
    const { ctx, page } = await fresh(email);
    await page.goto(BASE + '/appointments.html', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await page.click('.bell');
    await page.waitForTimeout(200);
    byRole[role] = await page.evaluate(() => {
      const p = document.querySelector('.nf-p');
      return {
        sub: p.querySelector('.nf-s').textContent,
        titles: [...p.querySelectorAll('.nf-rt')].map(x => x.textContent),
        bodies: [...p.querySelectorAll('.nf-rb')].map(x => x.textContent),
        badge: +(document.querySelector('.bell b').textContent || 0),
        unreadRows: p.querySelectorAll('.nf-r:not(.rd)').length,
        height: parseInt(p.style.height, 10),
        box: p.getBoundingClientRect()
      };
    });
    await ctx.close();
  }
  ok('the medical technologist sees laboratory work', /Laboratory/.test(byRole.lab.sub) &&
    byRole.lab.titles.some(t => /validation|specimen|critical/i.test(t)), byRole.lab.sub + ' :: ' + byRole.lab.titles.join(','));
  ok('the medical technologist is not shown payroll or leave', !byRole.lab.titles.some(t => /payroll|leave|absence/i.test(t)), byRole.lab.titles.join(','));
  ok('the pharmacist sees pharmacy work', /Pharmacy/.test(byRole.pharmacist.sub) &&
    byRole.pharmacist.titles.some(t => /prescription|stock|batch/i.test(t)), byRole.pharmacist.sub);
  ok('the cashier sees billing work', /Billing/.test(byRole.cashier.sub) &&
    byRole.cashier.titles.some(t => /invoice|charge/i.test(t)), byRole.cashier.sub);
  ok('the cashier is not shown leave requests', !byRole.cashier.titles.some(t => /leave/i.test(t)), byRole.cashier.titles.join(','));
  ok('HR sees attendance work', /Human resources/.test(byRole.hr.sub) &&
    byRole.hr.titles.some(t => /leave|absence|late/i.test(t)), byRole.hr.sub);
  ok('HR is not shown laboratory specimens', !byRole.hr.titles.some(t => /specimen|validation/i.test(t)), byRole.hr.titles.join(','));
  ok('the admissions officer sees scheduling and beds', /Admissions/.test(byRole.registration.sub) &&
    byRole.registration.titles.some(t => /appointment|bed/i.test(t)), byRole.registration.sub);
  ok('the auditor sees compliance activity', /Compliance/.test(byRole.auditor.sub), byRole.auditor.sub);
  ok('no two roles share the same first notification', new Set(Object.values(byRole).map(r => r.titles[0])).size >= 5,
    Object.values(byRole).map(r => r.titles[0]).join(' | '));
  ok('the unread badge equals the unread rows', Object.values(byRole).every(r => r.badge === r.unreadRows),
    JSON.stringify(Object.entries(byRole).map(([k, v]) => k + ':' + v.badge + '/' + v.unreadRows)));
  ok('every panel fits inside a 768px window', Object.values(byRole).every(r => r.box.bottom <= 768),
    JSON.stringify(Object.values(byRole).map(r => Math.round(r.box.bottom))));
}
{
  const { ctx, page } = await fresh('laboratory@mediheal.test');
  await page.goto(BASE + '/appointments.html', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.click('.bell');
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => +(document.querySelector('.bell b').textContent || 0));
  await page.click('.nf-r');
  await page.waitForTimeout(200);
  const afterOne = await page.evaluate(() => ({
    badge: +(document.querySelector('.bell b').textContent || 0),
    readRows: document.querySelectorAll('.nf-r.rd').length
  }));
  ok('reading one notification lowers the unread count by one', afterOne.badge === before - 1, before + ' -> ' + afterOne.badge);
  ok('the read row is marked read', afterOne.readRows === 1, afterOne.readRows);
  await page.click('.nf-m');
  await page.waitForTimeout(200);
  const afterAll = await page.evaluate(() => ({
    badge: document.querySelector('.bell b').style.display,
    sub: document.querySelector('.nf-s').textContent,
    disabled: document.querySelector('.nf-m').disabled
  }));
  ok('mark all as read clears the badge', afterAll.badge === 'none', afterAll.badge);
  ok('the subtitle reports nothing unread', /All caught up/.test(afterAll.sub), afterAll.sub);
  ok('the button disables itself when there is nothing left', afterAll.disabled === true, afterAll.disabled);
  await page.click('.nf-x');
  await page.waitForTimeout(150);
  ok('the close button closes the panel', await page.evaluate(() => !document.querySelector('.nf-p').classList.contains('on')));
  await ctx.close();
}

// =================================================================================================
// 5. DASHBOARDS — real data, no build notes, no clipped card text
// =================================================================================================
console.log('\n--- 5. role dashboards carry real metrics ---');
{
  const roles = ['laboratory@mediheal.test', 'pharmacy@mediheal.test', 'cashier@mediheal.test',
    'doctor@mediheal.test', 'nurse@mediheal.test', 'hr@mediheal.test', 'admissions@mediheal.test', 'auditor@mediheal.test'];
  const bad = [];
  const clipped = [];
  for (const email of roles) {
    const { ctx, page, errors } = await fresh(email);
    await page.goto(BASE + '/dashboard.html', { waitUntil: 'load' });
    await page.waitForTimeout(350);
    const r = await page.evaluate(() => {
      const text = document.querySelector('.stage').innerText;
      const kpis = [...document.querySelectorAll('.kpi')].map(k => {
        const d = k.querySelector('.d');
        const kr = k.getBoundingClientRect(), dr = d.getBoundingClientRect();
        return { d: d.textContent, spill: dr.right > kr.right - 4, scroll: d.scrollWidth > d.clientWidth + 1, v: k.querySelector('.v').textContent };
      });
      return { text, kpis, empty: [...document.querySelectorAll('.kpi .v')].filter(v => !v.textContent.trim()).length };
    });
    if (/Not modelled|not yet modelled|\(M\d|TODO|FIXME|placeholder/i.test(r.text)) bad.push(email);
    if (r.kpis.some(k => k.spill || k.scroll)) clipped.push(email + ':' + r.kpis.filter(k => k.spill || k.scroll).map(k => k.d).join('|'));
    if (r.empty) bad.push(email + ':empty-value');
    if (errors.length) bad.push(email + ':error ' + errors[0]);
    await ctx.close();
  }
  ok('no dashboard mentions a milestone or an unbuilt module', bad.length === 0, bad.join(' ; '));
  ok('no dashboard card description spills outside its card', clipped.length === 0, clipped.join(' ; '));
}
{
  // The medical technologist figures must equal the laboratory module's own counts.
  const { ctx, page } = await fresh('laboratory@mediheal.test');
  await page.goto(BASE + '/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const orders = HIS.lab.all();
    const want = [
      orders.filter(o => o.status === 'Ordered').length,
      orders.filter(o => o.status === 'Collected' || o.status === 'In Process').length,
      orders.filter(o => o.status === 'Resulted').length,
      orders.filter(o => o.status === 'Validated').length
    ];
    const got = [...document.querySelectorAll('.kpi .v')].map(v => +v.textContent);
    return { want, got };
  });
  ok('the technologist KPIs equal the laboratory order statuses',
    JSON.stringify(r.want) === JSON.stringify(r.got), JSON.stringify(r.want) + ' vs ' + JSON.stringify(r.got));
  await ctx.close();
}

// =================================================================================================
// 6. CONTROLLED SELECTORS — the bed dialog
// =================================================================================================
console.log('\n--- 6. the bed dialog chooses from real records ---');
{
  const { ctx, page } = await fresh('doctor@mediheal.test');
  await page.goto(BASE + '/treatment.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Assign bed/i.test(x.textContent)); if (b) b.click(); });
  await page.waitForTimeout(300);
  const shape = await page.evaluate(() => {
    const m = document.querySelector('.tp-modal');
    if (!m) return null;
    const f = i => m.querySelector('[data-i="' + i + '"]');
    return {
      ward: f(0) && f(0).tagName, bed: f(1) && f(1).tagName, date: f(2) && f(2).type,
      doctor: f(3) && f(3).tagName, iso: f(4) && f(4).tagName, notes: f(5) && f(5).tagName,
      wardOpts: f(0) ? [...f(0).options].map(o => o.text) : [],
      bedOpts: f(1) ? [...f(1).options].map(o => o.text) : [],
      doctorOpts: f(3) ? [...f(3).options].length : 0,
      banner: (m.querySelector('.tp-m-b span') || {}).textContent
    };
  });
  ok('Ward is a dropdown', shape && shape.ward === 'SELECT', shape && shape.ward);
  ok('Bed is a dropdown', shape && shape.bed === 'SELECT', shape && shape.bed);
  ok('Admission date is a date control', shape && shape.date === 'date', shape && shape.date);
  ok('Attending doctor is a dropdown', shape && shape.doctor === 'SELECT', shape && shape.doctor);
  ok('Isolation precautions is a controlled list', shape && shape.iso === 'SELECT', shape && shape.iso);
  ok('Admission notes stays free text', shape && shape.notes === 'TEXTAREA', shape && shape.notes);
  ok('the ward list is the hospital\'s own wards', shape && shape.wardOpts.length === 6 && shape.wardOpts.includes('Cardiology Ward'), shape && shape.wardOpts.join(','));
  ok('the bed list is offered for the selected ward', shape && shape.bedOpts.length > 0, shape && shape.bedOpts.length);
  ok('the doctor list is the configured providers', shape && shape.doctorOpts === 6, shape && shape.doctorOpts);
  ok('the availability banner names the selected bed', shape && /C-201/.test(shape.banner), shape && shape.banner);

  // Changing the ward must rebuild the bed list and re-check availability.
  const changed = await page.evaluate(() => {
    const m = document.querySelector('.tp-modal');
    const ward = m.querySelector('[data-i="0"]');
    ward.value = 'Neurology Ward';
    ward.dispatchEvent(new Event('change'));
    const bed = m.querySelector('[data-i="1"]');
    return {
      opts: [...bed.options].map(o => o.text),
      banner: m.querySelector('.tp-m-b span').textContent,
      first: bed.value
    };
  });
  ok('changing the ward rebuilds the bed list', changed.opts.length > 0 && /^N-/.test(changed.opts[0]), changed.opts.slice(0, 3).join(','));
  ok('changing the ward re-checks the banner', /Neurology Ward/.test(changed.banner), changed.banner);

  // Only free beds are offered: every option must currently be available.
  const allFree = await page.evaluate(() => {
    const m = document.querySelector('.tp-modal');
    const ward = m.querySelector('[data-i="0"]');
    const bed = m.querySelector('[data-i="1"]');
    return [...bed.options].every(o => {
      const label = o.text.replace(/\s*\(.*\)$/, '');
      const b = HIS.admissions.bedBoard(ward.value).filter(x => x.label === label)[0];
      return b && b.status === 'available';
    });
  });
  ok('every bed offered is actually free', allFree === true, allFree);

  const inside = await page.evaluate(() => {
    const m = document.querySelector('.tp-modal').getBoundingClientRect();
    const ok2 = document.querySelector('.tp-m-ok').getBoundingClientRect();
    return { top: m.top, bottom: m.bottom, okBottom: ok2.bottom, vh: innerHeight };
  });
  ok('the bed dialog fits inside a 768px window', inside.top >= 0 && inside.bottom <= inside.vh, JSON.stringify(inside));
  ok('its primary action is inside the window', inside.okBottom <= inside.vh, inside.okBottom);
  await ctx.close();
}

// =================================================================================================
// 7. PAYROLL — the payslip dialog and its action
// =================================================================================================
console.log('\n--- 7. generate payslips fits and works ---');
for (const [w, h] of [[1440, 768], [1366, 768]]) {
  const { ctx, page } = await fresh('hr@mediheal.test', w, h);
  await page.goto(BASE + '/payroll.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Generate payslips/i.test(x.textContent)); if (b) b.click(); });
  await page.waitForTimeout(300);
  const box = await page.evaluate(() => {
    const m = document.querySelector('.pr-modal');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const okb = m.querySelector('.pr-m-ok');
    const o = okb.getBoundingClientRect();
    const c = m.querySelector('.pr-m-c');
    return {
      top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight,
      okTop: Math.round(o.top), okBottom: Math.round(o.bottom),
      cancel: c ? Math.round(c.getBoundingClientRect().bottom) : null,
      title: m.querySelector('.pr-m-t').textContent
    };
  });
  ok(w + ': the payslip dialog opens', box && box.title === 'Generate payslips', box && box.title);
  ok(w + ': the dialog is fully inside the viewport', box.top >= 0 && box.bottom <= box.vh, box.top + '-' + box.bottom + ' of ' + box.vh);
  ok(w + ': the Generate action is reachable', box.okTop > box.top && box.okBottom <= box.vh, box.okTop + '-' + box.okBottom);
  ok(w + ': Cancel is reachable', box.cancel !== null && box.cancel <= box.vh, box.cancel);

  // The action must do something and report it.
  const ran = await page.evaluate(async () => {
    const before = document.querySelectorAll('.pr-tip').length;
    document.querySelector('.pr-m-ok').click();
    await new Promise(r => setTimeout(r, 400));
    const t = document.querySelector('.pr-tip');
    return { before, tip: t ? t.textContent : null, stillOpen: !!document.querySelector('.pr-modal') };
  });
  ok(w + ': the Generate action reports what it produced', !!ran.tip && /payslip/i.test(ran.tip), ran.tip);
  ok(w + ': the dialog closes after generating', ran.stillOpen === false, ran.stillOpen);
  await ctx.close();
}

// =================================================================================================
// 8. NO DEVELOPMENT TEXT ANYWHERE A VISITOR CAN SEE
// =================================================================================================
console.log('\n--- 8. no build artefacts in the interface ---');
{
  const pages = ['index', 'dashboard', 'appointments', 'appointment-form', 'laboratory', 'pharmacy', 'billing',
    'claims', 'admissions', 'charges', 'reports', 'payroll', 'accounts', 'settings', 'audit', 'departments',
    'treatment', 'consultation', 'registration', 'nursing', 'personnel', 'attendance', 'portal'];
  const hits = [];
  const { ctx, page } = await fresh('superadmin@mediheal.test');
  for (const p of pages) {
    await page.goto(BASE + '/' + p + '.html', { waitUntil: 'load' });
    await page.waitForTimeout(250);
    const txt = await page.evaluate(() => document.body.innerText);
    const m = txt.match(/Not modelled|not yet modelled|\(M\d+(\.\d+)?\)|\bM1[0-2]\b|TODO|FIXME|lorem ipsum|Generated by AI|ChatGPT|OpenAI|Figma|placeholder text/i);
    if (m) hits.push(p + ':' + m[0]);
  }
  ok('no page shows a milestone, a build note or placeholder text', hits.length === 0, hits.join(' ; '));
  await ctx.close();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f)); }
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
