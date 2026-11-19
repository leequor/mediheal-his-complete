// Verifies the deployed website, not the local copy: real HTTPS requests, real rendering, real
// navigation. Run against https://leequor.github.io/mediheal-his-complete/ after a deployment.
//
// Run: PW=<playwright-core> node scripts/deployed-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PW = process.env.PW;
const BASE = process.env.SITE || 'https://leequor.github.io/mediheal-his-complete/';
const DEMO = 'MediHeal2026!';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; failures.push(name + (detail !== undefined ? '  [' + detail + ']' : '')); console.log('FAIL ' + name + (detail !== undefined ? '  [' + detail + ']' : '')); }
}

const mod = await import(pathToFileURL(PW).href);
const browser = await (mod.chromium || mod.default.chromium).launch({ channel: 'chrome' });

// ---- 1. the shell of the site -------------------------------------------------------------------
console.log('\n--- 1. the published site loads ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 768 } });
  const page = await ctx.newPage();
  const bad = [], errors = [];
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)));

  const resp = await page.goto(BASE, { waitUntil: 'networkidle' });
  ok('the root responds 200', resp && resp.status() === 200, resp && resp.status());
  ok('no request failed while loading', bad.length === 0, bad.slice(0, 3).join(' | '));
  ok('no script error on the sign-in page', errors.length === 0, errors[0]);

  const look = await page.evaluate(() => ({
    title: document.title,
    hasForm: !!document.getElementById('siBtn'),
    font: getComputedStyle(document.body).fontFamily,
    css: [...document.styleSheets].length,
    logo: (() => { const i = document.querySelector('img'); return i ? i.naturalWidth : 0; })()
  }));
  ok('the sign-in form is rendered', look.hasForm === true, look.hasForm);
  ok('the page title is the product name', /MediHeal/.test(look.title), look.title);
  ok('stylesheets applied (font is Inter)', /Inter/.test(look.font), look.font);
  ok('the logo image actually loaded', look.logo > 0, look.logo);
  await ctx.close();
}

// ---- 2. staff sign-in and a dashboard -----------------------------------------------------------
console.log('\n--- 2. staff sign-in ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 768 } });
  const page = await ctx.newPage();
  const bad = [], errors = [];
  page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url()); });
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#sie', 'hr@mediheal.test');
  await page.fill('#sip', DEMO);
  await page.click('#siBtn');
  await page.waitForSelector('#profile .nm', { timeout: 15000 });
  const home = await page.evaluate(() => HIS.rbac.ROLES[HIS.auth.account().role].home);
  ok('sign-in reaches the role\'s own home', page.url().endsWith(home + '.html'), page.url() + ' expected ' + home);
  const who = await page.evaluate(() => ({
    name: document.querySelector('#profile .nm').textContent.trim(),
    ini: document.querySelector('#profile .av-d').textContent.trim(),
    nav: document.querySelectorAll('nav a').length
  }));
  ok('the header names the account', who.name === 'Carmela Dizon', who.name);
  ok('the avatar shows that account\'s initials', who.ini === 'CD', who.ini);
  ok('the shell renders its navigation', who.nav >= 4, who.nav);
  await page.goto(BASE + 'dashboard.html', { waitUntil: 'networkidle' });
  const cards = await page.evaluate(() => document.querySelectorAll('.kpi').length);
  ok('the dashboard renders its four cards', cards === 4, cards);
  ok('no failed request on the dashboard', bad.length === 0, bad.slice(0, 2).join(' | '));
  ok('no script error on the dashboard', errors.length === 0, errors[0]);
  await ctx.close();
}

// ---- 3. profile and notifications ---------------------------------------------------------------
console.log('\n--- 3. profile menu and notification deep link ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 768 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#sie', 'laboratory@mediheal.test');
  await page.fill('#sip', DEMO);
  await page.click('#siBtn');
  await page.waitForSelector('#profile .nm', { timeout: 15000 });

  await page.click('#profile');
  await page.waitForTimeout(400);
  const menu = await page.evaluate(() => {
    const p = document.querySelector('.am-m');
    return { open: !!p, name: p && p.querySelector('.am-nm').textContent.trim(), rows: p ? p.querySelectorAll('.am-r').length : 0 };
  });
  ok('the profile menu opens with the account', menu.open && menu.name === 'Daniel Cruz', menu.name);
  ok('the menu lists the account rows', menu.rows >= 3, menu.rows);
  await page.keyboard.press('Escape');

  await page.click('.bell');
  await page.waitForTimeout(300);
  const panel = await page.evaluate(() => ({
    open: document.querySelector('.nf-p').classList.contains('on'),
    titles: [...document.querySelectorAll('.nf-rt')].map(n => n.textContent)
  }));
  ok('the notification panel opens', panel.open === true, panel.open);
  ok('the technologist sees laboratory work', panel.titles.some(t => /critical|validation|specimen/i.test(t)), panel.titles.join(' | '));

  await page.click('.nf-r');
  await page.waitForTimeout(1800);
  const landed = await page.evaluate(() => ({
    page: location.pathname.split('/').pop(),
    hit: !!document.querySelector('.dl-hit'),
    text: (document.querySelector('.dl-hit') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim().slice(0, 50)
  }));
  ok('the notification opens the laboratory page', landed.page === 'laboratory.html', landed.page);
  ok('the record is located and highlighted', landed.hit === true, landed.hit);
  ok('the highlight names the record', /LAB-|Acknowledge/.test(landed.text), landed.text);
  await ctx.close();
}

// ---- 4. patient portal and the route between the two --------------------------------------------
console.log('\n--- 4. patient portal ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 768 } });
  const page = await ctx.newPage();
  await page.goto(BASE + 'portal.html#signin', { waitUntil: 'networkidle' });
  const staffLink = await page.evaluate(() => {
    const a = document.querySelector('#signin a[href="index.html"]');
    return a ? a.getAttribute('href') : null;
  });
  ok('the patient page offers staff sign-in', staffLink === 'index.html', staffLink);

  await page.fill('#pt-si-email', 'patient@mediheal.test');
  await page.fill('#pt-signin input[type=password]', DEMO);
  await page.evaluate(() => document.querySelector('#pt-signin').requestSubmit());
  await page.waitForTimeout(1800);
  const portal = await page.evaluate(() => ({
    hash: location.hash,
    av: (document.querySelector('#pt-av') || {}).textContent,
    text: document.body.innerText.slice(0, 200)
  }));
  ok('the patient reaches their own portal', portal.hash === '#home', portal.hash);
  ok('the portal shows the patient, not a staff profile', /Isabel/.test(portal.text), portal.text.replace(/\n/g, ' ').slice(0, 70));
  await ctx.close();
}

// ---- 5. direct navigation and refresh -----------------------------------------------------------
console.log('\n--- 5. direct page loads and refresh ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('#sie', 'superadmin@mediheal.test');
  await page.fill('#sip', DEMO);
  await page.click('#siBtn');
  await page.waitForSelector('#profile .nm', { timeout: 15000 });

  const pages = ['appointments', 'laboratory', 'pharmacy', 'billing', 'claims', 'admissions', 'payroll', 'departments', 'reports', 'settings', 'accounts', 'audit'];
  const broken = [];
  for (const p of pages) {
    const r = await page.goto(BASE + p + '.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(250);
    const hasShell = await page.evaluate(() => !!document.querySelector('#profile .nm'));
    if (!r || r.status() !== 200 || !hasShell) broken.push(p + ':' + (r && r.status()) + ':' + hasShell);
  }
  ok('every page loads directly by URL', broken.length === 0, broken.join(' | '));

  await page.goto(BASE + 'appointments.html', { waitUntil: 'networkidle' });
  const before = await page.evaluate(() => document.querySelectorAll('.a-row').length);
  await page.reload({ waitUntil: 'networkidle' });
  const after = await page.evaluate(() => document.querySelectorAll('.a-row').length);
  ok('a refresh keeps the session', after > 0, after);
  ok('a refresh does not duplicate rows', after === before, before + ' -> ' + after);

  const deep = await page.goto(BASE + 'laboratory.html?focus=LAB-0004', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const dl = await page.evaluate(() => ({ hit: !!document.querySelector('.dl-hit'), search: location.search }));
  ok('a deep link resolves after a direct load', deep.status() === 200 && dl.hit === true, dl.hit);
  ok('the deep-link parameter is consumed', dl.search === '', dl.search);
  await ctx.close();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f)); }
await browser.close();
process.exit(fail ? 1 : 0);
