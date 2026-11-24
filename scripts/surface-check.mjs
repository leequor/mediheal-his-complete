// Surface check: the behaviours that surround the workflows rather than being one.
//
//   1. dialogs   - every modal on every page: Escape closes, backdrop closes, focus returns to the
//                  trigger, no overlay or scroll lock is left behind, the page still works.
//   2. print     - every page under print media: no header/drawer/scrim, nothing clipped, real content.
//   3. exports   - every Export control: a file arrives, it parses, columns are consistent, no
//                  NaN/undefined cells, no cell a spreadsheet would run as a formula.
//   4. double    - the primary action of each write flow clicked twice in one tick: one record only.
//   5. scope     - two tabs with two roles: no broken state, reload mid-modal writes nothing.
//
//   PW=... node scripts/surface-check.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, openBrowser, signIn } from './_harness.mjs';

const { server, base } = await startServer(8894);
const { browser } = await openBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 }, acceptDownloads: true });
let page = await ctx.newPage();
const errors = [];
const attach = () => page.on('pageerror', e => errors.push(String(e.message).slice(0, 120)));
attach();

let pass = 0;
const problems = [];
const ok = () => { pass++; };
const bad = (what) => problems.push(what);

const PAGES = ['dashboard.html', 'registration.html', 'appointments.html', 'profile.html', 'departments.html',
  'billing.html', 'charges.html', 'claims.html', 'laboratory.html', 'pharmacy.html', 'treatment.html',
  'nursing.html', 'consultation.html', 'admissions.html', 'personnel.html', 'payroll.html', 'attendance.html',
  'reports.html', 'accounts.html', 'settings.html', 'audit.html', 'appointment-confirmed.html', 'portal.html'];

const DIALOG = '.ac-bg, .bl-modal, .pe-modal, .tp-modal, .at-modal, .cl-bg, .dm-bg, [class$=-modal], [role=dialog]';
const openDialogs = () => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter(d => d.offsetWidth).length, DIALOG);
const reattach = async () => { await page.close(); page = await ctx.newPage(); attach(); await page.goto(`${base}/index.html`); await signIn(page); };

// ---------------------------------------------------------------- 1. dialogs
const dialogPages = ['registration.html', 'appointments.html', 'profile.html', 'departments.html', 'billing.html',
  'charges.html', 'claims.html', 'laboratory.html', 'pharmacy.html', 'treatment.html', 'nursing.html',
  'consultation.html', 'admissions.html', 'personnel.html', 'payroll.html', 'attendance.html', 'reports.html',
  'accounts.html', 'settings.html', 'audit.html'];

for (const pg of dialogPages) {
  await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(180);
  const triggers = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('button, [data-open], [data-modal], .ad-btn').forEach(e => {
      if (!e.offsetWidth || e.closest('.drawer, nav, .header')) return;
      const label = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
      if (label) out.push(label);
    });
    return [...new Set(out)].slice(0, 9);
  });

  for (const label of triggers) {
    const openTrigger = async () => {
      await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(150);
      return page.evaluate((l) => {
        const list = [...document.querySelectorAll('button, [data-open], [data-modal], .ad-btn')]
          .filter(e => e.offsetWidth && !e.closest('.drawer, nav, .header'));
        const hit = list.find(e => ((e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)) === l);
        if (!hit) return false;
        hit.focus(); hit.click(); return true;
      }, label);
    };

    if (!(await openTrigger())) continue;
    await page.waitForTimeout(220);
    if (!(await openDialogs())) continue;         // not a dialog

    const focusable = await page.evaluate((l) => {
      const list = [...document.querySelectorAll('button, a, [role=button], [data-open], [data-modal], [data-act]')]
        .filter(e => e.offsetWidth && !e.closest('.drawer, nav, .header'));
      const hit = list.find(e => ((e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)) === l);
      return !!(hit && hit.matches('button, a[href], input, select, textarea, [tabindex]'));
    }, label);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(260);
    if (await openDialogs()) bad(`${pg} :: "${label}" stayed open on Escape`);
    else {
      const back = await page.evaluate((l) => {
        const a = document.activeElement;
        return !!a && a !== document.body && ((a.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)) === l;
      }, label);
      if (focusable && !back) bad(`${pg} :: "${label}" closed but focus did not return to it`);
      const locked = await page.evaluate(() => /hidden/.test(getComputedStyle(document.body).overflow) || document.body.style.overflow === 'hidden');
      if (locked) bad(`${pg} :: "${label}" left the page scroll-locked`);
      ok();
    }

    if (await openTrigger()) {
      await page.waitForTimeout(200);
      const spot = await page.evaluate((sel) => {
        const d = [...document.querySelectorAll(sel)].filter(x => x.offsetWidth).pop();
        if (!d) return null;
        const r = d.getBoundingClientRect();
        return { x: Math.max(4, r.left - 12), y: Math.max(4, Math.min(innerHeight - 4, r.top + 8)) };
      }, '.ac-bg, .bl-bg, .pe-bg, .tp-bg, .at-bg, .scrim');
      if (spot) {
        await page.mouse.click(spot.x, spot.y);
        await page.waitForTimeout(200);
        if (await openDialogs()) bad(`${pg} :: "${label}" stayed open on a backdrop click`);
        else ok();
      }
    }
  }
}

// ---------------------------------------------------------------- 2. print
for (const pg of PAGES) {
  await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(180);
  if (pg === 'appointment-confirmed.html') {
    await page.evaluate(() => {
      const list = HIS.store.get('mh_appts_extra', []);
      list.push({ patient: 'Ana B. Cruz', kind: 'General Check-Up', doctor: 'Dr. Marc Laureta', when: 'Sep 2, 2026 \u2022 10:30 AM', date: '2026-09-02' });
      HIS.store.set('mh_appts_extra', list);
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(160);
  }
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(120);
  const r = await page.evaluate(() => {
    const vis = (sel) => [...document.querySelectorAll(sel)].filter(e => {
      const s = getComputedStyle(e), b = e.getBoundingClientRect();
      return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0;
    }).length;
    return {
      chrome: vis('.header') + vis('.scrim') + vis('.drawer') + vis('.bell') + vis('[class$=-scrim]'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      text: (document.body.innerText || '').trim().length,
    };
  });
  if (r.chrome) bad(`${pg} prints app chrome (${r.chrome} element(s))`);
  else if (r.overflow > 2) bad(`${pg} is clipped in print by ${r.overflow}px`);
  else if (r.text < 80) bad(`${pg} prints almost nothing`);
  else ok();
  await page.emulateMedia({ media: 'screen' });
}

// ---------------------------------------------------------------- 3. exports
// A fresh context: the dialog pass legitimately changes records, and the export flows need the seeded
// payroll run and invoices that ship with a new session.
let freshCtx = await browser.newContext({ viewport: { width: 1440, height: 1024 }, acceptDownloads: true });
await page.close();
page = await freshCtx.newPage();
attach();
await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
await signIn(page);
const EXPORTS = [
  { page: 'payroll.html', control: 'Export payroll', confirm: 'Export file' },
  { page: 'attendance.html', control: 'Export', confirm: null },
  { page: 'audit.html', control: 'Export', confirm: null },
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-export-'));

for (const ex of EXPORTS) {
  await page.goto(`${base}/${ex.page}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(240);
  const dl = page.waitForEvent('download', { timeout: 6000 }).catch(() => null);
  const clicked = await page.evaluate((label) => {
    const b = [...document.querySelectorAll('button')].filter(x => x.offsetWidth)
      .find(x => (x.textContent || '').trim().toLowerCase().includes(label.toLowerCase()));
    if (!b) return false; b.click(); return true;
  }, ex.control);
  if (!clicked) { bad(`${ex.page}: no "${ex.control}" control`); continue; }
  await page.waitForTimeout(200);
  if (ex.confirm) {
    await page.evaluate((okLabel) => {
      const b = [...document.querySelectorAll('button')].filter(x => x.offsetWidth)
        .find(x => (x.textContent || '').trim().toLowerCase() === okLabel.toLowerCase());
      if (b) b.click();
    }, ex.confirm);
  }
  const download = await dl;
  if (!download) { bad(`${ex.page}: ${ex.control} produced no file`); continue; }
  const file = path.join(tmp, download.suggestedFilename());
  await download.saveAs(file);
  const csv = fs.readFileSync(file, 'utf8');
  const lines = csv.split(/\r?\n/).filter(l => l.length);
  const cols = new Set(lines.map(l => (l.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g) || []).length));
  if (lines.length < 2) bad(`${ex.page}: exported file has ${lines.length} line(s)`);
  else if (cols.size > 1) bad(`${ex.page}: ragged export — column counts ${[...cols].join(',')}`);
  else if (/NaN|undefined|\[object Object\]/.test(csv)) bad(`${ex.page}: export contains NaN/undefined/[object Object]`);
  else if (/(^|,)("?)([=+@])/.test(lines[1])) bad(`${ex.page}: export cell starts with a formula character`);
  else ok();
}

// ---------------------------------------------------------------- 4. double submit
// Another clean session: a payment already recorded above would change what each flow can do.
await page.close();
freshCtx = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
page = await freshCtx.newPage();
attach();
await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
await signIn(page);
const FLOWS = [
  { name: 'billing payment', page: 'billing.html', open: 'Record payment', fill: () => { } },
  { name: 'claims create', page: 'claims.html', open: 'New claim', fill: () => { const s = (n, v) => { const e = document.querySelector('[name="' + n + '"]'); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } }; s('requestedAmount', '500'); s('memberRef', 'MEM-1'); s('payer', 'PhilHealth'); } },
  { name: 'lab order', page: 'laboratory.html', open: '+ New order', fill: () => { } },
  { name: 'pharmacy rx', page: 'pharmacy.html', open: '+ New prescription', fill: () => { const s = (n, v) => { const e = document.querySelector('[name="' + n + '"]'); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } }; s('dosage', '500mg'); s('qty', '10'); } },
];

const recordCounts = () => page.evaluate(() => ({
  payments: (HIS.store.get('mh_ledger', []) || []).length,
  claims: (HIS.store.get('mh_claims', []) || []).length,
  lab: (HIS.store.get('mh_lab', []) || []).length,
  rx: (HIS.store.get('mh_rx', []) || []).length,
}));

for (const f of FLOWS) {
  await page.goto(`${base}/${f.page}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(260);
  const before = await recordCounts();
  const opened = await page.evaluate((label) => {
    const b = [...document.querySelectorAll('button')].filter(x => x.offsetWidth)
      .find(x => (x.textContent || '').trim().toLowerCase().startsWith(label.toLowerCase()));
    if (!b) return false; b.click(); return true;
  }, f.open);
  if (!opened) { bad(`${f.name}: opener missing`); continue; }
  await page.waitForTimeout(220);
  await page.evaluate(f.fill);
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.ac-bg, .bl-modal, .pe-modal, .tp-modal, .at-modal')].filter(d => d.offsetWidth);
    const scope = dialogs[dialogs.length - 1] || document.body;
    const btns = [...scope.querySelectorAll('button')].filter(b => b.offsetWidth && !b.disabled && !/cancel|close|×/i.test(b.textContent || ''));
    const hit = btns.find(b => /pay|record|create|save|assign|submit/i.test(b.textContent || '')) || btns[btns.length - 1];
    if (hit) { hit.click(); hit.click(); }
  });
  await page.waitForTimeout(600);
  const after = await recordCounts();
  const doubled = Object.keys(after).filter(k => after[k] - before[k] > 1);
  if (doubled.length) bad(`${f.name}: a double click wrote ${doubled.map(k => `${k} +${after[k] - before[k]}`).join(', ')}`);
  else ok();
}

// ---------------------------------------------------------------- 5. session scope
const tabA = await ctx.newPage();
await tabA.goto(`${base}/index.html`);
await signIn(tabA);
await tabA.goto(`${base}/payroll.html`);
await tabA.waitForTimeout(200);
const tabB = await ctx.newPage();
await tabB.goto(`${base}/index.html`);
await tabB.evaluate(() => HIS.auth.attempt('nurse@mediheal.test', 'MediHeal2026!', true));
await tabA.bringToFront();
await tabA.reload({ waitUntil: 'domcontentloaded' });
await tabA.waitForTimeout(250);
const scoped = await tabA.evaluate(() => ({
  role: (HIS.rbac.current() || {}).label || null,
  url: location.pathname.split('/').pop(),
  text: (document.body.innerText || '').slice(0, 80),
}));
if (!scoped.role) bad('second tab signing in left the first tab with no role');
else if (scoped.url === 'index.html') bad('second tab signing in threw the first tab back to sign-in');
else if (/Cannot|undefined|NaN/.test(scoped.text)) bad('first tab rendered an error after another tab signed in');
else ok();
await tabA.close();
await tabB.close();

// reload in the middle of a modal must not write
await page.goto(`${base}/billing.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(220);
const ledgerBefore = await page.evaluate(() => (HIS.store.get('mh_ledger', []) || []).length);
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /record payment/i.test(x.textContent || ''));
  if (b) b.click();
});
await page.waitForTimeout(220);
await page.evaluate(() => {
  const m = document.querySelector('.bl-modal'), amt = m && m.querySelector('[data-i="2"]');
  if (amt) { amt.value = '250'; amt.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(320);
const ledgerAfter = await page.evaluate(() => (HIS.store.get('mh_ledger', []) || []).length);
if (ledgerAfter !== ledgerBefore) bad(`reloading mid-modal wrote a payment (${ledgerBefore} → ${ledgerAfter})`);
else ok();

await browser.close();
server.close();
console.log(`\n${pass} passed, ${problems.length} failed | page errors: ${errors.length}`);
if (problems.length) { console.log('\nFAILURES:'); problems.forEach(p => console.log(' - ' + p)); }
if (errors.length) { console.log('\nPAGE ERRORS:'); [...new Set(errors)].slice(0, 5).forEach(e => console.log(' - ' + e)); }
process.exitCode = (problems.length || errors.length) ? 1 : 0;
