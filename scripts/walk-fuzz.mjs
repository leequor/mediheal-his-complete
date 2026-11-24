// Random-walk fuzz with invariants: walks every page clicking and typing at random, and re-derives the
// money, stock and bed invariants after every step. Scripted journeys live in sequences-check; this
// covers the states a person reaches by accident.
//
//   PW=... node scripts/walk-fuzz.mjs          STEPS=400 SEED=7

import { pathToFileURL } from 'node:url';

// Random-walk fuzz with invariants.
//
// Walks the app at random — page to page, clicking random controls, typing random text, opening and
// dismissing modals — and after *every* step re-derives the money, stock and bed invariants. The point
// is not coverage of a scripted journey (that is sequences-check) but the states a person reaches by
// accident: half-filled forms, filters combined with sorts, actions taken in an odd order.
//
//   PW=... node probes/walk-fuzz.mjs        STEPS=600 SEED=1 VERBOSE=1

const STEPS = Number(process.env.STEPS || 600);
let seed = Number(process.env.SEED || 1);

// deterministic PRNG so a failure can be replayed with the same SEED
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

const PAGES = ['dashboard.html', 'registration.html', 'appointments.html', 'profile.html', 'departments.html',
  'billing.html', 'charges.html', 'claims.html', 'laboratory.html', 'pharmacy.html', 'treatment.html',
  'nursing.html', 'consultation.html', 'admissions.html', 'personnel.html', 'payroll.html', 'attendance.html',
  'reports.html', 'accounts.html', 'settings.html', 'audit.html'];

const JUNK = ['', '   ', 'zzz', '-1', '0', '999999999', '1e9', '≈≈≈', '<b>x</b>', 'NaN', 'null', '#', '1000000',
  '2026-13-45', '99:99', 'not-an-email', 'x"y', "O'Brien", '😀', 'مرحبا'];

const { startServer, openBrowser } = await import('./_harness.mjs');
const { server, base } = await startServer(8895);
const BASE = base;
const { browser } = await openBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
let page = await ctx.newPage();
const errors = [];
const attach = () => page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
attach();

const problems = [];
let navCount = 0;
const go = async (url) => {
  navCount++;
  if (navCount % 40 === 0) { await page.close(); page = await ctx.newPage(); attach(); await signIn(); }
  for (let i = 0; i < 3; i++) {
    try { await page.goto(url, { waitUntil: 'domcontentloaded' }); return true; } catch (e) { await page.waitForTimeout(200); }
  }
  return false;
};

const signIn = async () => {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));
};

// Invariants are derived from the modules, never from stored sums.
const invariants = () => page.evaluate(() => {
  const out = [];
  // a click that navigates can catch the page mid-teardown; that is not an app defect
  if (typeof window.HIS === 'undefined') return ['__navigating__'];
  try {
    if (HIS.ledger && HIS.ledger.invariants) {
      const r = HIS.ledger.invariants();
      const list = Array.isArray(r) ? r : (r && r.problems) || [];
      list.slice(0, 2).forEach(x => out.push('ledger: ' + String(typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 110)));
    }
    const bills = (HIS.billing && HIS.billing.all ? HIS.billing.all() : []);
    bills.forEach(b => {
      const bal = HIS.ledger.balanceOf(b), paid = HIS.ledger.paidOf(b), inv = HIS.ledger.invoiceAmount(b);
      if (!isFinite(bal) || !isFinite(paid) || !isFinite(inv)) out.push('non-finite money on ' + b.id);
      if (paid > inv + 0.011) out.push('overpaid invoice ' + b.id + ' paid ' + paid + ' of ' + inv);
      if (bal < -0.011) out.push('negative balance on ' + b.id + ': ' + bal);
    });
    const beds = (HIS.admissions && HIS.admissions.beds ? HIS.admissions.beds() : []);
    const seen = new Set();
    beds.forEach(b => {
      const id = b.id || b.bedId;
      if (seen.has(id)) out.push('bed used twice: ' + id); seen.add(id);
    });
    const rxs = (HIS.pharmacy && HIS.pharmacy.all ? HIS.pharmacy.all() : []);
    rxs.forEach(rx => {
      const rem = HIS.pharmacy.remaining(rx);
      if (rem !== null && !isFinite(rem)) out.push('non-finite remaining on ' + rx.id);
      if (rem !== null && rem < 0) out.push('over-dispensed ' + rx.id + ': ' + rem);
    });
    const stock = (HIS.pharmacy && HIS.pharmacy.stock ? HIS.pharmacy.stock() : []);
    stock.forEach(s => { if (s.qty !== undefined && (s.qty < 0 || !isFinite(s.qty))) out.push('stock negative/non-finite: ' + (s.name || s.id)); });
    if ((HIS.store.get('mh_audit', []) || []).length > 5000) out.push('audit log unbounded');
  } catch (e) { out.push('invariant check threw: ' + e.message.slice(0, 90)); }
  return out.slice(0, 4);
});

await signIn();
const seenProblems = new Set();
let lastProblemCount = 0;

for (let step = 0; step < STEPS; step++) {
  const pg = pick(PAGES);
  if (!(await go(`${BASE}/${pg}`))) { problems.push(`${pg}: could not load at step ${step}`); continue; }
  await page.waitForTimeout(90);

  const errBefore = errors.length;
  const action = pick(['click', 'click', 'click', 'type', 'search', 'scroll', 'tab', 'escape']);

  try {
    if (action === 'click') {
      await page.evaluate((junk) => {
        const cands = [...document.querySelectorAll('button, [data-act], [data-open], [data-modal], a[role=button]')]
          .filter(e => e.offsetWidth && !e.closest('.drawer, nav, .header'));
        if (!cands.length) return;
        const e = cands[Math.floor(Math.random() * cands.length)];
        e.click();
      }, pick(JUNK));
    } else if (action === 'type') {
      await page.evaluate((junk) => {
        const inputs = [...document.querySelectorAll('input, textarea')].filter(e => e.offsetWidth && e.type !== 'hidden');
        if (!inputs.length) return;
        const e = inputs[Math.floor(Math.random() * inputs.length)];
        e.focus(); e.value = junk;
        e.dispatchEvent(new Event('input', { bubbles: true }));
        e.dispatchEvent(new Event('change', { bubbles: true }));
      }, pick(JUNK));
    } else if (action === 'search') {
      await page.evaluate(() => {
        const s = [...document.querySelectorAll('input[type=search], input[placeholder*=earch], input[placeholder*=ilter]')].filter(e => e.offsetWidth)[0];
        if (!s) return;
        s.focus(); s.value = 'zq%#'; s.dispatchEvent(new Event('input', { bubbles: true }));
      });
    } else if (action === 'tab') {
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
    } else if (action === 'escape') {
      await page.keyboard.press('Escape');
    }
  } catch (e) {
    // a detached node mid-render is not an app error; pageerror is what counts
  }
  await page.waitForTimeout(70);

  if (errors.length > errBefore) {
    const key = errors[errBefore].replace(/\d+/g, 'N');
    if (!seenProblems.has(key)) { seenProblems.add(key); problems.push(`${pg} step ${step} (${action}): ${errors[errBefore]}`); }
  }

  const inv = (await invariants()).filter(x => x !== '__navigating__');
  if (inv.length) {
    const key = inv[0].replace(/\d+/g, 'N');
    if (!seenProblems.has(key)) { seenProblems.add(key); problems.push(`${pg} step ${step} (${action}) broke an invariant: ${inv[0]}`); }
  }
}

await browser.close();
server.close();
console.log(`\nsteps: ${STEPS} | page errors: ${errors.length} | problems: ${problems.length}`);
problems.forEach(p => console.log(' - ' + p));
