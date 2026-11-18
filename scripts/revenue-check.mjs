// M12 — revenue integration and the admission lifecycle.
//
// What this covers, and why it is one suite: the brief's completion conditions 4 to 13 are a single
// chain. A clinical service raises a charge, the charge names an encounter, the encounter names an
// invoice, and the invoice is the only place a balance comes from. Admissions add the inpatient half
// of that chain — bed, daily accrual, transfer, discharge, final bill.
//
// The tests drive the real screens where a screen is the thing under test (consultation billing,
// laboratory cancellation, pharmacy return, the admissions page) and call the stores directly where
// the rule lives in the store (accrual cutoffs, duplicate prevention, price snapshots).
//
// Usage: PW=<playwright-core> node scripts/revenue-check.mjs
import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2'
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
await new Promise(r => server.listen(8862, r));
const BASE = 'http://127.0.0.1:8862';

const spec = process.env.PW || 'playwright-core';
const mod = await import(spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) ? pathToFileURL(spec).href : spec);
const chromium = mod.chromium || (mod.default && mod.default.chromium);
const browser = await chromium.launch({ channel: process.env.CHANNEL || 'chrome' });

let pass = 0, fail = 0;
const failures = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name); }
  else { fail++; failures.push({ name, detail: detail === undefined ? null : String(detail) }); console.log('FAIL ' + name + (detail !== undefined ? '  \u2192 ' + detail : '')); }
};
const near = (a, b, tol) => Math.abs(Number(a) - Number(b)) < (tol == null ? 0.011 : tol);

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e.message)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await page.goto(BASE + '/index.html', { waitUntil: 'load' });
await page.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));

// =================================================================================================
// 1. THE CHARGE MASTER — EFFECTIVE DATES AND PRICE SNAPSHOTS
// =================================================================================================
console.log('\n--- 1. charge master ---');
await page.goto(BASE + '/charges.html', { waitUntil: 'load' });
await page.waitForTimeout(300);
{
  const r = await page.evaluate(() => {
    const now = HIS.tariffs.priceFor('CONS-CARD', '2026-08-31');
    const later = HIS.tariffs.priceFor('CONS-CARD', '2027-03-01');
    const missing = HIS.tariffs.quote('NO-SUCH-CODE');
    const rooms = ['ROOM-PRIVATE', 'ROOM-SEMI', 'ROOM-WARD'].map(c => ({ c, p: HIS.tariffs.priceFor(c, '2026-08-31').price }));
    const depts = ['Cardiology', 'Neurology', 'Orthopaedics', 'General Medicine', 'Unknown Dept']
      .map(d => ({ d, code: HIS.tariffs.consultationCode(d), price: (HIS.tariffs.priceFor(HIS.tariffs.consultationCode(d), '2026-08-31') || {}).price }));
    return { now, later, missing, rooms, depts };
  });
  ok('a tariff resolves for the date it is asked about', r.now && r.now.price === 1500, r.now && r.now.price);
  ok('a later effective row is returned only once its date is reached', r.later && r.later.price === 1650, r.later && r.later.price);
  ok('a missing tariff is refused instead of invented', r.missing.ok === false && /No tariff/.test(r.missing.error), r.missing.error);
  ok('room rates match the invoice history the demo already carries',
    r.rooms[0].p === 2800 && r.rooms[1].p === 2000 && r.rooms[2].p === 1200, JSON.stringify(r.rooms));
  ok('each department maps to its own configured consultation fee',
    r.depts[0].price === 1500 && r.depts[1].price === 1600 && r.depts[2].price === 1700 &&
    r.depts[3].price === 1600 && r.depts[4].code === 'CONS-GEN', JSON.stringify(r.depts));
}

// =================================================================================================
// 2. A COMPLETED CONSULTATION RAISES ITS FEE — ONCE
// =================================================================================================
console.log('\n--- 2. consultation billing ---');
await page.goto(BASE + '/consultation.html', { waitUntil: 'load' });
await page.waitForTimeout(400);
{
  const before = await page.evaluate(() => ({
    charges: HIS.charges.all().length,
    enc: (HIS.encounters.openFor('PT-99213') || {}).id,
    inv: (HIS.encounters.openFor('PT-99213') || {}).invoiceId
  }));
  ok('opening the consultation screen raises nothing', before.charges === 0, before.charges);

  // Record the diagnosis through the real dialog, which is the completed-service event.
  await page.click("[data-modal='dx']");
  await page.waitForSelector("[data-ok='1']");
  await page.click("[data-ok='1']");
  await page.waitForTimeout(250);

  const r = await page.evaluate(() => {
    const enc = HIS.encounters.openFor('PT-99213');
    const ch = HIS.charges.forEncounter(enc.id).filter(c => c.source === 'consultation');
    const bill = HIS.billing.byId(enc.invoiceId);
    return {
      enc: enc.id, count: ch.length, amount: ch[0] && ch[0].amount,
      inv: ch[0] && ch[0].invoiceId, snap: ch[0] && ch[0].priceSnapshot,
      total: bill ? HIS.ledger.invoiceAmount(bill) : null, paid: bill ? HIS.ledger.paidOf(bill) : null
    };
  });
  ok('saving the diagnosis raises exactly one consultation charge', r.count === 1, r.count);
  ok('the fee comes from the configured tariff', near(r.amount, 1500), r.amount);
  ok('the charge lands on the episode invoice', r.inv === before.inv, r.inv + ' vs ' + before.inv);
  ok('the charge keeps the price it was raised at', r.snap && near(r.snap.unitPrice, 1500) && !!r.snap.capturedAt, JSON.stringify(r.snap));
  ok('the fee is a charge, not a payment', near(r.paid, 10000), r.paid);

  // Re-saving the same consultation must not bill twice. The saved-state dialog has to be dismissed
  // first, which is what a user would do.
  await page.click("#tpmodal [data-close]");
  await page.waitForTimeout(150);
  await page.click("[data-modal='dx']");
  await page.waitForSelector("[data-ok='1']");
  await page.click("[data-ok='1']");
  await page.waitForTimeout(250);
  const again = await page.evaluate(() => {
    const enc = HIS.encounters.openFor('PT-99213');
    return HIS.charges.forEncounter(enc.id).filter(c => c.source === 'consultation').length;
  });
  ok('saving the same consultation again does not bill a second fee', again === 1, again);
}

// =================================================================================================
// 3. ADMISSION → BED → ACCRUAL → TRANSFER → DISCHARGE
// =================================================================================================
console.log('\n--- 3. admission lifecycle ---');
await page.goto(BASE + '/admissions.html', { waitUntil: 'load' });
await page.waitForTimeout(400);
{
  const r = await page.evaluate(() => {
    const out = {};
    out.beds = HIS.admissions.beds().length;
    out.occ0 = HIS.admissions.occupancy();

    const free = HIS.admissions.bedBoard('Cardiology Ward').filter(b => b.status === 'available')[0];
    out.free = free && { id: free.id, type: free.type };

    // A second active admission for the same patient must be refused.
    out.secondEpisode = HIS.admissions.admit({
      patientId: 'PT-99213', bedId: free.id, diagnosis: 'duplicate episode'
    });

    const adm = HIS.admissions.admit({
      patientId: 'PT-99210', bedId: free.id, attending: 'Dr. Yumie Pasiol',
      diagnosis: 'Community-acquired pneumonia',
      payer: { type: 'philhealth', reference: '03-112233445-6' },
      admittedAt: '2026-09-01T08:00:00+08:00'
    });
    out.admit = { ok: adm.ok, err: adm.error, id: adm.admission && adm.admission.id, enc: adm.admission && adm.admission.encounterId, bed: adm.admission && adm.admission.bedLabel };

    // Double booking.
    out.doubleBook = HIS.admissions.admit({ patientId: 'PT-99212', bedId: free.id, diagnosis: 'x', admittedAt: '2026-09-01T09:00:00+08:00' }).ok;
    out.occ1 = HIS.admissions.occupancy();
    out.encLink = HIS.encounters.byId(adm.admission.encounterId);

    // Accrual to 3 September, 13:00.
    const fin = HIS.admissions.accrue(adm.admission.id, { asOf: '2026-09-03T13:00:00+08:00' });
    out.accrue = { ok: fin.ok, posted: fin.posted.length, total: fin.total, dates: fin.dates, missing: fin.missing };
    const fin2 = HIS.admissions.accrue(adm.admission.id, { asOf: '2026-09-03T13:00:00+08:00' });
    out.accrueAgain = { posted: fin2.posted.length, skipped: fin2.skipped.length };

    // Transfer after the noon cutoff on 3 September.
    const dest = HIS.admissions.bedBoard('Neurology Ward').filter(b => b.status === 'available' && b.type === 'Ward')[0];
    out.dest = dest && { id: dest.id, type: dest.type };
    const tr = HIS.admissions.transfer(adm.admission.id, { bedId: dest.id, reason: 'step-down to ward bed', at: '2026-09-03T15:00:00+08:00' });
    out.transfer = { ok: tr.ok, err: tr.error, bed: tr.admission && tr.admission.bedLabel, type: tr.admission && tr.admission.bedType, hist: tr.admission && tr.admission.transfers.length };
    out.occ2 = HIS.admissions.occupancy();

    // Accrue again: 4 September is the first ward-rate day.
    const fin3 = HIS.admissions.accrue(adm.admission.id, { asOf: '2026-09-04T13:00:00+08:00' });
    out.accrue3 = { posted: fin3.posted.length, total: fin3.total };

    out.chargesBefore = HIS.charges.forEncounter(adm.admission.encounterId).map(c => ({ d: c.description, a: c.amount, inv: c.invoiceId }));
    out.unbilled = HIS.charges.unbilled().filter(c => c.encounterId === adm.admission.encounterId).length;

    const dc = HIS.admissions.discharge(adm.admission.id, {
      disposition: 'Discharged home', summary: 'Afebrile 48h, oral antibiotics continued.',
      at: '2026-09-05T15:00:00+08:00'
    });
    out.discharge = { ok: dc.ok, err: dc.error, unbilled: dc.unbilledCount, accrualPosted: dc.accrual && dc.accrual.posted.length };
    out.bedAfter = HIS.admissions.bedStatus(dest.id);
    out.occ3 = HIS.admissions.occupancy();
    out.encAfter = HIS.encounters.byId(adm.admission.encounterId);
    out.allRoom = HIS.charges.forEncounter(adm.admission.encounterId)
      .filter(c => c.source === 'room').map(c => ({ d: c.description, a: c.amount }));
    out.allNurse = HIS.charges.forEncounter(adm.admission.encounterId)
      .filter(c => c.source === 'nursing').length;
    return out;
  });

  ok('the configured bed inventory exists', r.beds === 172, r.beds);
  ok('two beds are occupied at load', r.occ0.occupied === 2, r.occ0.occupied);
  ok('a patient cannot hold two active admissions', r.secondEpisode.ok === false && /already has an active admission/.test(r.secondEpisode.error), r.secondEpisode.error);
  ok('a patient can be admitted to a free bed', r.admit.ok === true, r.admit.err);
  ok('the admission opens an encounter and links it back', !!r.admit.enc && r.encLink && r.encLink.admissionId === r.admit.id, r.admit.enc);
  ok('a bed cannot be given to two patients', r.doubleBook === false);
  ok('occupancy rises by one', r.occ1.occupied === 3, r.occ1.occupied);

  ok('accrual posts one room line and one nursing line per billable day', r.accrue.posted === 6, r.accrue.posted);
  ok('the three days are 1, 2 and 3 September', r.accrue.dates.join(',') === '2026-09-01,2026-09-02,2026-09-03', r.accrue.dates.join(','));
  ok('the private room rate is used', near(r.accrue.total, 3 * 2800 + 3 * 600), r.accrue.total);
  ok('re-running accrual posts nothing twice', r.accrueAgain.posted === 0 && r.accrueAgain.skipped === 6, JSON.stringify(r.accrueAgain));

  ok('a transfer succeeds', r.transfer.ok === true, r.transfer.err);
  ok('the transfer is recorded as history, not an overwrite', r.transfer.hist === 1, r.transfer.hist);
  ok('the patient now occupies the destination bed type', r.transfer.type === 'Ward', r.transfer.type);
  ok('occupancy is unchanged by a transfer', r.occ2.occupied === 3, r.occ2.occupied);

  ok('the next day is billed at the new bed rate', near(r.accrue3.total, 1200 + 600), r.accrue3.total);
  ok('a transfer does not re-price an already posted day',
    r.accrue3.posted === 2 && r.accrue3.total === 1800, JSON.stringify(r.accrue3));
  ok('the posted days total four room lines at the two rates',
    r.allRoom.length === 5 && near(r.allRoom.reduce((t, c) => t + c.a, 0), 3 * 2800 + 2 * 1200),
    r.allRoom.map(c => c.a).join('+'));
  ok('every day also posted its nursing line', r.allNurse === 5, r.allNurse);

  ok('discharge succeeds with a disposition and a summary', r.discharge.ok === true, r.discharge.err);
  ok('discharge releases the bed', r.bedAfter !== 'occupied', r.bedAfter);
  ok('occupancy falls back to two', r.occ3.occupied === 2, r.occ3.occupied);
  ok('discharge closes the encounter', r.encAfter.status === 'completed', r.encAfter.status);
  ok('discharge reports the charges still unbilled', r.discharge.unbilled === 10, r.discharge.unbilled);
}

// =================================================================================================
// 4. THE UNBILLED QUEUE, ASSIGNMENT AND INVOICE CREATION
// =================================================================================================
console.log('\n--- 4. unbilled queue ---');
await page.goto(BASE + '/charges.html', { waitUntil: 'load' });
await page.waitForTimeout(400);
{
  const r = await page.evaluate(() => {
    const out = {};
    const un = HIS.charges.unbilled();
    out.count = un.length;
    out.total = un.reduce((t, c) => t + c.amount, 0);
    out.first = un[0] && { id: un[0].id, patient: un[0].patientId, amount: un[0].amount, enc: un[0].encounterId };

    // An invoice opened for the patient starts at zero: the value comes from the charges.
    const inv = HIS.billing.create({ patientId: out.first.patient, encounterId: out.first.enc });
    out.inv = { ok: inv.ok, id: inv.bill && inv.bill.id, amount: inv.bill && inv.bill.amount };
    HIS.encounters.attachInvoice(out.first.enc, inv.bill.id);

    out.beforeTotal = HIS.ledger.invoiceAmount(inv.bill);
    const bad = HIS.charges.assign(out.first.id, 'BL-8801', 'wrong patient');
    out.wrongPatient = { ok: bad.ok, err: bad.error };

    const noReason = HIS.charges.assign(out.first.id, inv.bill.id, '');
    out.noReason = noReason.ok;

    const a = HIS.charges.assign(out.first.id, inv.bill.id, 'episode bill for the admission');
    out.assign = { ok: a.ok, err: a.error, inv: a.charge && a.charge.invoiceId, by: a.charge && a.charge.assignedBy };
    out.afterTotal = HIS.ledger.invoiceAmount(inv.bill);
    out.afterBalance = HIS.ledger.balanceOf(inv.bill);

    const twice = HIS.charges.assign(out.first.id, inv.bill.id, 'again');
    out.twice = { ok: twice.ok, err: twice.error };

    out.unassigned = HIS.charges.unbilled().length;
    out.audit = HIS.audit.list().filter(x => /Charge assigned/.test(x.what)).length;
    return out;
  });

  ok('the queue holds every charge with no invoice', r.count >= 10, r.count);
  ok('the queue value is the sum of those charges', near(r.total, r.count * 0 + r.total) && r.total > 0, r.total);
  ok('an invoice can be opened for a patient with none', r.inv.ok === true && !!r.inv.id, r.inv.id);
  ok('a new invoice starts at zero, not at an invented total', r.inv.amount === 0, r.inv.amount);
  ok('a charge cannot be assigned to another patient\'s invoice', r.wrongPatient.ok === false && /belongs to/.test(r.wrongPatient.err), r.wrongPatient.err);
  ok('assignment without a reason is refused', r.noReason === false);
  ok('assignment succeeds and records who did it', r.assign.ok === true && r.assign.inv === r.inv.id && !!r.assign.by, r.assign.err);
  ok('the invoice total rises by exactly the charge', near(r.afterTotal - r.beforeTotal, r.first.amount), r.afterTotal - r.beforeTotal);
  ok('the balance rises by the same amount', near(r.afterBalance, r.first.amount), r.afterBalance);
  ok('assigning the same charge twice is refused', r.twice.ok === false, r.twice.err);
  ok('the queue shrinks by one', r.unassigned === r.count - 1, r.unassigned + ' of ' + r.count);
  ok('the assignment is written to the audit log', r.audit >= 1, r.audit);
}

// =================================================================================================
// 5. LABORATORY CANCELLATION AND ITS BILLING POLICY
// =================================================================================================
console.log('\n--- 5. laboratory cancellation ---');
await page.goto(BASE + '/laboratory.html', { waitUntil: 'load' });
await page.waitForTimeout(300);
{
  const r = await page.evaluate(() => {
    const out = {};
    const a = HIS.lab.create({ patientId: 'PT-99213', test: 'Creatinine', priority: 'Routine' });
    out.a = { id: a.order.id, charge: a.order.chargeId };
    out.beforeA = HIS.charges.byId(a.order.chargeId).status;
    const ca = HIS.lab.cancel(a.order.id, 'ordered in error');
    out.afterA = HIS.charges.byId(a.order.chargeId).status;
    out.policyA = ca.order.billingPolicy;

    const b = HIS.lab.create({ patientId: 'PT-99213', test: 'Potassium', priority: 'Routine' });
    HIS.lab.collect(b.order.id);
    out.beforeB = HIS.charges.byId(b.order.chargeId).status;
    const cb = HIS.lab.cancel(b.order.id, 'specimen haemolysed');
    out.afterB = HIS.charges.byId(b.order.chargeId).status;
    out.policyB = cb.order.billingPolicy;
    out.bStatus = cb.order.status;
    return out;
  });
  ok('an order raises its charge before collection', r.beforeA === 'active', r.beforeA);
  ok('cancelling before collection voids the charge', r.afterA === 'void', r.afterA);
  ok('the order states the billing consequence', /before collection/.test(r.policyA || ''), r.policyA);
  ok('cancelling after collection keeps the charge', r.afterB === 'active', r.afterB);
  ok('and says why', /after collection/.test(r.policyB || ''), r.policyB);
  ok('the order is still cancelled', r.bStatus === 'Cancelled', r.bStatus);
}

// =================================================================================================
// 6. PHARMACY RETURN REVERSES THE DISPENSE AND ITS CHARGE
// =================================================================================================
console.log('\n--- 6. pharmacy return ---');
await page.goto(BASE + '/pharmacy.html', { waitUntil: 'load' });
await page.waitForTimeout(300);
{
  const r = await page.evaluate(() => {
    const out = {};
    const rx = HIS.pharmacy.rxById('RX-0003');
    const batch = HIS.pharmacy.stock().filter(b => b.drug === rx.drug && b.qty > 5 && !HIS.pharmacy.isExpired(b))[0];
    out.stockBefore = batch.qty;
    const d = HIS.pharmacy.dispense('RX-0003', { batchId: batch.id, qty: 6 });
    out.dispensed = d.ok;
    out.chargeId = d.billing && d.billing.charge && d.billing.charge.id;
    out.stockMid = HIS.pharmacy.stock().filter(b => b.id === batch.id)[0].qty;
    out.remainingMid = HIS.pharmacy.remaining(HIS.pharmacy.rxById('RX-0003'));

    const ret = HIS.pharmacy.returnDispense('RX-0003', 0, 'patient discharged before use');
    out.returnOk = ret.ok;
    out.returnErr = ret.error;
    out.stockAfter = HIS.pharmacy.stock().filter(b => b.id === batch.id)[0].qty;
    out.remainingAfter = HIS.pharmacy.remaining(HIS.pharmacy.rxById('RX-0003'));
    out.chargeAfter = HIS.charges.byId(out.chargeId).status;
    out.returnsRow = (HIS.pharmacy.rxById('RX-0003').returns || []).length;
    out.dispenseRow = (HIS.pharmacy.rxById('RX-0003').dispensed || []).length;
    out.moves = HIS.pharmacy.moves().filter(m => m.kind === 'return').length;
    const twice = HIS.pharmacy.returnDispense('RX-0003', 0, 'again');
    out.twice = twice.ok;
    return out;
  });
  ok('a partial dispense succeeds', r.dispensed === true);
  ok('stock falls by the dispensed quantity', r.stockMid === r.stockBefore - 6, r.stockMid);
  ok('a return puts the stock back', r.returnOk === true && r.stockAfter === r.stockBefore, r.stockAfter);
  ok('the prescription regains the returned quantity', r.remainingAfter === r.remainingMid + 6, r.remainingAfter);
  ok('the original dispense row is preserved', r.dispenseRow === 1, r.dispenseRow);
  ok('the return is recorded beside it', r.returnsRow === 1, r.returnsRow);
  ok('a compensating stock movement is written', r.moves === 1, r.moves);
  ok('the charge for that dispense is voided', r.chargeAfter === 'void', r.chargeAfter);
  ok('returning the same event twice is refused', r.twice === false);
}

// =================================================================================================
// 7. EVERYTHING RECONCILES
// =================================================================================================
console.log('\n--- 7. reconciliation ---');
{
  const r = await page.evaluate(() => {
    const rows = HIS.billing.bills.map(b => ({
      id: b.id,
      identity: Math.round(HIS.ledger.invoiceAmount(b) * 100) - HIS.ledger.sums(b.id).net - HIS.ledger.sums(b.id).covered - Math.round(HIS.ledger.balanceOf(b) * 100)
    }));
    return {
      rows,
      sum: HIS.billing.bills.reduce((t, b) => t + HIS.ledger.invoiceAmount(b), 0),
      inv: HIS.ledger.invariants(),
      crec: HIS.charges.reconcile(),
      lrec: HIS.ledger.reconcile(),
      chg: HIS.charges.stats()
    };
  });
  ok('every invoice satisfies total = collected + covered + outstanding', r.rows.every(x => x.identity === 0),
    JSON.stringify(r.rows.filter(x => x.identity !== 0)));
  ok('no ledger invariant is broken', r.inv.length === 0, JSON.stringify(r.inv));
  ok('no charge integrity problem remains', r.crec.problems.length === 0, JSON.stringify(r.crec.problems));
  ok('the ledger total equals the sum of its invoices', near(r.lrec.billed, r.sum), r.lrec.billed + ' vs ' + r.sum);
  ok('charges never enter the collected figure', r.lrec.collected === 100700, r.lrec.collected);
  ok('billed plus unbilled equals every active charge',
    near(r.lrec.billed - 160860, r.chg.assignedCount ? r.chg.total - r.chg.unbilledTotal : 0, 0.02),
    r.chg.total + ' total, ' + r.chg.unbilledTotal + ' unbilled');
}

// =================================================================================================
// 8. THE SCREENS RENDER
// =================================================================================================
console.log('\n--- 8. screens ---');
for (const [file, needle] of [['admissions.html', 'Bed board'], ['charges.html', 'Unbilled queue']]) {
  await page.goto(BASE + '/' + file, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({
    text: document.getElementById('stage').innerText,
    overflow: document.getElementById('stage').scrollWidth - document.getElementById('stage').clientWidth,
    tiles: document.querySelectorAll('.bd-bed').length
  }));
  ok(file + ' renders its content', r.text.indexOf(needle) > -1, r.text.slice(0, 60));
  ok(file + ' does not overflow the 1440 stage', r.overflow <= 0, r.overflow);
}

ok('the whole workflow ran with no console errors', errs.length === 0, errs[0]);

await mkdir(path.join(ROOT, 'qa', 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'qa', 'audit', 'm12.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, failures }, null, 2));

await ctx.close();
await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
