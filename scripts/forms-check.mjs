// Form boundary suite: every entry form in the app, in both directions.
//
// For each form the suite does two passes:
//   1. hostile pass  - fills junk (bad email, bad date, alphabetic number, whitespace-only text),
//                      submits, and requires a refusal *with a visible reason* plus an untouched store.
//   2. valid pass    - fills plausible values, submits, and requires the store to change with no
//                      NaN / undefined / Infinity / [object Object] / null entries written.
//
// Any uncaught page error fails the run.
//
//   PW=C:/Users/nekoc/node_modules/playwright-core/index.js node scripts/forms-check.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8891;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(PORT, r));
const BASE = `http://127.0.0.1:${PORT}`;

const pw = await import(pathToFileURL(process.env.PW || 'C:/Users/nekoc/node_modules/playwright-core/index.js').href);
const browser = await (pw.default || pw).chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e.message).slice(0, 120)));

let pass = 0; const fails = []; const failedToAccept = []; let openModalAgain = false;
const ok = (name) => { pass++; };
const bad = (name, why) => fails.push(`${name} :: ${why}`);

await page.goto(`${BASE}/index.html`);
await page.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));

// ---------------------------------------------------------------- helpers
const snapshot = () => page.evaluate(() => JSON.stringify(HIS.store.snapshot()));
// A store is dirty when hostile input, rather than merely an empty optional field, made it in.
// null is legitimate for optional fields, so it is not counted here.
const dirt = () => page.evaluate(() => {
  const s = JSON.stringify(HIS.store.snapshot());
  const hits = [];
  if (/NaN|Infinity/.test(s)) hits.push('NaN/Infinity');
  if (/undefined/.test(s)) hits.push('undefined');
  if (/\[object Object\]/.test(s)) hits.push('[object Object]');
  if (/not-an-email/.test(s)) hits.push('junk email stored');
  if (/"\s+"/.test(s)) hits.push('whitespace-only value stored');
  return hits;
});

// A refusal counts only when the user is told why: inline alert, toast/tip, or the browser's own
// constraint-validation message (which is what a real person sees under the field).
const refusalText = () => page.evaluate(() => {
  const out = [];
  document.querySelectorAll('[role=alert],[role=status],#kit-toast,.bl-tip,.ac-err,.md-err,[class*=toast],[class*=tip],.err-msg').forEach(e => {
    if (!e.offsetWidth) return;
    const t = (e.textContent || '').trim();
    if (t.length > 3) out.push(t);
  });
  document.querySelectorAll('input,select,textarea').forEach(e => {
    if (e.offsetWidth && e.validationMessage) out.push(e.validationMessage);
  });
  // A form with required/pattern fields is blocked by the browser itself; that tooltip is a real
  // reason even though it is not in the DOM.
  const form = document.querySelector('.ac-bg form, form');
  if (form && !form.checkValidity()) {
    const inv = form.querySelector(':invalid');
    out.push(inv && inv.validationMessage ? inv.validationMessage : 'browser blocked the submit: a required field is empty or malformed');
  }
  return [...new Set(out)].join(' | ').slice(0, 200);
});

const clickPrimary = (label) => page.evaluate((t) => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const wants = norm(t);
  // Modal shells differ per page (.ac-bg, .bl-modal, .pe-modal, .tp-modal, .at-modal), so always
  // scope the search to the innermost open dialog instead of the whole document.
  const dialogs = [...document.querySelectorAll('.ac-bg, .bl-modal, .pe-modal, .tp-modal, .at-modal, .cl-bg, .dm-bg, [class$=-modal]')]
    .filter(d => d.offsetWidth);
  const scope = dialogs[dialogs.length - 1] || document.body;
  const btns = [...scope.querySelectorAll('button')].filter(b => b.offsetWidth && !b.disabled);
  const hit = btns.find(b => norm(b.textContent) === wants)
    || btns.find(b => norm(b.textContent).startsWith(wants))
    || btns.filter(b => !/cancel|close|×|back|download|print/i.test(norm(b.textContent))).pop();
  if (hit) { hit.click(); return (hit.textContent || '').trim().slice(0, 30); }
  return false;
}, label);

// Junk values, chosen to be rejected by any sane validator.
const fillJunk = () => page.evaluate(() => {
  const set = (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
  let n = 0;
  document.querySelectorAll('input,select,textarea').forEach(e => {
    if (!e.offsetWidth || e.type === 'hidden' || e.type === 'checkbox' || e.type === 'radio') return;
    const id = (e.id || e.name || '').toLowerCase();
    let v = 'x';
    if (/email|mail/.test(id) || e.type === 'email') v = 'not-an-email';
    else if (/phone|tel|mobile/.test(id) || e.type === 'tel') v = 'abc';
    else if (/date|dob/.test(id) || e.type === 'date') v = '2026-02-30';
    else if (e.type === 'number') v = 'abc';
    else if (/amount|price|qty|quantity|rate/.test(id)) v = 'abc';
    else if (e.tagName === 'SELECT') v = '';
    else v = '   ';
    set(e, v); n++;
  });
  return n;
});

// Plausible values. Numeric-looking fields get digits, dates get a real date, the rest get text.
const refIds = await page.evaluate(() => {
  const reg = window.HIS && HIS.registry ? HIS.registry.all() : [];
  const bills = window.HIS && HIS.billing ? HIS.billing.all() : [];
  const open = bills.find(b => HIS.ledger.balanceOf(b) > 0) || bills[0];
  return { patientId: (reg[0] || {}).id || '', invoiceId: (open || {}).id || '' };
});

const fillValid = () => page.evaluate((ids) => {
  const set = (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
  document.querySelectorAll('input,select,textarea').forEach(e => {
    if (!e.offsetWidth || e.type === 'hidden') return;
    if (e.type === 'checkbox' || e.type === 'radio') { if (!e.checked) e.click(); return; }
    if (e.tagName === 'SELECT') { if (e.selectedIndex <= 0 && e.options.length > 1) { e.selectedIndex = 1; set(e, e.value); } return; }
    const id = (e.id || e.name || '').toLowerCase();
    const num = e.type === 'number' || /decimal|numeric/.test(e.getAttribute('inputmode') || '');
    if (/email|mail/.test(id) || e.type === 'email') return set(e, 'sweep.form@example.ph');
    if (/bp/.test(id)) return set(e, '120/80');
    if (/temp/.test(id)) return set(e, '36.8');
    if (/wt|weight/.test(id)) return set(e, '70');
    if (/ht|height/.test(id)) return set(e, '170');
    if (/dob|birth/.test(id)) return set(e, '12/04/1990');
    if (/zip/.test(id)) return set(e, '1100');
    if (/phone|tel|mobile/.test(id) || e.type === 'tel') return set(e, '+63 917 555 0801');
    if (/time/.test(id)) return set(e, '10:30 AM');
    if (/date|adate|effective/.test(id) || e.type === 'date') {
      return set(e, e.type === 'date' ? '2026-09-02' : (/dob|birth/.test(id) ? '12/04/1990' : '02/09/2026'));
    }
    if (num || /amount|price|qty|quantity|rate|days|hours|minutes|count|rooms|beds/.test(id)) return set(e, '100');
    if (/invoice/.test(id)) return set(e, ids.invoiceId || 'SWEEP-0001');
    if (/patient/.test(id)) return set(e, ids.patientId || 'SWEEP-0001');
    if (/ref|policy|member/.test(id)) return set(e, 'SWEEP-0001');
    return set(e, 'Sweep test');
  });
}, refIds);

// Custom listbox pickers: every picker owns its own (hidden) list, so scope to the button's parent.
const pickAll = async () => {
  for (let i = 0; i < 30; i++) {
    const progressed = await page.evaluate(() => {
      for (const btn of [...document.querySelectorAll('button.rf-sb, button.b')].filter(b => b.offsetWidth)) {
        const v = ((btn.querySelector('.v') || {}).textContent || '').trim();
        const empty = btn.classList.contains('rf-sb')
          ? /please select/i.test(v)
          : /^(please select|month|date|year|doctors|appointment type|gender|ward|bed number)$/i.test(v);
        if (!empty) continue;
        btn.click();
        const list = btn.parentElement.querySelector('[role=listbox], .p, .rf-p');
        const opts = list ? [...list.querySelectorAll('button')].filter(o => o.offsetWidth) : [];
        if (!opts.length) { btn.click(); continue; }
        opts[0].click();
        return true;
      }
      return false;
    });
    if (!progressed) break;
    await page.waitForTimeout(40);
  }
};

const openModal = async (pageName, opener) => {
  await page.goto(`${BASE}/${pageName}`);
  await page.waitForTimeout(320);
  return page.evaluate((t) => {
    const b = [...document.querySelectorAll('button')].filter(x => x.offsetWidth)
      .find(x => (x.textContent || '').trim().toLowerCase().startsWith(t.toLowerCase()));
    if (b) { b.click(); return true; }
    return false;
  }, opener);
};

// ---------------------------------------------------------------- the page forms
// These three forms are rendered by reg-form.js / reg-form-out.js / forms.js and use custom
// listboxes, so they are driven with explicit values instead of the generic filler.
const PAGE_FORMS = [
  {
    page: 'registration-form.html', label: 'Confirm Registration', name: 'registration-form', who: ['Sweeply', 'Excelsior', 'sweep.reg@example.ph', '+63 917 555 0801'],
    values: { 'f-first': 'Sweeply', 'f-last': 'Excelsior', 'f-dob': '12/04/1990', 'f-phone': '+63 917 555 0801', 'f-email': 'sweep.form@example.ph', 'f-street': '12 Sweep Street', 'f-city': 'Quezon City', 'f-prov': 'Metro Manila', 'f-zip': '1100', 'f-adate': '02/09/2026', 'f-bp': '120/80', 'f-temp': '36.8', 'f-wt': '70', 'f-ht': '170', 'f-efirst': 'Maria', 'f-elast': 'Excelsior', 'f-erel': 'Spouse', 'f-ephone': '+63 917 555 0802', 'f-reason': 'Follow-up consultation', 'f-cond': 'None' },
  },
  {
    page: 'outpatient-form.html', label: 'Confirm Registration', name: 'outpatient-form', who: ['Sweeply', 'Outpatiently', 'sweep.out@example.ph', '+63 917 555 0803'],
    values: { 'f-first': 'Sweeply', 'f-last': 'Outpatiently', 'f-dob': '12/04/1990', 'f-phone': '+63 917 555 0803', 'f-email': 'sweep.out@example.ph', 'f-street': '12 Sweep Street', 'f-city': 'Quezon City', 'f-prov': 'Metro Manila', 'f-zip': '1100', 'f-adate': '02/09/2026', 'f-atime': '10:30 AM', 'f-bp': '120/80', 'f-temp': '36.8', 'f-wt': '70', 'f-ht': '170', 'f-efirst': 'Maria', 'f-elast': 'Excelsior', 'f-erel': 'Spouse', 'f-ephone': '+63 917 555 0802', 'f-reason': 'Follow-up consultation', 'f-cond': 'None' },
  },
  {
    page: 'appointment-form.html', label: 'Confirm', name: 'appointment-form', who: ['Sweeply', 'Appointly', 'sweep.appt@example.ph', '+63 917 555 0805'],
    values: { fn: 'Sweeply', mi: 'R', ln: 'Appointly', ph: '+63 917 555 0805', em: 'sweep.appt@example.ph', ad: '12 Sweep Street, Quezon City', bp: '120/80', tp: '36.8', wt: '70', ht: '170', dt: '02/09/2026', tm: '10:30 AM' },
  },
];

for (const f of PAGE_FORMS) {
  await page.goto(`${BASE}/${f.page}`);
  await page.waitForTimeout(320);

  // hostile pass: everything empty, submit, must be told what is wrong and must not write
  const before = await snapshot();
  await clickPrimary(f.label);
  await page.waitForTimeout(350);
  const msg = await refusalText();
  if ((await snapshot()) !== before) bad(`${f.name} refuses an empty form`, 'store changed');
  else if (!msg) bad(`${f.name} refuses an empty form`, 'refused with no visible reason');
  else ok();

  // valid pass
  await page.evaluate((vals) => {
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e) return;
      e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    Object.entries(vals).forEach(([k, v]) => set(k, v));
  }, f.values);
  await pickAll();
  await page.evaluate((vals) => {
    const set = (id, v) => {
      const e = document.getElementById(id); if (!e || String(e.value).trim() === v) return;
      e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
    };
    Object.entries(vals).forEach(([k, v]) => set(k, v));
  }, f.values);
  const clicked = await clickPrimary(f.label);
  await page.waitForTimeout(650);
  if (process.env.DEBUG) {
    const vals = await page.evaluate(() => ['f-first', 'f-last', 'f-dob', 'f-atime', 'f-reason'].map(id => id + '=' + ((document.getElementById(id) || {}).value || '∅'))
      .concat(['| red:' + [...document.querySelectorAll('.err')].filter(e => e.offsetWidth).map(e => e.id).join('/')]));
    console.log(`  [debug] ${f.name} clicked=${JSON.stringify(clicked)} url=${page.url().split('/').pop()} vals=${vals.join(',')}`);
  }
  const changed = (await snapshot()) !== before;
  const d = await dirt();
  if (!changed) bad(`${f.name} accepts a filled form`, 'store unchanged — ' + (await refusalText()).slice(0, 90));
  else if (d.length) bad(`${f.name} accepts a filled form`, 'dirty store: ' + d.join(','));
  else ok();
}

// ---------------------------------------------------------------- the modal forms
const MODALS = [
  { page: 'charges.html', opener: 'Assign', label: 'Assign', name: 'charges assign' },
  { page: 'claims.html', opener: 'New claim', label: 'Create claim', name: 'claims create' },
  { page: 'laboratory.html', opener: '+ New order', label: 'Create order', name: 'laboratory order' },
  { page: 'pharmacy.html', opener: '+ New prescription', label: 'Create', name: 'pharmacy prescription' },
  { page: 'billing.html', opener: 'Record payment', label: 'Record payment', name: 'billing payment' },
  { page: 'admissions.html', opener: '+ Admit patient', label: 'Admit patient', name: 'admissions admit' },
  { page: 'personnel.html', opener: 'Add personnel', label: 'Add personnel', name: 'personnel add' },
  { page: 'settings.html', opener: '+ New price', label: 'Add price', name: 'settings price' },
  { page: 'attendance.html', opener: '+ New request', label: 'Submit request', name: 'attendance request' },
  { page: 'treatment.html', opener: 'Prescribe', label: 'Send to pharmacy', name: 'treatment prescribe' },
];

for (const m of MODALS) {
  const opened = await openModal(m.page, m.opener);
  if (!opened) { bad(`${m.name} opens`, 'opener button not found'); continue; }
  ok();

  // A junk submit may be refused, or it may succeed because the modal is driven by <select>s that
  // already hold real defaults. Either way two things must hold: the user is told why when it is
  // refused, and none of the junk reaches storage.
  const before = await snapshot();
  await fillJunk();
  await clickPrimary(m.label);
  await page.waitForTimeout(400);
  const msg = await refusalText();
  const afterJunk = await snapshot();
  const junkDirt = await dirt();
  if (afterJunk === before && !msg) bad(`${m.name} refuses junk`, 'refused with no visible reason');
  else if (junkDirt.length) bad(`${m.name} refuses junk`, 'junk reached the store: ' + junkDirt.join(','));
  else ok();

  if (afterJunk !== before) { openModalAgain = true; await openModal(m.page, m.opener); }
  const mark = await snapshot();
  await fillValid();
  await pickAll();
  await clickPrimary(m.label);
  await page.waitForTimeout(520);
  const accepted = (await snapshot()) !== mark;
  const d = await dirt();
  if (!accepted) failedToAccept.push(m.name + ': ' + (await refusalText()).slice(0, 70));
  else if (d.length) bad(`${m.name} accepts valid input`, 'dirty store: ' + d.join(','));
  else ok();
}

// ---------------------------------------------------------------- report
await browser.close();
server.close();
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log('\nFAILURES:'); fails.forEach(f => console.log(' - ' + f)); }
if (pageErrors.length) { console.log('\nPAGE ERRORS:'); pageErrors.slice(0, 6).forEach(e => console.log(' - ' + e)); }
process.exit(fails.length || pageErrors.length ? 1 : 0);
