// Ten independent attack passes. Each iteration is a different strategy, not a repeat of the last:
// repeating one check proves nothing beyond the first run. Invariants are re-derived from the modules
// after every step, so a failure names the rule that broke, not just "an error happened".
//
//   ITER=1..10 PW=... node scripts/gauntlet.mjs
//
// Ports: 8901 + (ITER % 8) so several iterations can run at once.

import fs from 'node:fs';
import { startServer, openBrowser, signIn } from './_harness.mjs';

const ITER = Number(process.env.ITER || 1);
const { server, base } = await startServer(8901 + (ITER % 8));
const { browser } = await openBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 }, acceptDownloads: true });
let page = await ctx.newPage();
const errors = [];
let downloads = 0;
page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
page.on('download', () => { downloads++; });

let pass = 0;
const problems = [];
const ok = (n = 1) => { pass += n; };
const bad = (what) => problems.push(what);

const PAGES = ['dashboard.html', 'registration.html', 'appointments.html', 'profile.html', 'departments.html',
  'billing.html', 'charges.html', 'claims.html', 'laboratory.html', 'pharmacy.html', 'treatment.html',
  'nursing.html', 'consultation.html', 'admissions.html', 'personnel.html', 'payroll.html', 'attendance.html',
  'reports.html', 'accounts.html', 'settings.html', 'audit.html'];

const JUNK = ['', ' ', '   ', '0', '-1', '1e9', 'null',
  '<script>alert(1)</script>', "' OR 1=1 --", '../../etc/passwd', 'µñïçödé 汉字 🧪', 'x'.repeat(300),
  '2026-13-45', '99:99', '-0.005', '1,234.567', '　'];

const storeFacts = () => page.evaluate(() => {
  const g = k => (window.HIS && HIS.store) ? HIS.store.get(k, []) : [];
  const inv = (window.HIS && HIS.ledger && HIS.ledger.invariants) ? HIS.ledger.invariants() : null;
  return {
    inv,
    ledger: Array.isArray(g('mh_ledger')) ? g('mh_ledger').length : -1,
    claims: Array.isArray(g('mh_claims')) ? g('mh_claims').length : -1,
    lab: Array.isArray(g('mh_lab')) ? g('mh_lab').length : -1,
    rx: Array.isArray(g('mh_rx')) ? g('mh_rx').length : -1,
    adm: Array.isArray(g('mh_admissions')) ? g('mh_admissions').length : -1,
    junk: (() => {
      var t = document.body.innerText || '';
      var hits = (t.match(/.{0,34}(?:undefined|NaN|Infinity|\[object Object\]).{0,34}/g) || [])
        .slice(0, 2).map(function (x) { return x.replace(/\s+/g, ' ').trim(); });
      if (!hits.length) return null;
      // name the element that owns the text, so a finding can be fixed without a second hunt
      var owner = null;
      var els = document.querySelectorAll('body *');
      for (var i = 0; i < els.length && !owner; i++) {
        var e = els[i];
        if (e.children.length) continue;
        if (/(undefined|NaN|Infinity|\[object Object\])/.test(e.textContent || '')) {
          owner = e.tagName.toLowerCase() + '.' + String(e.className || '').split(' ')[0] + ' :: ' + (e.outerHTML || '').slice(0, 140);
        }
      }
      return { hits: hits, owner: owner };
    })(),
  };
});

const checkInvariants = async (where) => {
  const f = await storeFacts();
  if (f.inv && f.inv.ok === false) bad(`${where} :: ledger invariant broken: ${JSON.stringify(f.inv).slice(0, 150)}`);
  else if (f.inv && Array.isArray(f.inv.violations) && f.inv.violations.length) bad(`${where} :: ledger violations: ${f.inv.violations.length}`);
  if (f.junk) bad(`${where} :: visible junk text: ${JSON.stringify(f.junk)}`);
  return f;
};

const reseed = async () => {
  page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { sessionStorage.clear(); } catch (e) { } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await signIn(page);
};

const rnd = (seed) => { let s = seed; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; };

// ------------------------------------------------------------------ strategies
const strategies = {
  async 1() {                                     // random walk with invariants
    const r = rnd(ITER * 7919 + 13);
    await reseed();
    for (let i = 0; i < 120; i++) {
      const pg = PAGES[Math.floor(r() * PAGES.length)];
      try { await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' }); } catch (e) { continue; }
      await page.waitForTimeout(90);
      for (let k = 0; k < 3; k++) {
        const did = await page.evaluate((v) => {
          const els = [...document.querySelectorAll('button, [role=button], input, select, [data-tab], th')]
            .filter(e => e.offsetWidth && !e.closest('nav, .header, .scrim'));
          if (!els.length) return false;
          const e = els[Math.floor(Math.random() * els.length)];
          if (e.tagName === 'INPUT' || e.tagName === 'SELECT') {
            if (e.tagName === 'SELECT') { e.selectedIndex = Math.floor(Math.random() * e.options.length); }
            else { e.value = v; }
            e.dispatchEvent(new Event('input', { bubbles: true }));
            e.dispatchEvent(new Event('change', { bubbles: true }));
          } else { e.click(); }
          return true;
        }, JUNK[Math.floor(r() * JUNK.length)]);
        if (!did) break;
        await page.waitForTimeout(60);
      }
      await checkInvariants(`walk/${pg}`);
      const nav = await page.evaluate(() => location.pathname);
      if (nav === '__navigating__') continue;
      ok();
    }
  },

  async 2() {                                     // hostile value into every visible field on every page
    await reseed();
    for (const pg of PAGES) {
      await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(150);
      const before = errors.length;
      const fills = await page.evaluate((junk) => {
        const inputs = [...document.querySelectorAll('input, textarea, select')].filter(e => e.offsetWidth && !e.disabled);
        let n = 0;
        inputs.forEach((e, i) => {
          const v = junk[(i + 3) % junk.length];
          if (e.tagName === 'SELECT') { if (e.options.length > 1) e.selectedIndex = e.options.length - 1; }
          else { e.focus(); e.value = v; }
          e.dispatchEvent(new Event('input', { bubbles: true }));
          e.dispatchEvent(new Event('change', { bubbles: true }));
          e.dispatchEvent(new Event('blur', { bubbles: true }));
          n++;
        });
        return n;
      }, JUNK);
      await page.waitForTimeout(120);
      if (errors.length > before) bad(`${pg} :: hostile value in ${fills} fields threw: ${errors[before]}`);
      await checkInvariants(`${pg} hostile-fields`);
      // and the page must still work: a reload with junk in the store must render
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(180);
      const r = await page.evaluate(() => ({ t: (document.body.innerText || '').trim().length, url: location.pathname.split('/').pop() }));
      if (r.t < 60 && r.url !== 'index.html') bad(`${pg} :: nearly empty after reload with junk in the fields`);
      else ok();
    }
  },

  async 3() {                                     // matrix: every role, every page, hostile interactions
    await reseed();
    const roles = ['superadmin', 'registration', 'doctor', 'nurse', 'pharmacist', 'lab', 'finance', 'hr', 'depthead', 'auditor', 'patient'];
    for (const role of roles) {
      await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
      const signed = await page.evaluate((r) => {
        const acc = HIS.accounts.all().find(a => a.role === r && a.active !== false);
        return acc ? HIS.auth.attempt(acc.email, 'MediHeal2026!', true).ok : false;
      }, role);
      if (!signed) { bad(`role ${role}: cannot sign in`); continue; }
      const home = await page.evaluate(r => (HIS.rbac.ROLES[r] || {}).home, role);
      for (const pg of PAGES) {
        const before = errors.length;
        await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(110);
        if (errors.length > before) bad(`${role}/${pg} :: ${errors[before]}`);
        const landed = await page.evaluate(() => location.pathname.split('/').pop());
        if (landed !== pg && landed !== home + '.html') { bad(`${role}/${pg} :: unexpected redirect to ${landed}`); continue; }
        await page.evaluate(() => {
          [...document.querySelectorAll('th, [data-tab], select')].filter(e => e.offsetWidth).slice(0, 6)
            .forEach((e, i) => { if (e.tagName === 'SELECT' && e.options.length > 1) e.selectedIndex = (e.selectedIndex + 2) % e.options.length; else e.click(); });
          [...document.querySelectorAll('input[type=search], input[placeholder*=earch]')].filter(e => e.offsetWidth)
            .forEach(e => { e.value = i => ' q#%'; e.value = ' q#%'; e.dispatchEvent(new Event('input', { bubbles: true })); });
        });
        await page.waitForTimeout(90);
        if (errors.length > before) bad(`${role}/${pg} :: interaction threw: ${errors[before]}`);
        await checkInvariants(`${role}/${pg} interactions`);
        ok();
      }
    }
  },

  async 4() {                                     // modal gauntlet: hostile fill, submit, escape
    await reseed();
    for (const pg of PAGES) {
      await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(160);
      const labels = await page.evaluate(() => [...new Set([...document.querySelectorAll('button, [data-open]')]
        .filter(e => e.offsetWidth && !e.closest('nav, .header, .drawer'))
        .map(e => (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26)).filter(Boolean))].slice(0, 8));
      for (const label of labels) {
        await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(130);
        const opened = await page.evaluate((l) => {
          const hit = [...document.querySelectorAll('button, [data-open]')].filter(e => e.offsetWidth && !e.closest('nav, .header, .drawer'))
            .find(e => ((e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26)) === l);
          if (!hit) return false; hit.click(); return true;
        }, label);
        if (!opened) continue;
        await page.waitForTimeout(200);
        const isOpen = await page.evaluate(() => [...document.querySelectorAll('.ac-bg, [class$=-modal], .scrim, [role=dialog]')].some(d => d.offsetWidth));
        if (!isOpen) continue;
        const before = errors.length;
        const wroteFrom = await storeFacts();
        const downloadsBefore = downloads;
        const fields = await page.evaluate(() => {
          const d = [...document.querySelectorAll('.ac-bg, .ac-m, [class$=-modal], [role=dialog]')].filter(x => x.offsetWidth).pop();
          if (!d) return 0;
          return { editable: [...d.querySelectorAll('input, textarea, select')]
            .filter(e => e.offsetWidth && !e.readOnly && !e.disabled && !/search|filter|lookup|picker/i.test(e.id + ' ' + e.className + ' ' + (e.type || ''))).length,
            required: d.querySelectorAll('[required]').length,
            sideEffect: [...d.querySelectorAll('button')].some(b => b.offsetWidth && /download|print|export/i.test(b.textContent || '')) };
        });
        // hostile values inside the dialog, then submit
        await page.evaluate((junk) => {
          const dialogs = [...document.querySelectorAll('.ac-bg, .ac-m, [class$=-modal], [role=dialog]')].filter(d => d.offsetWidth);
          const scope = dialogs[dialogs.length - 1] || document.body;
          [...scope.querySelectorAll('input, textarea, select')].filter(e => e.offsetWidth).forEach((e, i) => {
            if (e.tagName === 'SELECT') { if (e.options.length > 1) e.selectedIndex = e.options.length - 1; }
            else e.value = junk[(i + 5) % junk.length];
            e.dispatchEvent(new Event('input', { bubbles: true }));
          });
          const btn = [...scope.querySelectorAll('button')].filter(b => b.offsetWidth && !/^(cancel|close|dismiss|×)$/i.test(b.textContent || '')).pop();
          if (btn) btn.click();
        }, JUNK.filter(j => !/^(undefined|NaN|\[object Object\])$/.test(j)));
        await page.waitForTimeout(400);
        const f = await checkInvariants(`modal/${pg} "${label}" submit`);
        if (errors.length > before) bad(`modal/${pg} "${label}" :: hostile submit threw: ${errors[before]}`);
        // the dialog must either close with a written reason, or stay open with a written reason
        const state = await page.evaluate(() => {
          const open = [...document.querySelectorAll('.ac-bg, .ac-m, [class$=-modal], [role=dialog]')].filter(d => d.offsetWidth).length;
          const said = [...document.querySelectorAll('[role=alert], #mdErr, .ac-err, [class*=err], [class*=tip], #kit-toast, .bl-tip')]
            .filter(e => e.offsetWidth && (e.textContent || '').trim().length > 3).map(e => (e.textContent || '').trim().slice(0, 60));
          // a required field inside a <form class=ac-m> is refused by the browser, which focuses the
          // field and states the reason; that message is a written reason too
          const native = [...document.querySelectorAll(':invalid')].map(e => e.validationMessage).filter(Boolean);
          return { open, said, native };
        });
        const invalid = await page.evaluate(() => [...document.querySelectorAll('[aria-invalid=true]')].length);
        // Only a dialog that actually holds editable fields can refuse; a viewer/résumé dialog has
        // nothing to refuse and is allowed to just sit there.
        const wroteNow = f.ledger !== wroteFrom.ledger || f.claims !== wroteFrom.claims || f.lab !== wroteFrom.lab || f.rx !== wroteFrom.rx || f.adm !== wroteFrom.adm;
        const downloaded = downloads > downloadsBefore;
        const formLike = fields.required > 0 || fields.editable >= 2;
        if (formLike && !fields.sideEffect && state.open > 0 && !state.said.length && !state.native.length && !invalid && !wroteNow && !downloaded) {
          bad(`modal/${pg} "${label}" :: hostile submit refused with no written reason (${fields.editable} field(s))`);
        }
        // then leave it cleanly and prove focus survived
        let left = null;
        for (let esc = 0; esc < 3; esc++) {
          await page.keyboard.press('Escape');
          await page.waitForTimeout(200);
          left = await page.evaluate(() => ({
          open: [...document.querySelectorAll('.ac-bg, .ac-m, [class$=-modal], [role=dialog]')].filter(d => d.offsetWidth).length,
          focus: document.activeElement ? document.activeElement.tagName : null,
            lock: /hidden/.test(getComputedStyle(document.body).overflow),
          }));
          if (!left.open) break;
        }
        if (left.open) bad(`modal/${pg} "${label}" :: three Escape presses left a dialog open`);
        else if (left.lock) bad(`modal/${pg} "${label}" :: page left scroll-locked`);
        else ok();
      }
    }
  },

  async 5() {                                     // forms, both directions, randomised values
    const r = rnd(ITER * 104729 + 7);
    await reseed();
    for (const pg of ['registration-form.html', 'outpatient-form.html', 'appointment-form.html']) {
      for (let attempt = 0; attempt < 3; attempt++) {
        await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(220);
        const before = await storeFacts();
        const beforeErr = errors.length;
        const res = await page.evaluate((v) => {
          const set = (id, val) => { const e = document.getElementById(id); if (!e) return false; e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); return true; };
          const ids = ['f-first', 'f-mid', 'f-last', 'f-email', 'f-phone', 'f-dob', 'f-addr', 'f-city', 'f-zip'];
          let n = 0;
          ids.forEach((id, i) => { if (set(id, v[(i + 2) % v.length])) n++; });
          const form = document.querySelector('form') || document.body;
          const btn = document.getElementById('confirm') || [...form.querySelectorAll('button')].filter(b => b.offsetWidth && (b.type === 'submit' || /submit|confirm|register|continue|book/i.test(b.textContent || ''))).pop();
          if (btn) btn.click();
          return { filled: n, submitted: !!btn };
        }, JUNK);
        await page.waitForTimeout(500);
        const after = await storeFacts();
        const wrote = after.ledger > before.ledger || after.claims > before.claims || after.adm > before.adm;
        const refused = await page.evaluate(() => ({
          alert: [...document.querySelectorAll('[role=alert], #kit-toast, .err, [class*=err]')].filter(e => e.offsetWidth && (e.textContent || '').trim().length > 3).length,
          invalid: document.querySelectorAll('[aria-invalid=true]').length,
          native: !!(document.querySelector('input:invalid') && document.querySelector('input:invalid').validationMessage),
        }));
        if (errors.length > beforeErr) bad(`${pg} junk attempt ${attempt + 1} threw: ${errors[beforeErr]}`);
        else if (wrote) bad(`${pg} junk attempt ${attempt + 1} wrote a record from hostile input`);
        else if (!refused.alert && !refused.invalid && !refused.native) bad(`${pg} junk attempt ${attempt + 1} refused with no written reason`);
        else ok();
      }
    }
  },
};

// ------------------------------------------------------------------ 6..10 live in gauntlet-2.mjs
const api = {
  get page() { return page; }, set page(p) { page = p; },
  ctx, base, browser, errors, problems, JUNK, PAGES,
  ok, bad, storeFacts, checkInvariants, reseed, rnd,
  get pass() { return pass; }, set pass(v) { pass = v; },
};

try {
  if (strategies[ITER]) await strategies[ITER]();
  else {
    const mod = await import('./gauntlet-2.mjs');
    await mod.run(ITER, api);
    pass = api.pass;
  }
} catch (e) {
  bad(`iteration ${ITER} crashed the harness: ${String(e.message).slice(0, 160)}`);
}

await browser.close();
server.close();
const line = `iter ${ITER}: ${pass} checks, ${problems.length} problems, ${errors.length} page errors`;
fs.appendFileSync('C:/Users/nekoc/probes/gauntlet.log', line + '\n' + problems.map(p => '   - ' + p).join('\n') + (problems.length ? '\n' : ''));
console.log(line);
[...new Set(problems)].slice(0, 12).forEach(p => console.log(' - ' + p));
[...new Set(errors)].slice(0, 4).forEach(e => console.log(' ! ' + e));
process.exitCode = problems.length || errors.length ? 1 : 0;
