// Role × page matrix: every account on every page, then the same pages driven through their tabs,
// sort headers, filter selects and search boxes. This is the check that catches "works for the admin
// but throws for the nurse".
//
//   PW=... node scripts/matrix-check.mjs

import { startServer, openBrowser } from './_harness.mjs';

const PAGES = ['dashboard.html', 'registration.html', 'registration-form.html', 'outpatient-form.html',
  'appointments.html', 'appointment-form.html', 'appointment-confirmed.html', 'profile.html',
  'departments.html', 'billing.html', 'charges.html', 'claims.html', 'laboratory.html', 'pharmacy.html',
  'treatment.html', 'nursing.html', 'consultation.html', 'admissions.html', 'personnel.html',
  'payroll.html', 'attendance.html', 'reports.html', 'accounts.html', 'settings.html', 'audit.html',
  'staff.html', 'portal.html', 'index.html'];
const ROLES = ['superadmin', 'registration', 'doctor', 'nurse', 'pharmacist', 'lab', 'finance', 'hr', 'depthead', 'auditor', 'patient'];
const PAGES_ALIAS = { 'staff.html': 'personnel.html' };   // staff.html is an intentional redirect stub

const { server, base } = await startServer(8893);
const { browser } = await openBrowser();

let pass = 0;
const problems = [];
const note = (scope, what) => problems.push(`${scope} :: ${what}`);

const JUNK = /(^|\s)(undefined|NaN|\[object Object\])(\s|$)/;

const inspect = (page, scope) => page.evaluate(() => {
  const bodyText = document.body.innerText || '';
  const cands = [...document.querySelectorAll('main, .page, .wrap, .stage, [class$=-body], .kit-main')].filter(e => e.offsetWidth);
  return {
    junk: /(^|\s)(undefined|NaN|\[object Object\])(\s|$)/.test(bodyText),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    mainH: cands.length ? Math.max(...cands.map(e => e.getBoundingClientRect().height)) : document.body.getBoundingClientRect().height,
    url: location.pathname.split('/').pop(),
    signedOut: !!(document.querySelector('#sif') || document.querySelector('.si-card')),
  };
}).then(r => {
  if (r.junk) note(scope, 'visible undefined/NaN/[object Object]');
  if (r.overflow > 2) note(scope, `horizontal overflow at 1440: ${r.overflow}px`);
  if (!r.signedOut && r.mainH < 220 && r.url !== 'index.html') note(scope, `main region nearly empty (${Math.round(r.mainH)}px)`);
  return r;
});

for (const role of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 130)));

  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  const okSignIn = await page.evaluate((r) => {
    const acc = HIS.accounts.all().find(a => a.role === r && a.active !== false);
    return acc ? HIS.auth.attempt(acc.email, 'MediHeal2026!', true).ok : false;
  }, role);
  if (!okSignIn) { note(role, 'cannot sign in'); await ctx.close(); continue; }
  const home = await page.evaluate((r) => (HIS.rbac.ROLES[r] || {}).home || 'dashboard', role);

  for (const pg of PAGES) {
    const before = errors.length;
    await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' }).catch(() => note(`${role}/${pg}`, 'navigation failed'));
    await page.waitForTimeout(150);
    const r = await inspect(page, `${role}/${pg}`);
    if (errors.length > before) note(`${role}/${pg}`, 'error: ' + errors[before]);

    const landed = PAGES_ALIAS[pg] || pg;
    if (r.url !== landed && r.url !== pg) {
      const expected = r.url === home + '.html' || r.url === 'portal.html' || r.url === 'index.html';
      if (!expected) note(`${role}/${pg}`, `unexpected redirect to ${r.url} (home is ${home}.html)`);
      continue;                                  // a guarded page has nothing to interact with
    }
    pass++;

    // interactions on a page this role may open
    const errBefore = errors.length;
    const tabs = await page.evaluate(() => [...document.querySelectorAll('[role=tab], [data-tab], .seg button, [class*=seg] button')].filter(e => e.offsetWidth).length);
    for (let i = 0; i < Math.min(tabs, 5); i++) {
      await page.evaluate((idx) => {
        const list = [...document.querySelectorAll('[role=tab], [data-tab], .seg button, [class*=seg] button')].filter(e => e.offsetWidth);
        if (list[idx]) list[idx].click();
      }, i);
      await page.waitForTimeout(90);
    }
    const ths = await page.evaluate(() => [...document.querySelectorAll('th')].filter(e => /sort|aria-sort/.test(e.outerHTML)).length);
    for (let i = 0; i < Math.min(ths, 5); i++) {
      await page.evaluate((idx) => {
        const list = [...document.querySelectorAll('th')].filter(e => /sort|aria-sort/.test(e.outerHTML));
        if (list[idx]) list[idx].click();
      }, i);
      await page.waitForTimeout(80);
    }
    const selects = await page.evaluate(() => [...document.querySelectorAll('select')].filter(e => e.offsetWidth).length);
    for (let i = 0; i < Math.min(selects, 4); i++) {
      await page.evaluate((idx) => {
        const list = [...document.querySelectorAll('select')].filter(e => e.offsetWidth);
        const s = list[idx]; if (!s || s.options.length < 2) return;
        s.selectedIndex = (s.selectedIndex + 1) % s.options.length;
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }, i);
      await page.waitForTimeout(80);
    }
    for (let i = 0; i < 2; i++) {
      await page.evaluate((idx) => {
        const list = [...document.querySelectorAll('input[type=search], input[placeholder*=earch], input[placeholder*=ilter]')].filter(e => e.offsetWidth);
        const s = list[idx]; if (!s) return;
        s.focus(); s.value = idx ? 'zq#%' : '   ';
        s.dispatchEvent(new Event('input', { bubbles: true }));
      }, i);
      await page.waitForTimeout(90);
      await inspect(page, `${role}/${pg} while interacting`);
    }
    if (errors.length > errBefore) note(`${role}/${pg}`, `interaction threw: ${errors[errBefore]}`);

    const reloadBefore = errors.length;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(140);
    if (errors.length > reloadBefore) note(`${role}/${pg}`, `reload after interaction threw: ${errors[reloadBefore]}`);
    else await inspect(page, `${role}/${pg} reloaded`);
  }
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} role/page pairs reachable | ${problems.length} problems`);
[...new Set(problems)].forEach(p => console.log(' - ' + p));
process.exitCode = problems.length ? 1 : 0;
