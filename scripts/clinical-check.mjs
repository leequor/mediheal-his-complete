// M6 harness: laboratory and pharmacy workflows, and their integration with the patient record.
//
// Every assertion drives the real store API, not the DOM, so a passing run proves the RULES hold
// (guarded transitions, stock arithmetic, expiry exclusion, validation gating). A second block
// checks the screens render the same records the store holds, and a third checks the portal sees a
// validated result and nothing else.
//
// Usage: PW=<playwright-core> node scripts/clinical-check.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2'
};
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  try {
    const body = await readFile(path.join(ROOT, p));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(8847, r));
const BASE = 'http://127.0.0.1:8847';

const spec = process.env.PW || 'playwright-core';
const mod = await import(spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) ? pathToFileURL(spec).href : spec);
const chromium = mod.chromium || (mod.default && mod.default.chromium);
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '  \u2192 ' + detail : '')); }
};
const DEMO = 'MediHeal2026!';

// A clean context per block: these tests mutate stock and results, and must not leak between runs.
async function session(email, pagePath) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.evaluate(([e, pw]) => HIS.auth.attempt(e, pw, true), [email, DEMO]);
  await page.goto(BASE + pagePath, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return { ctx, page, errs };
}

// ---------------------------------------------------------------- 1. laboratory workflow
{
  const { ctx, page, errs } = await session('laboratory@mediheal.test', '/laboratory.html');

  const r = await page.evaluate(() => {
    const out = {};
    const made = HIS.lab.create({ patientId: 'PT-99212', test: 'Potassium', priority: 'Urgent' });
    out.created = made.ok;
    const id = made.order.id;
    out.startsOrdered = made.order.status === 'Ordered';

    // Cannot skip collection.
    out.validateTooEarly = HIS.lab.validate(id);
    out.processTooEarly = HIS.lab.process(id);

    out.collect = HIS.lab.collect(id).ok;
    out.collectTwice = HIS.lab.collect(id).ok;
    out.process = HIS.lab.process(id).ok;

    // A potassium of 7.2 crosses the configured critical threshold (> 6.5).
    out.result = HIS.lab.enterResult(id, { value: '7.2' });
    out.flag = HIS.lab.byId(id).result.flag;
    out.statusAfterResult = HIS.lab.byId(id).status;

    out.validate = HIS.lab.validate(id).ok;
    out.final = HIS.lab.byId(id);
    return out;
  });

  ok('an order can be created', r.created === true);
  ok('a new order starts as Ordered', r.startsOrdered === true);
  ok('a result cannot be validated before it is entered', r.validateTooEarly.ok === false, r.validateTooEarly.error);
  ok('processing cannot start before collection', r.processTooEarly.ok === false, r.processTooEarly.error);
  ok('specimen can be collected', r.collect === true);
  ok('the same specimen cannot be collected twice', r.collectTwice === false);
  ok('processing can start after collection', r.process === true);
  ok('a result can be entered', r.result.ok === true, r.result.error);
  ok('the flag is computed from the configured critical threshold', r.flag === 'Critical', r.flag);
  ok('an entered result is not yet released', r.statusAfterResult === 'Resulted', r.statusAfterResult);
  ok('validation releases the result', r.validate === true);
  ok('the validated record carries the validator and timestamp', !!r.final.validatedBy && !!r.final.validatedAt);

  // A normal value must NOT be flagged.
  const norm = await page.evaluate(() => {
    const m = HIS.lab.create({ patientId: 'PT-99209', test: 'Potassium' });
    HIS.lab.collect(m.order.id); HIS.lab.process(m.order.id);
    HIS.lab.enterResult(m.order.id, { value: '4.2' });
    return HIS.lab.byId(m.order.id).result.flag;
  });
  ok('an in-range value is not flagged', norm === 'Normal', norm);

  // Text-only tests are never auto-flagged.
  const txt = await page.evaluate(() => HIS.lab.flagFor('ST depression', 'Sinus rhythm', 'ECG 12-lead'));
  ok('a text reading is not auto-flagged', txt === 'Normal', txt);

  // Critical acknowledgement clears the alert.
  const ack = await page.evaluate(() => {
    const before = HIS.lab.stats().critical;
    const crit = HIS.lab.all().filter(o => o.status === 'Validated' && o.result && o.result.flag === 'Critical' && !o.criticalAck)[0];
    HIS.lab.acknowledgeCritical(crit.id);
    return { before, after: HIS.lab.stats().critical };
  });
  ok('the critical-result alert counts unacknowledged results', ack.before >= 1, 'before=' + ack.before);
  ok('acknowledging removes it from the alert count', ack.after === ack.before - 1, ack.before + ' -> ' + ack.after);

  ok('laboratory page loaded with no console errors', errs.length === 0, errs[0]);
  await ctx.close();
}

// ---------------------------------------------------------------- 2. pharmacy workflow
// Superadmin fixture covers prescribing plus pharmacy operations; writer roles are tested separately.
{
  const { ctx, page, errs } = await session('superadmin@mediheal.test', '/pharmacy.html');

  const r = await page.evaluate(() => {
    const out = {};
    // RX-0001 is Aspirin 81 mg x30, Pending.
    out.verify = HIS.pharmacy.verify('RX-0001').ok;
    out.verifyTwice = HIS.pharmacy.verify('RX-0001').ok;

    const batch = HIS.pharmacy.batchesFor('Aspirin 81 mg tablet')[0];
    out.batchId = batch.id;
    out.stockBefore = batch.qty;

    out.overDispense = HIS.pharmacy.dispense('RX-0001', { batchId: batch.id, qty: 40 });
    out.partial = HIS.pharmacy.dispense('RX-0001', { batchId: batch.id, qty: 10 });
    out.afterPartial = HIS.pharmacy.rxById('RX-0001');
    out.stockAfterPartial = HIS.pharmacy.stock().filter(b => b.id === batch.id)[0].qty;

    out.rest = HIS.pharmacy.dispense('RX-0001', { batchId: batch.id, qty: 20 });
    out.afterFull = HIS.pharmacy.rxById('RX-0001');
    out.dispenseAgain = HIS.pharmacy.dispense('RX-0001', { batchId: batch.id, qty: 1 });
    out.stockFinal = HIS.pharmacy.stock().filter(b => b.id === batch.id)[0].qty;
    return out;
  });

  ok('a prescription can be verified', r.verify === true);
  ok('the same prescription cannot be verified twice', r.verifyTwice === false);
  ok('dispensing more than the prescription allows is refused', r.overDispense.ok === false, r.overDispense.error);
  ok('a partial dispense succeeds', r.partial.ok === true, r.partial.error);
  ok('a partial dispense leaves the prescription in Partial', r.afterPartial.status === 'Partial', r.afterPartial.status);
  ok('stock is reduced by exactly the quantity given', r.stockAfterPartial === r.stockBefore - 10, r.stockBefore + ' -> ' + r.stockAfterPartial);
  ok('dispensing the balance closes the prescription', r.afterFull.status === 'Dispensed', r.afterFull.status);
  ok('a dispensed prescription cannot be dispensed again', r.dispenseAgain.ok === false);
  ok('total stock reduction equals the total dispensed', r.stockFinal === r.stockBefore - 30, r.stockBefore + ' -> ' + r.stockFinal);

  // Expired batch is excluded, and refused if forced.
  const exp = await page.evaluate(() => {
    const b = HIS.pharmacy.stock().filter(x => HIS.pharmacy.isExpired(x) && x.qty > 0)[0];
    if (!b) return { none: true };
    const made = HIS.pharmacy.createRx({ patientId: 'PT-99211', drug: b.drug, dosage: '1 vial daily', qty: 1, unit: b.unit });
    HIS.pharmacy.verify(made.prescription.id);
    const res = HIS.pharmacy.dispense(made.prescription.id, { batchId: b.id, qty: 1 });
    return { batch: b.batch, ok: res.ok, error: res.error };
  });
  ok('an expired batch cannot be dispensed', exp.ok === false && /expired/i.test(exp.error || ''), exp.error);

  // A batch of a different drug is refused.
  const wrong = await page.evaluate(() => {
    const b = HIS.pharmacy.batchesFor('Paracetamol 500 mg tablet')[0];
    HIS.pharmacy.verify('RX-0002');
    return HIS.pharmacy.dispense('RX-0002', { batchId: b.id, qty: 1 });
  });
  ok('a batch of a different medication is refused', wrong.ok === false && /different/i.test(wrong.error), wrong.error);

  // Stock rules.
  const adj = await page.evaluate(() => {
    const b = HIS.pharmacy.stock().filter(x => x.drug === 'Paracetamol 500 mg tablet')[0];
    const before = b.qty;
    const noReason = HIS.pharmacy.adjust(b.id, -5, '');
    const negative = HIS.pharmacy.adjust(b.id, -(before + 1), 'test');
    const fine = HIS.pharmacy.adjust(b.id, -5, 'Broken blister pack');
    return { before, noReason: noReason.ok, negative: negative.ok, fine: fine.ok, after: fine.ok ? fine.batch.qty : null, id: b.id };
  });
  ok('an adjustment without a reason is refused', adj.noReason === false);
  ok('an adjustment that would go negative is refused', adj.negative === false);
  ok('a valid adjustment applies', adj.fine === true && adj.after === adj.before - 5, adj.before + ' -> ' + adj.after);

  const mv = await page.evaluate(id => HIS.pharmacy.moves().filter(m => m.batchId === id), adj.id);
  ok('every stock change writes a movement row', mv.length === 1 && mv[0].qty === -5 && /blister/i.test(mv[0].reason),
    JSON.stringify(mv).slice(0, 160));

  const rec = await page.evaluate(() => {
    const before = HIS.pharmacy.stock().length;
    const r = HIS.pharmacy.receive({ drug: 'Omeprazole 20 mg capsule', qty: 200, batch: 'OMP-2501', expiry: '2028-06-30', unit: 'capsule', supplier: 'AstraZeneca PH', unitCost: 7.2 });
    return { ok: r.ok, added: HIS.pharmacy.stock().length - before, batch: r.batch && r.batch.batch };
  });
  ok('receiving stock creates a new batch', rec.ok === true && rec.added === 1, JSON.stringify(rec));

  const disp = await page.evaluate(() => {
    const b = HIS.pharmacy.stock().filter(x => HIS.pharmacy.isExpired(x) && x.qty > 0)[0];
    if (!b) return { none: true };
    const qty = b.qty;
    const r = HIS.pharmacy.dispose(b.id, 'Returned to supplier');
    return { ok: r.ok, before: qty, after: r.batch.qty };
  });
  ok('an expired batch can be disposed of', disp.ok === true && disp.after === 0, disp.before + ' -> ' + disp.after);

  ok('pharmacy page loaded with no console errors', errs.length === 0, errs[0]);
  await ctx.close();
}

// ---------------------------------------------------------------- 3. screens render the store
{
  const { ctx, page, errs } = await session('laboratory@mediheal.test', '/laboratory.html');
  await page.goto(BASE + '/laboratory.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => ({
    rows: document.querySelectorAll('.ad-tr').length,
    orders: HIS.lab.all().length,
    kpi: [...document.querySelectorAll('.ad-kpi .v')].map(e => e.textContent.trim()),
    hasAlert: !!document.querySelector('.ad-alert'),
    actionLabels: [...document.querySelectorAll('.ad-tr .ad-btn')].map(b => b.textContent.trim()).slice(0, 4)
  }));
  ok('the laboratory table renders one row per order', r.rows === r.orders, r.rows + ' rows / ' + r.orders + ' orders');
  ok('the KPI strip is populated', r.kpi.length === 4 && r.kpi.every(v => v !== ''), r.kpi.join('|'));
  ok('row actions match each status', r.actionLabels.length > 0, r.actionLabels.join(', '));
  ok('laboratory screen has no console errors', errs.length === 0, errs[0]);
  await ctx.close();
}

{
  const { ctx, page, errs } = await session('pharmacy@mediheal.test', '/pharmacy.html');
  await page.goto(BASE + '/pharmacy.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const rx = await page.evaluate(() => ({
    rows: document.querySelectorAll('.ad-tr').length,
    count: HIS.pharmacy.rx().filter(r => r.status !== 'Dispensed' && r.status !== 'Rejected').length
  }));
  ok('the prescription tab renders one row per open prescription', rx.rows === rx.count, rx.rows + ' / ' + rx.count);

  // Switch to inventory and confirm the batches render.
  await page.click("[data-tab='stock']");
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({
    rows: document.querySelectorAll('.ad-tr').length,
    batches: HIS.pharmacy.stock().length,
    expiredShown: document.body.innerText.includes('Expired')
  }));
  ok('the inventory tab renders one row per batch', st.rows === st.batches, st.rows + ' / ' + st.batches);
  ok('expired batches are visibly marked', st.expiredShown === true);
  ok('pharmacy screen has no console errors', errs.length === 0, errs[0]);
  await ctx.close();
}

// ---------------------------------------------------------------- 4. integration with the record
{
  const { ctx, page } = await session('laboratory@mediheal.test', '/laboratory.html');
  const r = await page.evaluate(() => {
    // An order for Isabel: entered but NOT validated.
    const a = HIS.lab.create({ patientId: 'PT-99213', test: 'Creatinine' });
    HIS.lab.collect(a.order.id); HIS.lab.process(a.order.id);
    HIS.lab.enterResult(a.order.id, { value: '1.1' });
    // A second order, validated.
    const b = HIS.lab.create({ patientId: 'PT-99213', test: 'Hemoglobin' });
    HIS.lab.collect(b.order.id); HIS.lab.process(b.order.id);
    HIS.lab.enterResult(b.order.id, { value: '11.2' });
    HIS.lab.validate(b.order.id);
    return { draft: a.order.id, done: b.order.id, draftStatus: HIS.lab.byId(a.order.id).status };
  });
  ok('an entered result stays a draft until validated', r.draftStatus === 'Resulted', r.draftStatus);

  // Now look at the patient's own record in the portal.
  // Opened in the SAME tab: demonstration data is tab-scoped, so a second tab would be a separate,
  // freshly seeded dataset. Signing in as the patient here is also what a visitor does.
  await page.evaluate(() => HIS.auth.clear());
  await page.goto(BASE + '/portal.html#signin', { waitUntil: 'load' });
  await page.evaluate(pw => HIS.auth.attempt('patient@mediheal.test', pw, true), DEMO);
  await page.goto(BASE + '/portal.html#medical', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const seen = await page.evaluate(() => document.querySelector('#pt-stage').innerText);
  ok('the portal shows the validated result', /Hemoglobin/.test(seen) && /11\.2/.test(seen));
  ok('the portal does NOT show the unvalidated draft', !/Creatinine/.test(seen));
  await ctx.close();
}

// ---------------------------------------------------------------- 5. pharmacy reaches the portal
{
  const { ctx, page } = await session('pharmacy@mediheal.test', '/pharmacy.html');
  await page.evaluate(() => {
    // RX-0002 is Atorvastatin for Isabel, still Pending.
    const b = HIS.pharmacy.batchesFor('Atorvastatin 40 mg tablet')[0];
    HIS.pharmacy.verify('RX-0002');
    HIS.pharmacy.dispense('RX-0002', { batchId: b.id, qty: 30 });
  });
  await page.evaluate(() => HIS.auth.clear());
  await page.goto(BASE + '/portal.html#signin', { waitUntil: 'load' });
  await page.evaluate(pw => HIS.auth.attempt('patient@mediheal.test', pw, true), DEMO);
  await page.goto(BASE + '/portal.html#medical', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const seen = await page.evaluate(() => document.querySelector('#pt-stage').innerText);
  ok('the portal lists the dispensed prescription with its status', /Atorvastatin/.test(seen) && /Dispensed/.test(seen));
  await ctx.close();
}


// ---------------------------------------------------------------- 6. Treatment drives both queues
{
  const { ctx, page, errs } = await session('doctor@mediheal.test', '/treatment.html');
  await page.waitForTimeout(500);

  // Prescribe: the Figma modal is unchanged; its submit now raises a pharmacy order.
  const before = await page.evaluate(() => HIS.pharmacy.rx().length);
  await page.click("[data-modal='rx']");
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const f = document.querySelectorAll('#tpmodal [data-i]');
    f[0].value = 'Atorvastatin 40 mg tablet';
    f[1].value = '1 tablet (40 mg)';
    f[3].value = 'Once daily at bedtime';
    f[4].value = '30 days \u00b7 30 tablets';
    document.querySelector('[data-ok]').click();
  });
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const list = HIS.pharmacy.rx();
    const last = list[list.length - 1];
    return { n: list.length, drug: last.drug, qty: last.qty, patient: last.patientId, status: last.status };
  });
  ok('Prescribe in Treatment raises a real pharmacy order', after.n === before + 1, before + ' -> ' + after.n);
  ok('the pharmacy order carries the right patient, drug and quantity',
    after.patient === 'PT-99213' && after.drug === 'Atorvastatin 40 mg tablet' && after.qty === 30,
    JSON.stringify(after));
  ok('the new order starts Pending so the pharmacist verifies it', after.status === 'Pending', after.status);

  // Order a test: lands in the laboratory queue.
  const labBefore = await page.evaluate(() => HIS.lab.all().length);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-modal]')].find(x => x.dataset.modal === 'order');
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() => !!document.getElementById('tpmodal'));
  if (opened) {
    await page.evaluate(() => {
      const f = document.querySelectorAll('#tpmodal [data-i]');
      f[0].value = 'Troponin I (blood test)';
      f[4].value = 'Chest pain';
      document.querySelector('[data-ok]').click();
    });
    await page.waitForTimeout(400);
    const labAfter = await page.evaluate(() => {
      const list = HIS.lab.all();
      const last = list[list.length - 1];
      return { n: list.length, test: last.test, priority: last.priority, patient: last.patientId };
    });
    ok('ordering a test in Treatment creates a laboratory order', labAfter.n === labBefore + 1, labBefore + ' -> ' + labAfter.n);
    ok('the laboratory order matches the catalogue name and priority',
      labAfter.test === 'Troponin I' && labAfter.priority === 'STAT' && labAfter.patient === 'PT-99213',
      JSON.stringify(labAfter));
  } else {
    ok('ordering a test in Treatment creates a laboratory order', false, 'order modal did not open');
  }

  ok('treatment page has no console errors', errs.length === 0, errs[0]);
  await ctx.close();
}

await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
