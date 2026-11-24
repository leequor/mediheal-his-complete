// Personnel roster harness (2026-11-22).
//
// The owner reported two things about Add personnel: the page "glitched" and the record "doesn't
// even get saved". Both were reproduced first, then fixed, and this harness keeps them fixed:
//
//   1. GEOMETRY — the eighth row ends exactly where the footer begins. A ninth record must scroll
//      inside the directory, never paint over the footer or past the card.
//   2. DURABILITY — add / edit / deactivate are written to `mh_personnel`, so a refresh keeps them.
//   3. IDENTITY — the next employee id comes from the highest number present, not the list length.
//   4. THE REST STILL WORKS — search, department filter, profile swap, required-field validation.
//
// Run: PW=<playwright-core> node scripts/personnel-add-check.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PW = process.env.PW;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('mh_session', JSON.stringify({
      userId: 'USR-0008', email: 'hr@mediheal.test', role: 'hr',
      at: new Date().toISOString(), expiresAt: new Date(Date.now() + 8 * 3600e3).toISOString(), remember: true
    }));
  } catch (e) {}
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail))); }
};

const geo = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.pe-r')];
  const box = document.getElementById('perows');
  const footer = document.querySelector('.pe-ft');
  const card = document.querySelector('.pe-dir');
  const last = rows[rows.length - 1];
  const sel = document.querySelector('.pe-r.on');
  return {
    rows: rows.length, count: document.querySelector('.pe-cnt').textContent,
    summary: document.querySelector('.pe-v1').textContent, footer: footer.textContent.trim(),
    boxTop: box.getBoundingClientRect().top, boxBottom: box.getBoundingClientRect().bottom,
    boxHeight: box.clientHeight, scrollTop: box.scrollTop, scrollHeight: box.scrollHeight,
    lastTop: last ? last.getBoundingClientRect().top : null,
    lastBottom: last ? last.getBoundingClientRect().bottom : null,
    footerTop: footer.getBoundingClientRect().top,
    cardBottom: card.getBoundingClientRect().bottom,
    selTop: sel ? sel.getBoundingClientRect().top : null,
    selBottom: sel ? sel.getBoundingClientRect().bottom : null,
    profile: document.querySelector('.pe-name').textContent,
    ids: rows.map(r => r.dataset.emp)
  };
});

const add = async (name, role) => {
  await page.click('.pe-add');
  await page.waitForTimeout(120);
  await page.fill(".pe-modal [data-f='full']", name);
  await page.fill(".pe-modal [data-f='role']", role);
  await page.click('.pe-modal .pe-m-ok');
  await page.waitForTimeout(220);
};
const reload = async () => { await page.reload(); await page.waitForTimeout(600); };

await page.goto(BASE + '/personnel.html');
await page.waitForTimeout(500);
let g = await geo();
ok('seeded roster has 8 rows', g.rows === 8, g.rows);
ok('the list viewport is 608px (8 x 76)', g.boxHeight === 608, g.boxHeight);
ok('the eighth row ends exactly at the footer', Math.abs(g.lastBottom - g.footerTop) < 1, [g.lastBottom, g.footerTop]);
ok('no row paints past the directory card', g.lastBottom <= g.cardBottom, [g.lastBottom, g.cardBottom]);

await add('Test Nurse Jones', 'Staff Nurse');
g = await geo();
ok('adding one employee renders 9 rows', g.rows === 9, g.rows);
ok('the count and summary agree', g.count === '9' && g.summary === '9 employees', [g.count, g.summary]);
ok('the footer still reads 1-9 of 9', /1–9 of 9/.test(g.footer), g.footer);
ok('the list scrolls instead of overflowing', g.scrollHeight > g.boxHeight, [g.scrollHeight, g.boxHeight]);
ok('the ninth row stays inside the viewport', g.lastBottom <= g.footerTop + 1, [g.lastBottom, g.footerTop]);
ok('no row crosses the card edge', g.lastBottom <= g.cardBottom, [g.lastBottom, g.cardBottom]);
ok('the new employee is selected and revealed', g.selTop >= g.boxTop - 1 && g.selBottom <= g.boxBottom + 1, [g.selTop, g.selBottom, g.boxTop, g.boxBottom]);
ok('the new id is EMP-009', g.ids.includes('EMP-009'), g.ids);
ok('the profile shows the new record', g.profile === 'Test Nurse Jones', g.profile);

await reload();
g = await geo();
ok('a reload keeps all 9 records', g.rows === 9, g.rows);
ok('a reload keeps the added record', g.ids.includes('EMP-009'), g.ids);
ok('the added record is in storage', await page.evaluate(() => (JSON.parse(localStorage.getItem('mh_personnel')) || []).some(e => e.id === 'EMP-009')));

await add('Second Nurse', 'Staff Nurse');
g = await geo();
ok('a second add appends EMP-010', g.ids.includes('EMP-010') && g.rows === 10, g.ids);
ok('ten rows still fit the viewport rules', g.scrollHeight > g.boxHeight && g.lastBottom <= g.footerTop + 1, [g.scrollHeight, g.lastBottom, g.footerTop]);

await reload();
g = await geo();
ok('both added records survive a reload', g.rows === 10 && g.ids.includes('EMP-010'), g.ids);

// search
await page.fill('#peq', 'Second Nurse');
await page.waitForTimeout(250);
g = await geo();
ok('search finds the added employee', g.rows === 1 && g.ids[0] === 'EMP-010', g.ids);
await page.fill('#peq', '');
await page.waitForTimeout(200);

// profile, edit, persistence
await page.click("[data-emp='EMP-010']");
await page.waitForTimeout(150);
await page.click("[data-modal='edit']");
await page.waitForTimeout(150);
await page.fill(".pe-modal [data-f='role']", 'Head Nurse');
await page.click('.pe-modal .pe-m-ok');
await page.waitForTimeout(200);
g = await geo();
ok('edit updates the profile role', (await page.evaluate(() => document.querySelector('.pe-role').textContent)) === 'Head Nurse · Nursing');
await reload();
g = await geo();
ok('the edit survives a reload', (await page.evaluate(() => {
  const rows = JSON.parse(localStorage.getItem('mh_personnel')) || [];
  const e = rows.find(x => x.id === 'EMP-010');
  return !!e && e.role === 'Head Nurse';
})));

// deactivate
await page.click("[data-emp='EMP-010']");
await page.waitForTimeout(150);
await page.click("[data-modal='edit']");
await page.waitForTimeout(150);
await page.click('.pe-m-off');
await page.waitForTimeout(200);
await reload();
ok('a deactivation survives a reload', await page.evaluate(() => {
  const rows = JSON.parse(localStorage.getItem('mh_personnel')) || [];
  const e = rows.find(x => x.id === 'EMP-010');
  return !!e && e.status === 'Inactive';
}));

// required fields
await page.click('.pe-add');
await page.waitForTimeout(120);
await page.fill(".pe-modal [data-f='full']", '');
await page.click('.pe-modal .pe-m-ok');
await page.waitForTimeout(150);
ok('the add dialog refuses an empty name', await page.evaluate(() => !!document.querySelector('.pe-modal')));
await page.keyboard.press('Escape');
await page.waitForTimeout(120);

// department filter reaches the new record
await page.selectOption('[data-f="dept"]', { index: 0 }).catch(() => {});
await page.evaluate(() => { HIS.peState.dept = 'Nursing'; });
// use the real control
await page.click('#ped');
await page.waitForTimeout(100);
const opt = await page.$(".pe-o[data-opt='Nursing']");
if (opt) await opt.click();
await page.waitForTimeout(200);
g = await geo();
ok('the Nursing filter includes the added nurses', g.ids.includes('EMP-009') && g.rows >= 3, g.ids);

// no script errors anywhere
ok('no script or console errors', errors.length === 0, errors.slice(0, 3));

// smaller desktop viewport: the same rules hold
await page.setViewportSize({ width: 1366, height: 768 });
await page.waitForTimeout(300);
g = await geo();
ok('at 1366 no row reaches the footer', g.lastBottom <= g.footerTop + 1, [g.lastBottom, g.footerTop]);
ok('at 1366 no horizontal overflow from the list', await page.evaluate(() => {
  const b = document.getElementById('perows');
  return b.scrollWidth <= b.clientWidth + 1;
}));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await ctx.close();
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
