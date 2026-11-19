// Nested modal stacking, tested the way a person uses it.
//
// The previous attempt at this passed while the form was invisible, because the test called
// element.click() from script — which ignores stacking entirely. Every interaction here is a real
// Playwright click, which fails if anything covers the target, and every step also hit-tests the
// centre of the dialog to prove which element a pointer would actually reach.
//
// Run: PW=<playwright-core> node scripts/claims-modal-stack-check.mjs
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

async function fresh(email, w, h) {
  const ctx = await browser.newContext({ viewport: { width: w || 1440, height: h || 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.evaluate(([em, pw]) => HIS.auth.attempt(em, pw, true), [email, DEMO]);
  await page.goto(BASE + '/claims.html', { waitUntil: 'load' });
  await page.waitForTimeout(450);
  return { ctx, page, errors };
}

// Open a claim by clicking its Open button for real.
async function openClaim(page, id) {
  await page.click(`[data-open="${id}"]`);
  await page.waitForSelector('.cl-card', { timeout: 5000 });
  await page.waitForTimeout(200);
}

// Which element would a pointer at the centre of the top dialog actually reach?
async function pointerTarget(page) {
  return page.evaluate(() => {
    const stack = HIS.kit.modalStack.all();
    const top = stack[stack.length - 1];
    if (!top) return { none: true };
    const r = top.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      depth: stack.length,
      topClass: top.className,
      topZ: +getComputedStyle(top).zIndex,
      parentZ: stack.length > 1 ? +getComputedStyle(stack[stack.length - 2]).zIndex : null,
      hitInsideTop: top.contains(hit),
      hitTag: hit ? hit.tagName : null
    };
  });
}

const claimState = (page, id) => page.evaluate(cid => {
  const c = HIS.claims.get(cid);
  const bill = HIS.billing.bills.find(b => b.id === c.invoiceId);
  return {
    status: c.status,
    approved: c.approvedAmount || 0,
    share: c.patientShare || 0,
    notes: (c.notes || []).length,
    history: c.history.length,
    paid: bill ? HIS.ledger.paidOf(bill) : null,
    covered: bill ? HIS.ledger.coveredOf(bill) : null
  };
}, id);

// =================================================================================================
// 1. Every action opens a form that is genuinely on top and usable
// =================================================================================================
console.log('\n--- 1. every claim action opens a usable form on top ---');
for (const [action, label, fields] of [
  ['approve', 'Record approval', [['approvedAmount', '20000']]],
  // partial approval needs an amount AND a reason
  ['partial', 'Record partial approval', [['approvedAmount', '12000'], ['reason', 'Two of five documents were not received.']]],
  ['deny', 'Record denial', [['reason', 'Not covered by the member policy.']]],
  ['request-info', 'Additional information required', [['reason', 'Please send the operative record.']]]
]) {
  const { ctx, page, errors } = await fresh('finance@mediheal.test');
  await openClaim(page, 'CLM-2026-0003');
  const before = await claimState(page, 'CLM-2026-0003');

  // a real click — this fails if the button is covered
  await page.click(`.cl-card [data-act="${action}"]`);
  await page.waitForSelector('.modal-bg', { timeout: 4000 });
  await page.waitForTimeout(200);

  const p = await pointerTarget(page);
  ok(action + ': the form is above the claim dialog', p.topZ > p.parentZ, p.topZ + ' vs ' + p.parentZ);
  ok(action + ': a pointer at the form centre lands inside it', p.hitInsideTop === true, p.hitTag);
  ok(action + ': the stack is two deep', p.depth === 2, p.depth);

  // the fields must accept typing, which also proves they are not covered
  for (const [field, value] of fields) {
    await page.click(`.modal-bg [name="${field}"]`);
    await page.fill(`.modal-bg [name="${field}"]`, value);
    const typed = await page.inputValue(`.modal-bg [name="${field}"]`);
    ok(action + ': the ' + field + ' field accepts input', typed === value, typed);
  }

  // submit for real
  await page.click('.modal-bg .mbtn:not(.out)');
  await page.waitForTimeout(450);

  const after = await claimState(page, 'CLM-2026-0003');
  ok(action + ': the form closed on success', await page.evaluate(() => !document.querySelector('.modal-bg')), true);
  ok(action + ': the claim moved', after.status !== before.status, before.status + ' -> ' + after.status);
  ok(action + ': the claim records the change in its history', after.history > before.history, after.history);
  ok(action + ': no cash was recorded', after.paid === before.paid, before.paid + ' -> ' + after.paid);
  ok(action + ': one dialog remains, the claim itself', await page.evaluate(() => document.querySelectorAll('.modal-bg,.ac-bg,.cl-bg').length) === 1);
  ok(action + ': no script error', errors.length === 0, errors[0]);
  await ctx.close();
}

// =================================================================================================
// 2. Validation keeps the form open and changes nothing
// =================================================================================================
console.log('\n--- 2. a rejected submission keeps the form open ---');
{
  const { ctx, page } = await fresh('finance@mediheal.test');
  await openClaim(page, 'CLM-2026-0003');
  const before = await claimState(page, 'CLM-2026-0003');

  await page.click('.cl-card [data-act="approve"]');
  await page.waitForSelector('.modal-bg');
  await page.fill('.modal-bg [name="approvedAmount"]', '999999999');
  await page.click('.modal-bg .mbtn:not(.out)');
  await page.waitForTimeout(400);

  const open = await page.evaluate(() => !!document.querySelector('.modal-bg'));
  const err = await page.evaluate(() => (document.querySelector('.modal-err') || {}).textContent || '');
  const kept = await page.inputValue('.modal-bg [name="approvedAmount"]').catch(() => null);
  const after = await claimState(page, 'CLM-2026-0003');

  ok('an invalid amount leaves the form open', open === true, open);
  ok('the reason is shown inside the form', err.length > 0, err);
  ok('what was typed is kept', kept === '999999999', kept);
  ok('the claim did not move', after.status === before.status && after.history === before.history, after.status);
  ok('the claim dialog is still underneath', await page.evaluate(() => !!document.querySelector('.cl-card')), true);
  ok('a pointer still reaches the form', (await pointerTarget(page)).hitInsideTop === true);

  // correct it and it goes through
  await page.fill('.modal-bg [name="approvedAmount"]', '20000');
  await page.click('.modal-bg .mbtn:not(.out)');
  await page.waitForTimeout(450);
  const fixed = await claimState(page, 'CLM-2026-0003');
  ok('correcting the value lets it through', fixed.status === 'approved', fixed.status);
  await ctx.close();
}

// =================================================================================================
// 3. Cancel, Escape and backdrop close only the child
// =================================================================================================
console.log('\n--- 3. closing the child leaves the parent intact ---');
{
  const { ctx, page } = await fresh('finance@mediheal.test');
  await openClaim(page, 'CLM-2026-0003');
  const before = await claimState(page, 'CLM-2026-0003');

  // Cancel button
  await page.click('.cl-card [data-act="deny"]');
  await page.waitForSelector('.modal-bg');
  await page.click('.modal-bg .mbtn.out');
  await page.waitForTimeout(250);
  ok('Cancel removes only the form', await page.evaluate(() => !document.querySelector('.modal-bg')), true);
  ok('the claim dialog is still open after Cancel', await page.evaluate(() => !!document.querySelector('.cl-card')), true);
  ok('Cancel changed nothing', JSON.stringify(await claimState(page, 'CLM-2026-0003')) === JSON.stringify(before), 'state');

  // Escape
  await page.click('.cl-card [data-act="deny"]');
  await page.waitForSelector('.modal-bg');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  ok('Escape closes the form', await page.evaluate(() => !document.querySelector('.modal-bg')), true);
  ok('Escape leaves the claim dialog open', await page.evaluate(() => !!document.querySelector('.cl-card')), true);

  // a second Escape closes the claim dialog
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  ok('a second Escape closes the claim dialog', await page.evaluate(() => !document.querySelector('.cl-card')), true);
  ok('no overlay is left behind', await page.evaluate(() => document.querySelectorAll('.modal-bg,.ac-bg,.cl-bg').length) === 0, true);
  ok('the page scrolls again', await page.evaluate(() => !document.body.classList.contains('modal-open')), true);
  ok('the stack is empty', await page.evaluate(() => HIS.kit.modalStack.depth()) === 0, true);

  // the page still works
  await page.click('[data-open="CLM-2026-0003"]');
  await page.waitForTimeout(300);
  ok('the register still opens claims after all that', await page.evaluate(() => !!document.querySelector('.cl-card')), true);
  await ctx.close();
}

// =================================================================================================
// 4. Add note keeps the claim and does not move it
// =================================================================================================
console.log('\n--- 4. add note ---');
{
  const { ctx, page } = await fresh('finance@mediheal.test');
  await openClaim(page, 'CLM-2026-0003');
  const before = await claimState(page, 'CLM-2026-0003');

  await page.click('.cl-card [data-note]');
  await page.waitForSelector('.modal-bg');
  ok('the note form is on top', (await pointerTarget(page)).hitInsideTop === true);

  // empty note is refused
  await page.click('.modal-bg .mbtn:not(.out)');
  await page.waitForTimeout(300);
  ok('an empty note is refused', await page.evaluate(() => !!document.querySelector('.modal-bg')), true);

  await page.fill('.modal-bg [name="text"]', 'QA — reviewed against the submitted statement.');
  await page.click('.modal-bg .mbtn:not(.out)');
  await page.waitForTimeout(450);

  const after = await claimState(page, 'CLM-2026-0003');
  ok('the note is recorded', after.notes === before.notes + 1, before.notes + ' -> ' + after.notes);
  ok('the note did not move the claim', after.status === before.status, after.status);
  ok('the note did not move money', after.covered === before.covered, before.covered + ' -> ' + after.covered);
  ok('the claim dialog is still open with the note', await page.evaluate(() => !!document.querySelector('.cl-card')), true);
  ok('the note is visible in the dialog', await page.evaluate(() => /QA — reviewed against/.test(document.querySelector('.cl-card').textContent)), true);
  await ctx.close();
}

// =================================================================================================
// 5. The same stacking holds at every required viewport
// =================================================================================================
console.log('\n--- 5. all three viewports ---');
for (const [w, h] of [[1440, 900], [1366, 768], [1280, 800]]) {
  const { ctx, page } = await fresh('finance@mediheal.test', w, h);
  await openClaim(page, 'CLM-2026-0003');
  await page.click('.cl-card [data-act="partial"]');
  await page.waitForSelector('.modal-bg');
  await page.waitForTimeout(200);
  const p = await pointerTarget(page);
  const fits = await page.evaluate(() => {
    const m = document.querySelector('.modal-bg .modal').getBoundingClientRect();
    return m.top >= 0 && m.bottom <= innerHeight && m.left >= 0 && m.right <= innerWidth;
  });
  ok('@' + w + ': the form is above the claim dialog', p.topZ > p.parentZ, p.topZ + ' vs ' + p.parentZ);
  ok('@' + w + ': the form is inside the window', fits === true, fits);
  ok('@' + w + ': a pointer reaches the form', p.hitInsideTop === true);
  await ctx.close();
}

// =================================================================================================
// 6. Other nested dialogs use the same stack
// =================================================================================================
console.log('\n--- 6. the stack covers the rest of the app ---');
{
  // Pharmacy: the dispense form opens from a row inside a page-level dialog chain.
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.evaluate(() => HIS.auth.attempt('pharmacy@mediheal.test', 'MediHeal2026!', true));
  await page.goto(BASE + '/pharmacy.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const row = await page.evaluate(() => {
    const b = document.querySelector('[data-act="dispense"]');
    return b ? b.closest('.ad-tr').textContent.match(/RX-\d+/)[0] : null;
  });
  await page.click(`[data-act="dispense"]`);
  await page.waitForTimeout(350);
  const p = await page.evaluate(() => {
    const top = HIS.kit.modalStack.top();
    if (!top) return { none: true };
    const r = top.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { depth: HIS.kit.modalStack.depth(), inside: top.contains(hit), z: getComputedStyle(top).zIndex };
  });
  ok('pharmacy: the dispense form opens on the managed layer', p.depth >= 1 && p.inside === true, JSON.stringify(p));
  ok('pharmacy: the layer is in the modal band', +p.z >= 4000, p.z);
  await ctx.close();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f)); }
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
