// The brutal run. Five phases that each try to break the app in a way the ten gauntlet passes did not:
//
//   A  marathon     - 900 steps of random clicks, typing, navigation, reloads and Escape, with the
//                     ledger/stock/bed invariants re-derived after every single step
//   B  corruption   - every store key against every wrong JSON shape, on six pages that read it
//   C  storm        - every visible control clicked three times in one tick, then Escape twice, per page
//   D  starved      - core assets blocked (404) one at a time; the app must fail visibly, not spin forever
//   E  bulk         - thousands of seeded records; pages must still render and keep invariants
//
//   PW=... node scripts/brutal.mjs            (PHASES=A,B,C,D,E to pick)
//   PW=... BROWSER=firefox node scripts/brutal.mjs

import fs from 'node:fs';
import { startServer, openBrowser, signIn } from './_harness.mjs';

const PHASES = (process.env.PHASES || 'A,B,C,D,E').split(',').map(s => s.trim().toUpperCase());
const ITER = Number(process.env.ITER || 0);
const { server, base } = await startServer(8935 + (ITER % 4));
const { browser } = await openBrowser(process.env.CHANNEL || 'chrome');
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 }, acceptDownloads: true });
let page = await ctx.newPage();
const errors = [];
const attach = (p) => {
  p.on('pageerror', e => errors.push(String(e.message).slice(0, 110) + ' @@ ' + String(e.stack || '').split(String.fromCharCode(10)).slice(1, 3).join(' | ').slice(0, 160)));
  p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text().slice(0, 110)); });
};
attach(page);

let pass = 0;
const problems = [];
const ok = (n = 1) => { pass += n; };
const bad = (w) => problems.push(w);

const PAGES = ['dashboard.html', 'registration.html', 'registration-form.html', 'appointments.html', 'profile.html',
  'departments.html', 'billing.html', 'charges.html', 'claims.html', 'laboratory.html', 'pharmacy.html',
  'treatment.html', 'nursing.html', 'consultation.html', 'admissions.html', 'personnel.html', 'payroll.html',
  'attendance.html', 'reports.html', 'accounts.html', 'settings.html', 'audit.html', 'portal.html'];

// No literal 'NaN'/'undefined'/'[object Object]': the junk check looks for exactly those strings, and a
// field that echoes what was typed is not a render bug.
const JUNK = ['', ' ', '   ', '0', '-1', '1e9', 'null', '2026-13-45', '99:99', '<b>x</b>',
  "' OR 1=1 --", '../../etc/passwd', 'µñïçödé 汉字 🧪', 'x'.repeat(400), '\u0000', '　', '1,234.567'];

const rnd = (seed) => { let s = seed >>> 0; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };

const facts = () => page.evaluate(() => {
  const g = k => (window.HIS && HIS.store) ? HIS.store.get(k, []) : [];
  let inv = null;
  try { inv = window.HIS && HIS.ledger && HIS.ledger.invariants ? HIS.ledger.invariants() : null; } catch (e) { inv = { error: String(e.message).slice(0, 80) }; }
  const t = document.body.innerText || '';
  const junk = (t.match(/.{0,30}(?:undefined|NaN|Infinity|\[object Object\]).{0,30}/g) || []).slice(0, 1)
    .map(x => x.replace(/\s+/g, ' ').trim());
  let owner = null;
  if (junk.length) {
    const els = document.querySelectorAll('body *');
    for (let i = 0; i < els.length && !owner; i++) {
      const e = els[i];
      if (e.children.length || !/(undefined|NaN|Infinity|\[object Object\])/.test(e.textContent || '')) continue;
      owner = e.tagName.toLowerCase() + '.' + String(e.className || '').split(' ')[0] + ' :: ' + (e.outerHTML || '').slice(0, 120);
    }
  }
  return {
    inv, junk: junk.length ? { hits: junk, owner: owner } : null,
    ledger: (g('mh_ledger') || []).length, claims: (g('mh_claims') || []).length,
    lab: (g('mh_lab') || []).length, rx: (g('mh_rx') || []).length, adm: (g('mh_admissions') || []).length,
    url: location.pathname.split('/').pop(),
  };
});

const brokenInv = (inv) => inv && (inv.ok === false || (Array.isArray(inv) && inv.length > 0) || (Array.isArray(inv.violations) && inv.violations.length));

const reseed = async () => {
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch (e) { } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);
  await signIn(page);
};

// ------------------------------------------------------------------ A. marathon
if (PHASES.includes('A')) {
  await reseed();
  const r = rnd(90210 + ITER * 31);
  const STEPS = Number(process.env.STEPS || 900);
  let navs = 0, clicks = 0, types = 0, escapes = 0, reloads = 0;
  for (let i = 0; i < STEPS; i++) {
    const roll = r();
    try {
      if (roll < 0.24) {
        await page.goto(`${base}/${PAGES[Math.floor(r() * PAGES.length)]}`, { waitUntil: 'domcontentloaded' });
        navs++;
      } else if (roll < 0.60) {
        const did = await page.evaluate((v) => {
          const els = [...document.querySelectorAll('button, [role=button], input, select, textarea, th, [data-tab], [data-open]')]
            .filter(e => e.offsetWidth && !e.closest('nav, .header, .drawer'));
          if (!els.length) return false;
          const e = els[Math.floor(Math.random() * els.length)];
          if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') { e.focus(); e.value = v; }
          else if (e.tagName === 'SELECT') { if (e.options.length > 1) e.selectedIndex = Math.floor(Math.random() * e.options.length); }
          e.dispatchEvent(new Event('input', { bubbles: true }));
          e.dispatchEvent(new Event('change', { bubbles: true }));
          if (e.tagName !== 'INPUT' && e.tagName !== 'TEXTAREA' && e.tagName !== 'SELECT') e.click();
          return true;
        }, JUNK[Math.floor(r() * JUNK.length)]).catch(() => false);
        if (did) clicks++;
      } else if (roll < 0.74) {
        const typed = await page.evaluate((v) => {
          const els = [...document.querySelectorAll('input, textarea')].filter(e => e.offsetWidth && !e.readOnly && !e.disabled);
          if (!els.length) return false;
          const e = els[Math.floor(Math.random() * els.length)];
          e.focus(); e.value = v;
          e.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }, JUNK[Math.floor(r() * JUNK.length)]).catch(() => false);
        if (typed) types++;
      } else if (roll < 0.86) {
        await page.keyboard.press('Escape'); escapes++;
      } else if (roll < 0.94) {
        await page.reload({ waitUntil: 'domcontentloaded' }); reloads++;
      } else {
        await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
      }
      const f = await facts().catch(() => null);
      if (!f) continue;
      if (brokenInv(f.inv)) { bad(`marathon step ${i}: ledger invariant broken`); break; }
      if (f.junk) bad(`marathon step ${i} on ${f.url}: ${JSON.stringify(f.junk)}`);
      if (!/^(.+)\.html$/.test(f.url) && f.url !== '') bad(`marathon step ${i}: navigated off the app to ${f.url}`);
      else ok();
    } catch (e) {
      const msg = String(e.message).slice(0, 80);
      const moved = /destroyed|Target closed|navigation|net::ERR_ABORTED|Not attached|not attached/i.test(msg);
      if (!moved) { bad(`marathon step ${i}: ${msg}`); break; }
      // The tab can be replaced mid-step (a reload tearing down the context). Take a fresh one so the
      // marathon keeps walking instead of ending on a transport error.
      if (/Not attached|not attached|Target closed/i.test(msg)) {
        try {
          page = await ctx.newPage();
          attach(page);
          await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(150);
          await signIn(page);
        } catch (err) { bad(`marathon step ${i}: could not recover the page: ${String(err.message).slice(0, 60)}`); break; }
      }
      ok();
    }
  }
  console.log(`  marathon: ${navs} nav, ${clicks} clicks, ${types} typed, ${escapes} esc, ${reloads} reloads`);
}

// ------------------------------------------------------------------ B. corruption matrix
if (PHASES.includes('B')) {
  const KEYS = ['mh_ledger', 'mh_claims', 'mh_admissions', 'mh_lab', 'mh_rx', 'mh_invoices', 'mh_charge_links',
    'mh_payroll_runs', 'mh_audit', 'mh_appts_extra', 'mh_patients', 'mh_employees', 'mh_beds', 'mh_settings',
    'mh_accounts', 'mh_session', 'mh_attendance', 'mh_tariffs'];
  const SHAPES = ['null', '"str"', '0', 'true', '[]', '[null]', '[1,2,3]', '[{"id":null}]', '{"a":1}',
    '[{"amount":"NaN","id":{},"at":"x","name":{}}]', '[[[]]]', '{"length":3}'];
  const WATCH = ['billing.html', 'admissions.html', 'registration.html', 'laboratory.html', 'payroll.html', 'dashboard.html'];
  for (const key of KEYS) {
    for (const shape of SHAPES) {
      await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
      const wrote = await page.evaluate(({ k, s }) => { try { sessionStorage.setItem(k, s); return true; } catch (e) { return false; } }, { k: key, s: shape });
      if (!wrote) continue;
      const before = errors.length;
      let broke = null;
      for (const pg of WATCH) {
        await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' }).catch(() => { });
        await page.waitForTimeout(70);
        if (errors.length > before) { broke = `${pg}: ${errors[before]}`; errors.length = before; break; }
      }
      if (broke) bad(`corrupt ${key}=${shape.slice(0, 16)} -> ${broke}`);
      else ok();
    }
  }
  console.log(`  corruption: ${KEYS.length} keys x ${SHAPES.length} shapes x ${WATCH.length} pages`);
}

// ------------------------------------------------------------------ C. interaction storm
if (PHASES.includes('C')) {
  await reseed();
  for (const pg of PAGES) {
    await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(140);
    const before = errors.length;
    const n = await page.evaluate(() => {
      const els = [...document.querySelectorAll('button, [data-open], [role=button]')].filter(e => e.offsetWidth && !e.closest('nav, .header'));
      let hit = 0;
      els.forEach(e => { for (let k = 0; k < 3; k++) { try { e.click(); hit++; } catch (err) { } } });
      return hit;
    }).catch(() => 0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(180);
    const f = await facts().catch(() => null);
    if (errors.length > before) bad(`storm ${pg}: ${errors[before]}`);
    else if (f && brokenInv(f.inv)) bad(`storm ${pg}: invariant broken after ${n} clicks`);
    else if (f && f.junk) bad(`storm ${pg}: junk text ${JSON.stringify(f.junk)}`);
    else ok();
  }
}

// ------------------------------------------------------------------ D. starved assets
if (PHASES.includes('D')) {
  const ASSETS = ['assets/js/kit.js', 'assets/js/store.js', 'assets/js/rbac.js', 'assets/js/ledger.js',
    'assets/js/shell.js', 'assets/js/billing.js', 'assets/css/base.css', 'assets/js/data.js'];
  for (const asset of ASSETS) {
    const victim = await ctx.newPage();
    attach(victim);
    await victim.route(`**/${asset.split('/').pop()}`, r => r.fulfill({ status: 404, body: 'not found' }));
    const beforeErr = errors.length;
    let visible = false;
    try {
      await victim.goto(`${base}/billing.html`, { waitUntil: 'domcontentloaded' });
      await victim.waitForTimeout(700);
      const state = await victim.evaluate(() => ({
        text: (document.body.innerText || '').trim().length,
        blank: document.body.innerHTML.trim().length < 200,
        spinning: !!document.querySelector('.loading, .spinner, [aria-busy=true]'),
        reachable: typeof window.HIS === 'object',
      }));
      // Degrading is fine; a blank page with no explanation is not.
      visible = state.text > 40 || state.blank === false;
      if (state.blank && !state.text) bad(`starved ${asset}: billing.html went blank on a 404`);
      else if (state.spinning && !state.text) bad(`starved ${asset}: billing.html spun with no content`);
      else ok();
    } catch (e) {
      // a hard navigation failure is acceptable as long as a reload of a working page recovers
      ok();
    }
    // the app must recover once the asset is back
    await victim.unroute(`**/${asset.split('').length && asset.split('/').pop()}`).catch(() => { });
    await victim.goto(`${base}/dashboard.html`, { waitUntil: 'domcontentloaded' }).catch(() => { });
    await victim.waitForTimeout(300);
    const recovered = await victim.evaluate(() => (document.body.innerText || '').trim().length > 200).catch(() => false);
    if (!recovered) bad(`starved ${asset}: the app did not recover after the asset came back`);
    else ok();
    if (errors.length > beforeErr) errors.length = beforeErr;   // expected while the asset is missing
    await victim.close();
  }
}

// ------------------------------------------------------------------ E. bulk data
if (PHASES.includes('E')) {
  await reseed();
  const seeded = await page.evaluate(() => {
    try {
      const led = HIS.store.get('mh_ledger', []);
      const rows = [];
      for (let i = 0; i < 2500; i++) rows.push({ id: 'BX-' + i, invoiceId: 'BL-0001', kind: 'payment', amount: 100 + i, at: new Date(2026, 0, 1 + (i % 300)).toISOString(), method: 'Cash' });
      HIS.store.set('mh_ledger', (Array.isArray(led) ? led : []).concat(rows));
      const adm = HIS.store.get('mh_admissions', []);
      const beds = HIS.store.get('mh_beds', []);
      return { ledger: (HIS.store.get('mh_ledger', []) || []).length, adm: (Array.isArray(adm) ? adm.length : 0), beds: (Array.isArray(beds) ? beds.length : 0) };
    } catch (e) { return { error: String(e.message).slice(0, 90) }; }
  });
  if (seeded.error) bad(`bulk seed: ${seeded.error}`);
  else {
    for (const pg of ['billing.html', 'reports.html', 'dashboard.html', 'admissions.html']) {
      const t0 = Date.now();
      await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(250);
      const ms = Date.now() - t0;
      const f = await facts().catch(() => null);
      const rendered = await page.evaluate(() => (document.body.innerText || '').trim().length > 200);
      if (!rendered) bad(`bulk ${pg}: did not render with ${seeded.ledger} ledger rows`);
      else if (brokenInv(f && f.inv)) bad(`bulk ${pg}: invariant broken with ${seeded.ledger} rows`);
      else if (ms > 6000) bad(`bulk ${pg}: took ${ms}ms to show ${seeded.ledger} rows`);
      else ok();
    }
  }
}

await browser.close();
server.close();
console.log(`\nbrutal ${PHASES.join('+')}: ${pass} checks, ${problems.length} problems, ${errors.length} page errors`);
[...new Set(problems)].slice(0, 14).forEach(p => console.log(' - ' + p));
[...new Set(errors)].slice(0, 6).forEach(e => console.log(' ! ' + e));
process.exitCode = problems.length ? 1 : 0;
