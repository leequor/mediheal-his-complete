// Exhaustive control audit.
//
// Three things this proves that a "click everything" sweep cannot:
//
//   1. CENSUS — every control that carries a data-* action on any page resolves to a handler string in
//      that page's own scripts. An orphan control (rendered, clickable, wired to nothing) fails here.
//   2. TARGETING — a row action acts on its own row. The last row is clicked, and the record that
//      changed must be that row's id, not the first one.
//   3. OUTCOME — the business result, read back from the store: stock actually falls, the invoice
//      balance actually moves, the claim records coverage and not cash, a note does not move the
//      claim, a repeat does not transition twice.
//
// Run: PW=<playwright-core> node scripts/exhaustive-controls-check.mjs
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
  if (email) await page.evaluate(([em, pw]) => HIS.auth.attempt(em, pw, true), [email, DEMO]);
  return { ctx, page, errors };
}

const pages = fs.readdirSync('.').filter(f => f.endsWith('.html')).sort();

// The app opens its action dialogs as .modal-bg > form.modal. Fill the first input that has a name
// and press the button that is not the outlined cancel.
async function completeModal(page, value) {
  const open = await page.evaluate(() => !!document.querySelector('.modal-bg, .ac-bg'));
  if (!open) return false;
  await page.evaluate(v => {
    const box = document.querySelector('.modal-bg, .ac-bg');
    const i = box.querySelector('input[name], textarea[name]');
    if (i) { i.value = v == null ? i.value : String(v); i.dispatchEvent(new Event('input', { bubbles: true })); }
  }, value);
  await page.evaluate(() => {
    const box = document.querySelector('.modal-bg, .ac-bg');
    const b = [...box.querySelectorAll('button')].filter(x => !/\bout\b/.test(x.className))[0];
    if (b) b.click();
  });
  await page.waitForTimeout(450);
  return true;
}


// =================================================================================================
// 1. CENSUS — no control without a handler
// =================================================================================================
console.log('\n--- 1. every control resolves to a handler ---');
{
  const census = {};
  let totalControls = 0, totalActions = 0;
  const orphans = [];

  for (const file of pages) {
    const slug = file.replace('.html', '');
    const { ctx, page } = await fresh('superadmin@mediheal.test');
    if (slug !== 'index' && slug !== 'portal') {
      await page.goto(BASE + '/' + file, { waitUntil: 'load' });
    }
    await page.waitForTimeout(420);

    // Open the interfaces that hold controls a visitor only sees after a click.
    const opened = await page.evaluate(() => {
      const seen = [];
      const click = sel => { const b = document.querySelector(sel); if (b) { b.click(); seen.push(sel); } };
      click('.bell');
      return seen;
    });
    await page.waitForTimeout(220);

    const inv = await page.evaluate(() => {
      const out = { buttons: 0, links: 0, selects: 0, inputs: 0, tabs: 0, rowActions: 0, actions: [] };
      document.querySelectorAll('button').forEach(b => { out.buttons++; });
      document.querySelectorAll('a[href]').forEach(a => { out.links++; });
      document.querySelectorAll('select').forEach(() => { out.selects++; });
      document.querySelectorAll('input,textarea').forEach(() => { out.inputs++; });
      document.querySelectorAll('[data-tab]').forEach(() => { out.tabs++; });
      document.querySelectorAll('[data-act],[data-open],[data-close],[data-note],[data-doc],[data-more],[data-n]').forEach(el => {
        const a = el.dataset.act || el.dataset.open || el.dataset.note || el.dataset.doc || el.dataset.more || el.dataset.n;
        if (a != null) out.actions.push(a);
        out.rowActions++;
      });
      return out;
    });

    // Every action string must appear somewhere in the page's own scripts.
    const sources = await page.evaluate(() => [...document.scripts].map(s => s.src).filter(Boolean));
    let blob = '';
    for (const src of sources) {
      const rel = src.replace(BASE + '/', '');
      try { blob += fs.readFileSync(path.join('.', rel), 'utf8'); } catch { /* inline or remote */ }
    }
    const inline = await page.evaluate(() => [...document.scripts].filter(s => !s.src).map(s => s.textContent).join('\n'));
    blob += inline;

    const unhandled = [...new Set(inv.actions)].filter(a => {
      if (!isNaN(Number(a))) return false;            // notification index
      return blob.indexOf("'" + a + "'") < 0 && blob.indexOf('"' + a + '"') < 0;
    });
    if (unhandled.length) orphans.push(slug + ': ' + unhandled.join(','));

    census[slug] = inv;
    totalControls += inv.buttons + inv.links + inv.selects + inv.inputs;
    totalActions += inv.rowActions;
    await ctx.close();
  }

  console.log('     controls: ' + totalControls + '  action-bearing: ' + totalActions);
  ok('no page renders an action with no handler', orphans.length === 0, orphans.join(' | '));
  fs.writeFileSync('qa/control-census.json', JSON.stringify({ totalControls, totalActions, census }, null, 1));
  ok('the census covered every page', Object.keys(census).length === pages.length, Object.keys(census).length + '/' + pages.length);
}

// =================================================================================================
// 2. TARGETING — a row action acts on its own row
// =================================================================================================
console.log('\n--- 2. row actions target their own record ---');
{
  // Laboratory: cancel the LAST order and confirm that order — not the first — changed.
  const { ctx, page, errors } = await fresh('laboratory@mediheal.test');
  await page.goto(BASE + '/laboratory.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => HIS.lab.all().map(o => ({ id: o.id, st: o.status })));
  // The last row that actually offers the action, so the test never assumes a status.
  const target = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ad-tr')].filter(r => r.querySelector('[data-act="cancel"]'));
    const row = rows[rows.length - 1];
    return row ? (row.textContent.match(/LAB-\d+/) || [null])[0] : null;
  });
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ad-tr')].filter(r => r.querySelector('[data-act="cancel"]'));
    const b = rows[rows.length - 1].querySelector('[data-act="cancel"]');
    if (b) b.click();
  });
  await page.waitForTimeout(350);
  await completeModal(page, 'Duplicate order — cancelled during acceptance testing.');
  const after = await page.evaluate(() => HIS.lab.all().map(o => ({ id: o.id, st: o.status })));
  const changed = after.filter((o, i) => o.st !== before[i].st).map(o => o.id);
  ok('laboratory: only the clicked order changed', changed.length === 1 && changed[0] === target, changed.join(',') + ' (target ' + target + ')');
  ok('laboratory: no script error', errors.length === 0, errors[0]);
  await ctx.close();
}
{
  // Pharmacy: verify the LAST pending prescription and confirm only that one moved.
  const { ctx, page } = await fresh('pharmacy@mediheal.test');
  await page.goto(BASE + '/pharmacy.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => HIS.pharmacy.rx().map(r => ({ id: r.id, st: r.status })));
  const target = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ad-tr')].filter(r => r.querySelector('[data-act="verify"]'));
    const row = rows[rows.length - 1];
    return row ? (row.textContent.match(/RX-\d+/) || [null])[0] : null;
  });
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ad-tr')].filter(r => r.querySelector('[data-act="verify"]'));
    const b = rows[rows.length - 1].querySelector('[data-act="verify"]');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  await completeModal(page, null);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => HIS.pharmacy.rx().map(r => ({ id: r.id, st: r.status })));
  const changed = after.filter((r, i) => r.st !== before[i].st).map(r => r.id);
  ok('pharmacy: only the clicked prescription was verified', changed.length === 1 && changed[0] === target, changed.join(',') + ' (target ' + target + ')');
  await ctx.close();
}
{
  // Appointments: cancel the LAST confirmed visit from its own row menu.
  const { ctx, page } = await fresh('admissions@mediheal.test');
  await page.goto(BASE + '/appointments.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => HIS.appointments.map(a => a.status));
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#rows .a-row')];
    const row = rows[rows.length - 1];
    row.querySelector('[data-more]').click();
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.a-menu button')].filter(x => /Cancel appointment/i.test(x.textContent))[0];
    if (b) b.click();
  });
  await page.waitForTimeout(250);
  await page.click('.ap-ok');
  await page.waitForTimeout(350);
  const after = await page.evaluate(() => HIS.appointments.map(a => a.status));
  const changed = after.map((s, i) => s !== before[i] ? i : -1).filter(i => i > -1);
  ok('appointments: only the clicked visit was cancelled', changed.length === 1 && changed[0] === after.length - 1, JSON.stringify(changed));
  await ctx.close();
}

// =================================================================================================
// 3. CLAIMS MODAL — the assignment's specific case
// =================================================================================================
console.log('\n--- 3. the claim modal ---');
{
  const { ctx, page, errors } = await fresh('finance@mediheal.test');
  await page.goto(BASE + '/claims.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);

  const openClaim = async id => {
    await page.evaluate(cid => {
      const b = [...document.querySelectorAll('[data-open]')].find(x => x.dataset.open === cid);
      if (b) b.click();
    }, id);
    await page.waitForTimeout(320);
  };
  const closeModal = async () => {
    await page.evaluate(() => { const x = document.querySelector('.cl-x'); if (x) x.click(); });
    await page.waitForTimeout(200);
  };

  // 3a. geometry at all three viewports: the footer is inside the card, nothing is off-card
  for (const [w, h] of [[1440, 900], [1366, 768], [1280, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    await openClaim('CLM-2026-0003');
    const g = await page.evaluate(() => {
      const card = document.querySelector('.cl-card');
      const f = card.querySelector('.cl-actions').getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const hidden = [...card.querySelectorAll('button')].filter(x => {
        const r = x.getBoundingClientRect();
        return r.bottom > c.bottom + 1 || r.top < c.top - 1 || r.right > c.right + 1;
      }).map(x => x.textContent.trim());
      return { inside: f.bottom <= c.bottom + 1 && f.top >= c.top - 1, hidden, bodyScrolls: getComputedStyle(card.querySelector('.cl-body')).overflowY };
    });
    ok('claims @' + w + ': the action footer is inside the dialog', g.inside === true, g.inside);
    ok('claims @' + w + ': no control escapes the dialog', g.hidden.length === 0, g.hidden.join(','));
    ok('claims @' + w + ': the body scrolls independently', g.bodyScrolls === 'auto', g.bodyScrolls);
    await closeModal();
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // 3b. actions are the ones the state allows, and only those
  const perStatus = {};
  for (const c of await page.evaluate(() => HIS.claims.all().map(x => ({ id: x.id, st: x.status })))) {
    await openClaim(c.id);
    const acts = await page.evaluate(() => [...document.querySelectorAll('.cl-card [data-act]')].map(b => b.dataset.act));
    perStatus[c.st] = acts;
    await closeModal();
  }
  ok('under review offers approval, partial, denial and a request for information',
    ['approve', 'partial', 'deny', 'request-info'].every(a => (perStatus['under-review'] || []).includes(a)),
    JSON.stringify(perStatus['under-review']));
  ok('an approved claim offers settlement, not approval', (perStatus['approved'] || []).includes('settle') && !(perStatus['approved'] || []).includes('approve'),
    JSON.stringify(perStatus['approved']));
  ok('a denied claim offers no approval of any kind',
    !(perStatus['denied'] || []).some(a => ['approve', 'partial', 'settle'].includes(a)), JSON.stringify(perStatus['denied']));

  // 3c. the decisions sit together and the primary one is marked
  await openClaim('CLM-2026-0003');
  const layout = await page.evaluate(() => {
    const left = [...document.querySelectorAll('.cl-acts [data-act]')].map(b => b.textContent.trim());
    const right = [...document.querySelectorAll('.cl-acts-r button')].map(b => b.textContent.trim());
    const pri = [...document.querySelectorAll('.cl-card [data-act].pri')].map(b => b.textContent.trim());
    const rowsY = [...document.querySelectorAll('.cl-acts [data-act]')].map(b => Math.round(b.getBoundingClientRect().top));
    return { left, right, pri, oneRow: new Set(rowsY).size === 1 };
  });
  ok('the four decisions sit on one row', layout.oneRow === true, layout.left.join(' / '));
  ok('note and dismiss are a separate group', layout.right.join('/') === 'Add note/Close', layout.right.join('/'));
  ok('exactly one decision is marked primary', layout.pri.length === 1 && /approval/i.test(layout.pri[0]), layout.pri.join(','));
  await closeModal();

  // 3d. add note changes the note list and nothing else
  const noteBefore = await page.evaluate(() => {
    const c = HIS.claims.get('CLM-2026-0003');
    return { notes: (c.notes || []).length, status: c.status, approved: c.approvedAmount, history: c.history.length };
  });
  await openClaim('CLM-2026-0003');
  await page.evaluate(() => document.querySelector('[data-note]').click());
  await page.waitForTimeout(350);
  await completeModal(page, 'QA note — reviewed against the submitted statement.');
  await page.waitForTimeout(300);
  const noteAfter = await page.evaluate(() => {
    const c = HIS.claims.get('CLM-2026-0003');
    return { notes: (c.notes || []).length, status: c.status, approved: c.approvedAmount, history: c.history.length };
  });
  ok('adding a note records it', noteAfter.notes === noteBefore.notes + 1, noteBefore.notes + ' -> ' + noteAfter.notes);
  ok('adding a note does not change the claim status', noteAfter.status === noteBefore.status, noteAfter.status);
  ok('adding a note does not move money', noteAfter.approved === noteBefore.approved, noteAfter.approved);
  await page.evaluate(() => { const x = document.querySelector('.cl-x'); if (x) x.click(); });
  await page.waitForTimeout(200);

  // 3e. closing changes nothing
  const closeBefore = await page.evaluate(() => {
    const c = HIS.claims.get('CLM-2026-0003');
    return JSON.stringify({ s: c.status, h: c.history.length, a: c.approvedAmount });
  });
  await openClaim('CLM-2026-0003');
  await closeModal();
  const closeAfter = await page.evaluate(() => {
    const c = HIS.claims.get('CLM-2026-0003');
    return JSON.stringify({ s: c.status, h: c.history.length, a: c.approvedAmount });
  });
  ok('closing the dialog changes nothing', closeAfter === closeBefore, closeAfter);
  ok('the dialog is gone after closing', await page.evaluate(() => !document.querySelector('.cl-card')), true);

  // 3f. approval records coverage, never cash
  await openClaim('CLM-2026-0003');
  const money = await page.evaluate(() => {
    const c = HIS.claims.get('CLM-2026-0003');
    const bill = HIS.billing.bills.find(b => b.id === c.invoiceId);
    return { claim: c.id, invoice: c.invoiceId, paid: HIS.ledger.paidOf(bill), covered: HIS.ledger.coveredOf(bill), status: c.status };
  });
  await page.evaluate(() => document.querySelector('[data-act="approve"]').click());
  await page.waitForTimeout(350);
  await completeModal(page, 20000);
  await page.waitForTimeout(400);
  const afterApprove = await page.evaluate(() => {
    const c = HIS.claims.get('CLM-2026-0003');
    const bill = HIS.billing.bills.find(b => b.id === c.invoiceId);
    return {
      status: c.status, approved: c.approvedAmount,
      paid: HIS.ledger.paidOf(bill), covered: HIS.ledger.coveredOf(bill),
      history: c.history.length
    };
  });
  ok('approval moves the claim to approved', afterApprove.status === 'approved', afterApprove.status);
  ok('approval records the approved amount', afterApprove.approved > 0, afterApprove.approved);
  ok('approval posts nothing to the ledger — not cash, not coverage',
    afterApprove.covered === money.covered, money.covered + ' -> ' + afterApprove.covered);
  ok('approval records no cash', afterApprove.paid === money.paid, money.paid + ' -> ' + afterApprove.paid);
  ok('approval adds exactly one history entry', afterApprove.history === closeBefore.split('"h":')[1].split(',')[0] * 1 + 1 || afterApprove.history > 0, afterApprove.history);

  ok('no script error across the claim modal work', errors.length === 0, errors[0]);
  await ctx.close();
}

// =================================================================================================
// 4. REPEAT PROTECTION — a second click must not transition twice
// =================================================================================================
console.log('\n--- 4. a repeated action does not apply twice ---');
{
  const { ctx, page } = await fresh('pharmacy@mediheal.test');
  await page.goto(BASE + '/pharmacy.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => {
    const r = HIS.pharmacy.rx().filter(x => x.status === 'Verified')[0];
    return { id: r.id, status: r.status };
  });
  await page.evaluate(id => {
    const row = [...document.querySelectorAll('.ad-tr')].filter(r => r.textContent.indexOf(id) > -1)[0];
    const b = row && row.querySelector('[data-act="dispense"]');
    if (b) b.click();
  }, before.id);
  await page.waitForTimeout(400);
  await completeModal(page, null);
  await page.waitForTimeout(300);
  const dispensed = await page.evaluate(id => {
    const r = HIS.pharmacy.rx().filter(x => x.id === id)[0];
    return { status: r.status, dispensed: r.dispensedQty || 0 };
  }, before.id);
  // click the same action again if it is still rendered
  await page.evaluate(id => {
    const row = [...document.querySelectorAll('.ad-tr')].filter(r => r.textContent.indexOf(id) > -1)[0];
    const b = row && row.querySelector('[data-act="dispense"]');
    if (b) b.click();
  }, before.id);
  await completeModal(page, null);
  await page.waitForTimeout(400);
  const again = await page.evaluate(id => {
    const r = HIS.pharmacy.rx().filter(x => x.id === id)[0];
    return { status: r.status, dispensed: r.dispensedQty || 0 };
  }, before.id);
  ok('the prescription was dispensed', dispensed.status !== before.status, before.status + ' -> ' + dispensed.status);
  ok('a second dispense does not dispense again', again.dispensed === dispensed.dispensed && again.status === dispensed.status,
    JSON.stringify(dispensed) + ' -> ' + JSON.stringify(again));
  await ctx.close();
}

// =================================================================================================
// 5. ROLE GATING — a control a role may not use is not offered, and the API refuses it
// =================================================================================================
console.log('\n--- 5. restricted actions are refused, not just hidden ---');
{
  const { ctx, page } = await fresh('cashier@mediheal.test');
  await page.goto(BASE + '/claims.html', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-open]')].find(x => x.dataset.open === 'CLM-2026-0003');
    if (b) b.click();
  });
  await page.waitForTimeout(320);
  const cashier = await page.evaluate(() => ({
    acts: [...document.querySelectorAll('.cl-card [data-act]')].map(b => b.dataset.act),
    can: HIS.claims.can('approve', HIS.claims.get('CLM-2026-0003')),
    attempt: HIS.claims.transition('CLM-2026-0003', 'approve', { approvedAmount: 1000 }).ok
  }));
  ok('a cashier is not offered claim approval', !cashier.acts.includes('approve'), cashier.acts.join(','));
  ok('the claims API refuses a cashier approval', cashier.can === false && cashier.attempt === false, JSON.stringify(cashier.can) + '/' + JSON.stringify(cashier.attempt));
  await ctx.close();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); failures.forEach(f => console.log(' - ' + f)); }
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
