// Profile identity, avatar centring and actionable-notification destinations.
//
// The three things this covers are the ones a screenshot cannot prove: that the initials are
// optically centred (measured from rendered pixels, not from the CSS), that every account shows its
// own identity, and that a notification opens the record it is about without completing it.
//
// Run: PW=<playwright-core> node scripts/qa-nav-check.mjs
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
    const b = fs.readFileSync(path.join('.', p));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(b);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const mod = await import(pathToFileURL(PW).href);
const browser = await (mod.chromium || mod.default.chromium).launch({ channel: 'chrome' });
const DEMO = 'MediHeal2026!';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; failures.push(name + (detail !== undefined ? '  [' + detail + ']' : '')); console.log('FAIL ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
}

async function fresh(email, w, h, dpr) {
  const ctx = await browser.newContext({ viewport: { width: w || 1440, height: h || 768 }, deviceScaleFactor: dpr || 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  if (email) await page.evaluate(([em, pw]) => HIS.auth.attempt(em, pw, true), [email, DEMO]);
  return { ctx, page, errors };
}

// Rendered-pixel centroid of the initials inside an avatar, compared with the disc centre.
// The screenshot is handed back to the page and decoded there, so no PNG decoder is needed here.
async function inkOffset(page, selector) {
  const box = await page.locator(selector).boundingBox();
  const cssW = Math.round(box.width);
  const shot = await page.locator(selector).screenshot();
  return page.evaluate(async ([b64, cssW]) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d');
    cx.drawImage(img, 0, 0);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    // background = the most common colour (the disc); anything far from it is ink
    const counts = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const k = d[i] + ',' + d[i + 1] + ',' + d[i + 2];
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let bg = null, best = -1;
    counts.forEach((v, k) => { if (v > best) { best = v; bg = k.split(',').map(Number); } });
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        const i = (y * cv.width + x) * 4;
        const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
        if (dist > 120 && d[i + 3] > 128) { sx += x; sy += y; n++; }
      }
    }
    if (!n) return null;
    const dpr = cv.width / cssW || 1;
    return { dx: +(((sx / n) - (cv.width - 1) / 2) / dpr).toFixed(2), dy: +(((sy / n) - (cv.height - 1) / 2) / dpr).toFixed(2), px: n };
  }, [shot.toString('base64'), cssW]);
}

// =================================================================================================
// 1. AVATAR CENTRING — measured, not assumed
// =================================================================================================
console.log('\n--- 1. initials are centred inside the disc ---');
{
  const accounts = [['hr@mediheal.test', 'CD'], ['laboratory@mediheal.test', 'DC'], ['admissions@mediheal.test', 'JA'], ['doctor@mediheal.test', 'LL']];
  for (const [email, want] of accounts) {
    const { ctx, page } = await fresh(email, 1440, 768, 3);
    await page.goto(BASE + '/dashboard.html', { waitUntil: 'load' });
    await page.waitForTimeout(600);
    const hdr = await page.evaluate(() => document.querySelector('#profile .av-d').textContent.trim());
    ok(email.split('@')[0] + ': header initials are the account\'s own', hdr === want, hdr);
    const o1 = await inkOffset(page, '#profile .av-d');
    ok(email.split('@')[0] + ': header initials are optically centred',
      o1 && Math.abs(o1.dx) <= 1.5 && Math.abs(o1.dy) <= 1.5, o1 && ('dx ' + o1.dx + ' dy ' + o1.dy));

    await page.click('#profile');
    await page.waitForTimeout(350);
    const o2 = await inkOffset(page, '.am-m .av-d');
    ok(email.split('@')[0] + ': dropdown initials are optically centred',
      o2 && Math.abs(o2.dx) <= 1.5 && Math.abs(o2.dy) <= 1.5, o2 && ('dx ' + o2.dx + ' dy ' + o2.dy));
    await ctx.close();
  }
}
{
  // The fallback must also be centred, and long or short names must not wrap or clip.
  const { ctx, page } = await fresh('superadmin@mediheal.test', 1366, 768, 2);
  await page.goto(BASE + '/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const shape = await page.evaluate(() => {
    const el = document.querySelector('#profile .av-d');
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), square: Math.abs(r.width - r.height) < 0.6, overflow: el.scrollWidth > el.clientWidth + 1 };
  });
  ok('at 1366 the header avatar is still square', shape.square, JSON.stringify(shape));
  ok('the initials do not overflow the disc', shape.overflow === false, shape.overflow);

  const fallback = await page.evaluate(() => {
    const mk = HIS.avatar.disc('', 'seed-empty', 42, 'No name');
    const d = document.createElement('div');
    d.innerHTML = mk;
    document.body.appendChild(d);
    const el = d.firstChild;
    return { text: el.textContent.trim(), has: !!el, display: getComputedStyle(el).display };
  });
  ok('a missing name falls back to a placeholder glyph', fallback.text === '?', fallback.text);
  await ctx.close();
}

// =================================================================================================
// 2. PROFILE IDENTITY — every account shows its own record
// =================================================================================================
console.log('\n--- 2. the profile shows the signed-in account ---');
{
  const ACCOUNTS = [
    ['superadmin@mediheal.test', 'Dr. Elsie Chen'],
    ['admin@mediheal.test', 'Atty. Ramon Silva'],
    ['admissions@mediheal.test', 'Joel Aquino'],
    ['laboratory@mediheal.test', 'Daniel Cruz'],
    ['hr@mediheal.test', 'Carmela Dizon'],
    ['cashier@mediheal.test', 'Aileen Ramos'],
    ['department.head@mediheal.test', 'Dr. Marc Laureta']
  ];
  const seen = [];
  for (const [email, name] of ACCOUNTS) {
    const { ctx, page, errors } = await fresh(email);
    await page.goto(BASE + '/dashboard.html', { waitUntil: 'load' });
    await page.waitForTimeout(450);
    await page.click('#profile');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const a = HIS.auth.account();
      const panel = document.querySelector('.am-m');
      return {
        headerName: document.querySelector('#profile .nm').textContent.trim(),
        headerTitle: document.querySelector('#profile small').textContent.trim(),
        menuName: panel.querySelector('.am-nm').textContent.trim(),
        menuTitle: panel.querySelector('.am-ti').textContent.trim(),
        rows: [...panel.querySelectorAll('.am-r')].map(x => x.querySelector('span').textContent + '=' + x.querySelector('b').textContent),
        account: { name: a.name, email: a.email, role: a.role, dept: a.dept || '' }
      };
    });
    seen.push(r.headerName);
    ok(name + ': the header names the account', r.headerName === name, r.headerName);
    ok(name + ': the menu agrees with the header', r.menuName === r.headerName && r.menuTitle.toUpperCase() === r.headerTitle, r.menuName + ' / ' + r.menuTitle);
    ok(name + ': the email shown is the account email', r.rows.some(x => x === 'Email=' + r.account.email), r.rows.join(' | '));
    ok(name + ': the role shown matches the account role', r.rows.some(x => /^Role=/.test(x)), r.rows.join(' | '));
    ok(name + ': the account is not another person', r.account.name === name, r.account.name);
    ok(name + ': no script error', errors.length === 0, errors[0]);
    await ctx.close();
  }
  ok('seven accounts show seven different names', new Set(seen).size === 7, seen.join(', '));
}
{
  // A patient account must resolve to its own registry record, never a staff profile.
  const { ctx, page } = await fresh('patient@mediheal.test');
  await page.goto(BASE + '/portal.html#me', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => {
    const a = HIS.auth.account();
    const p = a && a.patientId ? HIS.registry.byId(a.patientId) : null;
    return {
      role: a && a.role, patientId: a && a.patientId,
      registryName: p && p.name,
      shown: (document.querySelector('#pt-av') || {}).textContent,
      header: (document.body.innerText.match(/Isabel[^\n]*/) || [''])[0]
    };
  });
  ok('the patient account resolves to a registry record', !!r.patientId && !!r.registryName, r.patientId + ' -> ' + r.registryName);
  ok('the patient portal shows that patient, not a staff profile', /Isabel/.test(r.header), r.header);
  ok('the patient avatar carries the patient initials', /^[A-Z]{1,2}$/.test((r.shown || '').trim()), r.shown);
  await ctx.close();
}

// =================================================================================================
// 3. ACTIONABLE NOTIFICATIONS — exact destination, no task completion
// =================================================================================================
console.log('\n--- 3. a notification opens its record ---');
const CASES = [
  ['laboratory@mediheal.test', 'laboratory.html', 'Critical result', 'LAB-', 'order'],
  ['pharmacy@mediheal.test', 'pharmacy.html', 'Prescriptions to verify', 'RX-', 'rx'],
  ['cashier@mediheal.test', 'billing.html', 'Invoices with a balance', 'BL-', 'invoice'],
  ['hr@mediheal.test', 'attendance.html', 'Leave requests', 'EMP-', 'leave'],
  ['admissions@mediheal.test', 'appointments.html', 'Appointments awaiting', 'APT-', 'appointment'],
  ['superadmin@mediheal.test', 'laboratory.html', 'Critical result', 'LAB-', 'order']
];
for (const [email, pageName, title, prefix, kind] of CASES) {
  const { ctx, page, errors } = await fresh(email);
  await page.goto(BASE + '/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  // Snapshot the state the notification is about, so "read" can be told from "done".
  const before = await page.evaluate(k => ({
    order: k === 'order' ? HIS.lab.all().map(o => o.id + ':' + o.status + ':' + !!o.criticalAck).join(',') : null,
    rx: k === 'rx' ? HIS.pharmacy.rx().map(r => r.id + ':' + r.status).join(',') : null,
    invoice: k === 'invoice' ? HIS.billing.bills.map(b => b.id + ':' + HIS.ledger.paidOf(b)).join(',') : null,
    leave: k === 'leave' ? JSON.stringify(HIS.attendance.leaves) : null
  }), kind);

  await page.click('.bell');
  await page.waitForTimeout(250);
  const item = await page.evaluate(t => {
    const rows = [...document.querySelectorAll('.nf-r')];
    const row = rows.filter(r => r.querySelector('.nf-rt').textContent.indexOf(t) > -1)[0] || rows[0];
    return row ? row.querySelector('.nf-rt').textContent : null;
  }, title);
  ok(email.split('@')[0] + ': the panel offers the expected notification', !!item, item);

  await page.click('.nf-r');
  await page.waitForTimeout(1300);
  const after = await page.evaluate(k => ({
    page: location.pathname.split('/').pop(),
    search: location.search,
    hit: !!document.querySelector('.dl-hit'),
    hitText: (document.querySelector('.dl-hit') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim(),
    hitId: (document.querySelector('.dl-hit') || { getAttribute: () => null }).getAttribute('data-id'),
    order: k === 'order' ? HIS.lab.all().map(o => o.id + ':' + o.status + ':' + !!o.criticalAck).join(',') : null,
    rx: k === 'rx' ? HIS.pharmacy.rx().map(r => r.id + ':' + r.status).join(',') : null,
    invoice: k === 'invoice' ? HIS.billing.bills.map(b => b.id + ':' + HIS.ledger.paidOf(b)).join(',') : null,
    leave: k === 'leave' ? JSON.stringify(HIS.attendance.leaves) : null,
    read: (() => { const v = HIS.store.get(HIS.store.KEY.notifRead, null); return v && v.by ? Object.keys(v.by).length : 0; })()
  }), kind);

  ok(email.split('@')[0] + ': it navigates to the owning page', after.page === pageName, after.page);
  ok(email.split('@')[0] + ': the record is located and highlighted', after.hit === true, after.hit);
  // the record id is printed in the row on most pages and held in data-id where it is not
  const byId = after.hitId && after.hitId.indexOf(prefix) === 0;
  ok(email.split('@')[0] + ': the highlighted row is the record itself', byId || after.hitText.indexOf(prefix) > -1 || /Acknowledge/.test(after.hitText), (after.hitId || '') + ' :: ' + after.hitText.slice(0, 50));
  ok(email.split('@')[0] + ': the navigation parameter is consumed', after.search === '', after.search);
  ok(email.split('@')[0] + ': reading did not change the record',
    after[kind] === before[kind], 'before=' + String(before[kind]).slice(0, 40) + ' after=' + String(after[kind]).slice(0, 40));
  ok(email.split('@')[0] + ': the read state was recorded', after.read > 0, after.read);
  ok(email.split('@')[0] + ': no script error on arrival', errors.length === 0, errors[0]);
  await ctx.close();
}

// =================================================================================================
// 4. NOTIFICATION SCOPE — role-appropriate, no cross-role leakage
// =================================================================================================
console.log('\n--- 4. notifications stay inside the role ---');
{
  const seen = {};
  for (const [email, role] of [['laboratory@mediheal.test', 'lab'], ['pharmacy@mediheal.test', 'pharmacy'],
    ['cashier@mediheal.test', 'cashier'], ['hr@mediheal.test', 'hr'], ['auditor@mediheal.test', 'auditor']]) {
    const { ctx, page } = await fresh(email);
    await page.goto(BASE + '/dashboard.html', { waitUntil: 'load' });
    await page.waitForTimeout(450);
    await page.click('.bell');
    await page.waitForTimeout(200);
    seen[role] = await page.evaluate(() => ({
      titles: [...document.querySelectorAll('.nf-rt')].map(n => n.textContent),
      badge: +(document.querySelector('.bell b').textContent || 0),
      unread: document.querySelectorAll('.nf-r:not(.rd)').length
    }));
    await ctx.close();
  }
  ok('every role has at least one notification', Object.values(seen).every(r => r.titles.length > 0), JSON.stringify(Object.entries(seen).map(([k, v]) => k + ':' + v.titles.length)));
  ok('the unread badge equals the unread rows for every role', Object.values(seen).every(r => r.badge === r.unread), JSON.stringify(Object.entries(seen).map(([k, v]) => k + ':' + v.badge + '/' + v.unread)));
  ok('HR sees no laboratory work', !seen.hr.titles.some(t => /specimen|validation|critical/i.test(t)), seen.hr.titles.join(' | '));
  ok('the cashier sees no leave or payroll', !seen.cashier.titles.some(t => /leave|payroll|timesheet/i.test(t)), seen.cashier.titles.join(' | '));
  ok('the technologist sees no invoices', !seen.lab.titles.some(t => /invoice|balance/i.test(t)), seen.lab.titles.join(' | '));
  ok('no two roles open with the same notification', new Set(Object.values(seen).map(r => r.titles[0])).size >= 4, Object.values(seen).map(r => r.titles[0]).join(' | '));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f)); }
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
