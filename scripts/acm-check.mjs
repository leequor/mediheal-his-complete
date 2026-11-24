// The .ac-m shell: a <form role=dialog aria-modal> that the earlier dialog passes never selected,
// because it ends in "-m" rather than "-modal". 25 dialogs across 20 pages live in it, and it differs
// from every other shell in one important way: it validates with the browser (required attributes)
// rather than with #mdErr, so a refusal is spoken by the browser and not by the app.
//
//   PW=... node scripts/acm-check.mjs

import { startServer, openBrowser, signIn } from './_harness.mjs';
const { server, base } = await startServer(8921);
const { browser } = await openBrowser();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 100)));
await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(250); await signIn(page);
const PAGES = ['registration.html', 'appointments.html', 'profile.html', 'departments.html', 'billing.html', 'charges.html', 'claims.html', 'laboratory.html', 'pharmacy.html', 'treatment.html', 'nursing.html', 'consultation.html', 'admissions.html', 'personnel.html', 'payroll.html', 'attendance.html', 'reports.html', 'accounts.html', 'settings.html', 'audit.html'];
let checks = 0; const problems = [];
for (const pg of PAGES) {
  await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);
  const labels = await page.evaluate(() => [...new Set([...document.querySelectorAll('button, [data-open]')]
    .filter(e => e.offsetWidth && !e.closest('nav,.header,.drawer'))
    .map(e => (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26)).filter(Boolean))].slice(0, 9));
  for (const label of labels) {
    await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(180);
    const opened = await page.evaluate((l) => {
      const b = [...document.querySelectorAll('button, [data-open]')].filter(e => e.offsetWidth && !e.closest('nav,.header,.drawer'))
        .find(e => ((e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26)) === l);
      if (!b) return false; b.focus(); b.click(); return true;
    }, label);
    if (!opened) continue;
    await page.waitForTimeout(260);
    const isAcM = await page.evaluate(() => [...document.querySelectorAll('.ac-m')].filter(d => d.offsetWidth).length);
    if (!isAcM) continue;
    checks++;
    // 1. Escape closes and focus returns
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const afterEsc = await page.evaluate(() => ({
      open: [...document.querySelectorAll('.ac-m')].filter(d => d.offsetWidth).length,
      focus: (document.activeElement || {}).textContent ? document.activeElement.textContent.trim().replace(/\s+/g, ' ').slice(0, 26) : document.activeElement.tagName,
      lock: /hidden/.test(getComputedStyle(document.body).overflow),
      bg: [...document.querySelectorAll('.ac-bg')].filter(d => d.offsetWidth).length,
    }));
    if (afterEsc.open) problems.push(`${pg} "${label}": .ac-m stayed open on Escape`);
    if (afterEsc.bg) problems.push(`${pg} "${label}": backdrop .ac-bg left behind (${afterEsc.bg})`);
    if (afterEsc.lock) problems.push(`${pg} "${label}": scroll locked after Escape`);
    if (!afterEsc.open && afterEsc.focus !== label) problems.push(`${pg} "${label}": focus went to "${afterEsc.focus}"`);

    // 2. hostile submit must refuse in writing or close
    await page.goto(`${base}/${pg}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(180);
    await page.evaluate((l) => {
      const b = [...document.querySelectorAll('button, [data-open]')].filter(e => e.offsetWidth && !e.closest('nav,.header,.drawer'))
        .find(e => ((e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26)) === l);
      if (b) b.click();
    }, label);
    await page.waitForTimeout(240);
    const shape = await page.evaluate(() => {
      const d = [...document.querySelectorAll('.ac-m')].filter(x => x.offsetWidth).pop();
      return d ? { inputs: [...d.querySelectorAll('input,textarea,select')].filter(e => e.offsetWidth).length, required: d.querySelectorAll('[required]').length } : null;
    });
    const clicked = await page.evaluate(() => {
      const d = [...document.querySelectorAll('.ac-m')].filter(x => x.offsetWidth).pop();
      if (!d) return null;
      [...d.querySelectorAll('input,textarea,select')].filter(e => e.offsetWidth && !/search|filter/i.test(e.id + e.className)).forEach((e, i) => {
        if (e.tagName === 'SELECT') { if (e.options.length > 1) e.selectedIndex = 1; }
        else { e.value = ['', ' ', '-1', '1e9', '12/45/2026'][i % 5]; e.dispatchEvent(new Event('input', { bubbles: true })); }
      });
      const btn = [...d.querySelectorAll('button')].filter(b => b.offsetWidth && !/^(cancel|close|dismiss|×)$/i.test(b.textContent || '')).pop();
      if (btn) btn.click();
      return btn ? btn.textContent.trim().slice(0, 18) : '(none)';
    });
    await page.waitForTimeout(420);
    const said = await page.evaluate(() => ({
      open: [...document.querySelectorAll('.ac-m')].filter(d => d.offsetWidth).length,
      toast: (document.querySelector('#kit-toast') || {}).textContent || null,
      alert: [...document.querySelectorAll('[role=alert],.ac-err,#mdErr,.ac-m [class*=err]')].filter(e => e.offsetWidth && (e.textContent || '').trim().length > 2).map(e => e.textContent.trim().slice(0, 50)),
      err: document.querySelectorAll('.ac-m .err,.ac-m [aria-invalid=true]').length
        + [...document.querySelectorAll('.ac-m :invalid')].filter(e => e.offsetWidth && e.validationMessage).length,
    }));
    // A viewer dialog (no editable fields) has nothing to refuse. A form with a required field is
    // refused by the browser, which states the reason against the field itself.
    if (shape && shape.inputs > 0 && said.open && !said.toast && !said.alert.length && !said.err) {
      problems.push(`${pg} "${label}" -> "${clicked}": refused with no written reason`);
    }
    if (errs.length) { problems.push(`${pg} "${label}": page error ${errs[errs.length - 1]}`); errs.length = 0; }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}
console.log(`\n.ac-m dialogs: ${checks} | problems: ${problems.length}`);
[...new Set(problems)].slice(0, 15).forEach(p => console.log(' - ' + p));
await browser.close(); server.close();
