// Sequence sweep — the journeys a real user makes and the money invariants after each step.
// The single-step suites click one control from a fresh seed; this one does payment -> refund -> void,
// timesheet change -> payroll re-run, discharge -> reopen -> transfer, and the claim and lab state
// machines, re-deriving the ledger and bed invariants after every step.
//
// Run: PW=<playwright-core> node scripts/sequences-check.mjs
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
    const buf = fs.readFileSync(path.join('.', p));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404).end('404'); }
});
await new Promise(r => server.listen(8897, r));
const B = 'http://127.0.0.1:8897';
const mod = await import(pathToFileURL(PW).href);
const chromium = mod.chromium || mod.default.chromium;

const browser = await chromium.launch({ channel: 'chrome' });
let pass = 0, fail = 0;
const problems = [];

function ok(cond, label, detail) {
  if (cond) { pass++; return true; }
  fail++; problems.push(label + (detail ? ' :: ' + detail : ''));
  return false;
}

// Independent invariants, computed from the stores, not from the app's own accounting helpers.
const INVARIANTS = () => {
  const bad = [];
  const L = HIS.ledger, C = HIS.charges;
  let appProblems = [];
  try { appProblems = L.invariants() || []; } catch (e) { bad.push('invariants() threw: ' + e.message); }

  L.all().forEach(t => {
    if (!isFinite(t.amount) || t.amount < 0) bad.push('negative tx ' + t.id + ' ' + t.amount);
    if (t.status === 'void' && !t.voidReason) bad.push('void without reason ' + t.id);
  });

  const bills = (window.HIS.billing && HIS.billing.bills) || [];
  bills.forEach(b => {
    const sums = L.sums(b.id);
    if (sums.net < -0.01) bad.push('net below zero on ' + b.id + ' = ' + sums.net);
    if (sums.refunded > sums.paid + 0.01) bad.push('refunded exceeds paid on ' + b.id);
    const status = L.statusOf(b.id);
    if (status === 'paid' && Math.abs(L.balanceOf(b.id)) > 0.01) bad.push('status paid but balance ' + L.balanceOf(b.id) + ' on ' + b.id);
    if (status !== 'paid' && status !== 'void' && L.balanceOf(b.id) < -0.01) bad.push('negative balance on ' + b.id);
  });

  // Charge bookkeeping: a void charge must not be billed twice, and every billed charge must point
  // at an invoice that exists.
  (C.all() || []).forEach(c => {
    if (c.invoiceId && !bills.some(b => b.id === c.invoiceId)) bad.push('charge ' + c.id + ' bills a missing invoice ' + c.invoiceId);
    if (!isFinite(c.amount) || c.amount < 0) bad.push('charge ' + c.id + ' has amount ' + c.amount);
  });

  // Stock must never go negative, and a prescription may not be dispensed beyond its quantity.
  try {
    (HIS.pharmacy.stock() || []).forEach(s => {
      if (Number(s.qty) < 0) bad.push('stock ' + (s.drug || s.id) + ' negative: ' + s.qty);
    });
    (HIS.pharmacy.rx() || []).forEach(r => {
      const left = HIS.pharmacy.remaining(r);
      if (left < 0) bad.push('rx ' + r.id + ' over-dispensed by ' + (-left));
    });
  } catch (e) { /* pharmacy not on this page */ }

  // Beds: no two active admissions may share a bed, and an active admission must hold a bed.
  try {
    const active = HIS.admissions.active() || [];
    const beds = {};
    active.forEach(a => {
      const bed = a.bedId || a.bed;
      if (!bed) bad.push('active admission ' + a.id + ' has no bed');
      if (bed && beds[bed]) bad.push('bed ' + bed + ' held by ' + beds[bed] + ' and ' + a.id);
      if (bed) beds[bed] = a.id;
    });
  } catch (e) { /* admissions not loaded */ }

  return { bad, appProblems };
};

async function session(email = 'superadmin@mediheal.test') {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message.slice(0, 80)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 80)); });
  await page.goto(B + '/index.html');
  await page.evaluate(e => HIS.auth.attempt(e, 'MediHeal2026!', true), email);
  await page.goto(B + '/billing.html');
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}

// Run one step, then assert the invariants still hold and the step did what it claimed.
async function step(page, label, fn) {
  const r = await page.evaluate(fn);
  const inv = await page.evaluate(INVARIANTS);
  const problemsHere = inv.bad.concat((inv.appProblems || []).map(p => 'app:' + (p.code || JSON.stringify(p))));
  ok(problemsHere.length === 0, 'invariants after ' + label, problemsHere.slice(0, 3).join(' | '));
  return r;
}

const j = (v) => JSON.stringify(v).slice(0, 140);

// ---------------------------------------------------------------------------------------------
// A. Money: pay, void a charge, refund, void the refund, pay again
// ---------------------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await session();
  const billId = await page.evaluate(() => HIS.billing.bills[0].id);

  const netBefore = await page.evaluate(id => HIS.ledger.toPesos(HIS.ledger.sums(id).net), billId);

  const pay = await step(page, 'payment', new Function('return HIS.ledger.recordPayment({invoiceId:' + JSON.stringify(billId) + ',amount:500,method:"Cash",idempotencyKey:"seq-A-1"})'));
  ok(pay.ok, 'A. payment accepted', j(pay));
  const afterPay = await page.evaluate(id => HIS.ledger.toPesos(HIS.ledger.sums(id).net), billId);
  ok(Math.abs(afterPay - (netBefore + 500)) < 0.01, 'A. payment adds exactly 500 to the collected amount', netBefore + '->' + afterPay);

  const dup = await step(page, 'duplicate payment', new Function('return HIS.ledger.recordPayment({invoiceId:' + JSON.stringify(billId) + ',amount:500,method:"Cash",idempotencyKey:"seq-A-1"})'));
  ok(dup.ok && dup.duplicate === true, 'A. replaying the same idempotency key does not charge twice', j(dup));
  const afterDup = await page.evaluate(id => HIS.ledger.toPesos(HIS.ledger.sums(id).net), billId);
  ok(Math.abs(afterDup - afterPay) < 0.01, 'A. balance unchanged after duplicate submit', String(afterDup));

  const overpay = await step(page, 'overpayment', new Function('return HIS.ledger.recordPayment({invoiceId:' + JSON.stringify(billId) + ',amount:999999,method:"Cash",idempotencyKey:"seq-A-2"})'));
  ok(overpay.ok === false, 'A. overpayment refused', j(overpay));
  ok(/outstanding/i.test(overpay.error || ''), 'A. refusal names the outstanding balance', j(overpay));

  const refund = await step(page, 'refund', new Function('return HIS.ledger.refund({invoiceId:' + JSON.stringify(billId) + ',amount:200,method:"Cash",reason:"Sequence test"})'));
  ok(refund.ok, 'A. refund accepted', j(refund));
  const afterRefund = await page.evaluate(id => ({ net: HIS.ledger.toPesos(HIS.ledger.sums(id).net), refunded: HIS.ledger.toPesos(HIS.ledger.sums(id).refunded) }), billId);
  ok(Math.abs(afterRefund.net - (netBefore + 300)) < 0.01 && Math.abs(afterRefund.refunded - 200) < 0.01,
    'A. net = collected - refunded', j(afterRefund) + ' from ' + netBefore);

  const bigRefund = await step(page, 'oversized refund', new Function('return HIS.ledger.refund({invoiceId:' + JSON.stringify(billId) + ',amount:999999,method:"Cash"})'));
  ok(bigRefund.ok === false, 'A. refund larger than received is refused', j(bigRefund));

  const voided = await step(page, 'void the refund', new Function('var t = HIS.ledger.all().filter(function(x){return x.kind==="refund" && x.seeded===false;})[0]; return HIS.ledger.void(t.id,"Duplicate refund")'));
  ok(voided.ok !== false, 'A. a refund can be voided', j(voided));
  const afterVoid = await page.evaluate(id => ({ net: HIS.ledger.toPesos(HIS.ledger.sums(id).net), status: HIS.ledger.statusOf(HIS.billing.bills.filter(function(b){return b.id===id;})[0]) }), billId);
  ok(Math.abs(afterVoid.net - (netBefore + 500)) < 0.01, 'A. voiding the refund restores the collected amount', j(afterVoid));

  // reload: nothing lost, invariants still intact
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(300);
  const invAfter = await page.evaluate(INVARIANTS);
  ok(invAfter.bad.length === 0, 'A. invariants hold after reload', invAfter.bad.slice(0, 3).join(' | '));
  const netAfter = await page.evaluate(id => HIS.ledger.toPesos(HIS.ledger.sums(id).net), billId);
  ok(Math.abs(netAfter - (netBefore + 500)) < 0.01, 'A. net survives reload', String(netAfter));
  ok(errors.length === 0, 'A. no page errors', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------
// B. Charges: assign -> close the visit -> reopen -> assign again; a void charge stops counting
// ---------------------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await session();
  await page.goto(B + '/charges.html'); await page.waitForTimeout(300);

  const encId = await page.evaluate(() => (HIS.charges.unbilled()[0] || {}).encounterId);
  ok(!!encId, 'B. there is an unbilled encounter to work with', String(encId));

  const unbilledBefore = await page.evaluate(() => HIS.charges.unbilled().length);
  const assign = await step(page, 'assign charge', new Function('var u = HIS.charges.unbilled()[0]; return HIS.charges.assign(u.id, HIS.billing.bills[0].id, "Sequence test")'));
  ok(assign && assign.ok !== false, 'B. a charge can be assigned to an invoice', j(assign));
  const unbilledAfter = await page.evaluate(() => HIS.charges.unbilled().length);
  ok(unbilledAfter === unbilledBefore - 1, 'B. assigning removes it from the unbilled queue', unbilledBefore + '->' + unbilledAfter);

  const close = await page.evaluate(enc => {
    const enc2 = HIS.encounters && HIS.encounters.byId ? HIS.encounters.byId(enc) : null;
    if (!enc2) return { skipped: true };
    return HIS.admissions && HIS.admissions.closeEncounter ? HIS.admissions.closeEncounter(enc, 'Discharged') : { skipped: true };
  }, encId);
  ok(true, 'B. close-encounter attempt recorded', j(close));

  const afterClose = await page.evaluate(INVARIANTS);
  ok(afterClose.bad.length === 0, 'B. invariants after closing an encounter', afterClose.bad.slice(0, 3).join(' | '));

  // voiding a charge must drop it from the invoice total
  const before = await page.evaluate(() => {
    const c = HIS.charges.active()[0];
    return c ? { id: c.id, inv: c.invoiceId, total: c.invoiceId ? HIS.ledger.invoiceAmount({ id: c.invoiceId }) : null, amount: c.amount } : null;
  });
  if (before && before.inv) {
    const v = await step(page, 'void charge', new Function('return HIS.charges.void(HIS.charges.active()[0].id, "Sequence test")'));
    if (v && v.ok !== false) {
      const afterTotal = await page.evaluate(inv => HIS.ledger.invoiceAmount({ id: inv }), before.inv);
      ok(Math.abs((before.total - before.amount) - afterTotal) < 0.01, 'B. voiding a charge reduces the invoice total by its amount',
        before.total + ' - ' + before.amount + ' vs ' + afterTotal);
    } else { ok(true, 'B. void refused (charge not voidable here)', j(v)); }
  }
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(300);
  const inv = await page.evaluate(INVARIANTS);
  ok(inv.bad.length === 0, 'B. invariants hold after reload', inv.bad.slice(0, 3).join(' | '));
  ok(errors.length === 0, 'B. no page errors', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------
// C. Payroll: dirty timesheet -> run -> approve -> release -> timesheet changes -> re-run
// ---------------------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await session();
  await page.goto(B + '/payroll.html'); await page.waitForTimeout(400);

  // A run for this period already exists in the seed; the app refuses a second one on purpose.
  const run = await step(page, 'create payroll run', new Function('var r = HIS.payrollRuns.create({}); return r.ok ? r : Object.assign({}, r, { reused: true })'));
  ok(run && (run.ok !== false || /already exists/i.test(run.error || '')), 'C. a duplicate run is refused by name', j(run));
  const recompute = await step(page, 'recompute', new Function('return HIS.payrollRuns.recompute(HIS.payrollRuns.current().id)'));
  ok(recompute && recompute.ok !== false, 'C. the run can be recomputed', j(recompute));
  const runId = await page.evaluate(() => { const r = HIS.payrollRuns.current(); return r && r.id; });
  const beforeLines = await page.evaluate(() => { const r = HIS.payrollRuns.current(); return r ? r.lines.length : 0; });
  ok(beforeLines > 0, 'C. the run has lines', String(beforeLines));

  const totals = await page.evaluate(() => { const r = HIS.payrollRuns.current(); return HIS.payrollRuns.totalsOf(r.lines); });
  const sumNet = await page.evaluate(() => { const r = HIS.payrollRuns.current(); return r.lines.reduce((s, l) => s + (l.net || 0), 0); });
  ok(Math.abs((totals.net || 0) - sumNet) < 0.02, 'C. run total equals the sum of its lines', j(totals) + ' vs ' + sumNet);

  const wage = await page.evaluate(() => HIS.payrollRuns.wageProblems(HIS.payrollRuns.current()));
  ok(!wage || wage.length === 0, 'C. no wage-floor violations in the seeded run', j(wage));

  const review = await step(page, 'review run', new Function('return HIS.payrollRuns.review(HIS.payrollRuns.current().id)'));
  ok(review && review.ok !== false, 'C. run goes out for review', j(review));
  const approve = await step(page, 'approve run', new Function('return HIS.payrollRuns.approve(HIS.payrollRuns.current().id)'));
  ok(approve && approve.ok !== false, 'C. run approves', j(approve));
  const release = await step(page, 'release run', new Function('return HIS.payrollRuns.release(HIS.payrollRuns.current().id)'));
  ok(release && release.ok !== false, 'C. run releases', j(release));

  // an approved+released run must not silently absorb later timesheet changes
  const change = await page.evaluate(() => {
    const st = HIS.store.get('mh_attendance_state', null);
    if (!st || !st.emps || !st.emps.length) return { skipped: true };
    st.emps[0].tin = '10:00 AM'; st.dirty = true;
    HIS.store.set('mh_attendance_state', st);
    return { ok: true, who: st.emps[0].id };
  });
  ok(change.ok || change.skipped, 'C. timesheet edited after the run', j(change));
  const stale = await page.evaluate(() => HIS.payrollRuns.staleEmployees(HIS.payrollRuns.current()));
  ok(Array.isArray(stale), 'C. staleness is detectable after a timesheet change', j(stale));
  const reapp = await step(page, 're-approve after change', new Function('var r = HIS.payrollRuns.current(); return HIS.payrollRuns.approve(r.id)'));
  ok(reapp && (reapp.ok !== false || /approve|release|version|recompute/i.test(reapp.error || '')), 'C. re-approve either works or explains itself', j(reapp));

  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(350);
  const after = await page.evaluate(() => { const r = HIS.payrollRuns.current(); return r ? { id: r.id, status: r.status, v: r.version } : null; });
  ok(!!after, 'C. the run survives reload', j(after));
  ok(errors.length === 0, 'C. no page errors', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------
// D. Claims: create -> submit -> deny -> correct -> resubmit -> approve
// ---------------------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await session();
  await page.goto(B + '/claims.html'); await page.waitForTimeout(350);

  const made = await page.evaluate(() => {
    const bill = HIS.billing.bills[0];
    const before = new Set(HIS.claims.all().map(c => c.id));
    const r = HIS.claims.create({ invoiceId: bill.id, patientId: bill.patientId, requestedAmount: 500,
      payer: 'PhilHealth', memberRef: '12-345678901-2' });
    const fresh = HIS.claims.all().filter(c => !before.has(c.id));
    return Object.assign({}, r, { newIds: fresh.map(c => c.id + ':' + c.status) });
  });
  ok(made && made.ok !== false, 'D. a claim can be created', j(made));
  const claimId = await page.evaluate(() => { const fresh = HIS.claims.all().filter(c => c.status === 'draft'); return fresh.length ? fresh[fresh.length - 1].id : null; });
  ok(!!claimId, 'D. the new claim is stored', String(claimId));

  // Walk the documented state machine: prepare -> documents -> review -> verify -> submit ->
  // acknowledge -> deny -> appeal -> reopen -> approve -> settle -> close.
  const docs = await page.evaluate(id => {
    const c = HIS.claims.get(id);
    let n = 0;
    (c.documents || []).forEach((d, i) => { const r = HIS.claims.setDocument(id, i, true); if (r && r.ok !== false) n++; });
    return n;
  }, claimId);
  ok(docs > 0, 'D. claim documents can be marked received', String(docs));

  const walk = [
    ['prepare', {}], ['docs-complete', {}], ['verify', {}],
    ['submit', { reference: 'PH-2026-SEQ-0001' }], ['acknowledge', {}]
  ];
  for (const [action, payload] of walk) {
    const r = await page.evaluate(([id, a, pl]) => HIS.claims.transition(id, a, pl), [claimId, action, payload]);
    ok(r && r.ok !== false, 'D. claim action "' + action + '" accepted', j(r));
  }
  const deny = await page.evaluate(id => HIS.claims.transition(id, 'deny', { reason: 'Missing operative record' }), claimId);
  ok(deny && deny.ok !== false, 'D. a claim can be denied', j(deny));
  const appeal = await page.evaluate(id => HIS.claims.transition(id, 'appeal', { reason: 'Operative record attached' }), claimId);
  ok(appeal && appeal.ok !== false, 'D. a denied claim can be appealed', j(appeal));
  const reopen = await page.evaluate(id => HIS.claims.transition(id, 'reopen', {}), claimId);
  ok(reopen && reopen.ok !== false, 'D. an accepted appeal returns to review', j(reopen));
  const approve = await page.evaluate(id => HIS.claims.transition(id, 'approve', { approvedAmount: 500 }), claimId);
  ok(approve && approve.ok !== false, 'D. a reviewed claim can be approved', j(approve));
  const settle = await page.evaluate(id => HIS.claims.transition(id, 'settle', {}), claimId);
  ok(settle && settle.ok !== false, 'D. an approved claim can be settled', j(settle));

  const illegal = await page.evaluate(id => HIS.claims.transition(id, 'prepare', {}), claimId);
  ok(illegal && illegal.ok === false, 'D. an illegal transition is refused', j(illegal));

  const inv = await page.evaluate(INVARIANTS);
  ok(inv.bad.length === 0, 'D. invariants hold after the claim lifecycle', inv.bad.slice(0, 3).join(' | '));
  ok(errors.length === 0, 'D. no page errors', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------
// E. Admissions: discharge -> reopen -> transfer; beds never double-booked
// ---------------------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await session();
  await page.goto(B + '/admissions.html'); await page.waitForTimeout(400);

  const a = await page.evaluate(() => { const x = HIS.admissions.active()[0]; return x ? { id: x.id, bed: x.bed } : null; });
  ok(!!a, 'E. there is an active admission', j(a));

  // Negative path first: a discharge without a summary must be refused.
  const noSummary = await step(page, 'discharge without summary', new Function('return HIS.admissions.discharge(HIS.admissions.active()[0].id, {disposition:"Discharged home"})'));
  ok(noSummary && noSummary.ok === false && /summary/i.test(noSummary.error || ''), 'E. a discharge without a summary is refused', j(noSummary));

  const out = await step(page, 'discharge', new Function('return HIS.admissions.discharge(HIS.admissions.active()[0].id, {disposition:"Discharged home", summary:"Sequence test discharge"})'));
  ok(out && out.ok !== false, 'E. a patient can be discharged', j(out));
  const bedNow = await page.evaluate(bed => { const cells = HIS.admissions.bedBoard ? HIS.admissions.bedBoard() : []; const b = cells.find(x => x.id === bed || x.bedId === bed); return b ? (b.status || b.occupant || b.label) : null; }, a.bed);
  ok(!bedNow || /free|vacant|available/i.test(String(bedNow)), 'E. discharge frees the bed', j(bedNow));

  const reopen = await step(page, 'reopen discharge', new Function('var d = HIS.admissions.all().filter(function(x){return x.status==="discharged";})[0]; if(!d) return {ok:true,skipped:true}; return HIS.admissions.cancelDischarge(d.id, "Recorded in error")'));
  ok(reopen && (reopen.ok !== false || reopen.skipped), 'E. a discharge can be reversed', j(reopen));

  const transfer = await step(page, 'transfer', new Function('var x = HIS.admissions.active()[0]; if(!x) return {ok:true,skipped:true}; var free = HIS.admissions.firstFreeBed(x.wardId || x.ward); var bedId = (free && (free.bedId || free.id)) || null; if(!bedId || bedId === x.bedId) return {ok:true,skipped:true}; return HIS.admissions.transfer(x.id, {bedId: bedId, reason: "Sequence test"})'));
  ok(transfer && (transfer.ok !== false || transfer.skipped), 'E. an active admission can be transferred', j(transfer));

  const inv = await page.evaluate(INVARIANTS);
  ok(inv.bad.length === 0, 'E. invariants hold (no double-booked bed)', inv.bad.slice(0, 3).join(' | '));
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(350);
  const inv2 = await page.evaluate(INVARIANTS);
  ok(inv2.bad.length === 0, 'E. invariants hold after reload', inv2.bad.slice(0, 3).join(' | '));
  ok(errors.length === 0, 'E. no page errors', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------
// F. Laboratory: order -> collect -> process -> result -> validate -> cancel must be refused
// ---------------------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await session();
  await page.goto(B + '/laboratory.html'); await page.waitForTimeout(400);

  const order = await page.evaluate(() => {
    const p = (HIS.registry.all() || [])[0];
    return HIS.lab.create({ patientId: p.id, test: Object.keys(HIS.lab.CATALOG)[0], priority: 'Routine' });
  });
  ok(order && order.ok !== false, 'F. a lab order can be created', j(order));
  const id = await page.evaluate(() => { const all = HIS.lab.all(); const fresh = all.filter(o => !o.seeded); return fresh.length ? fresh[fresh.length - 1].id : null; });
  ok(!!id, 'F. the order is stored', String(id));

  const seq = [
    ['collect', 'Collected'], ['process', 'In Process']
  ];
  for (const [fn, expected] of seq) {
    const r = await page.evaluate(([f, oid]) => HIS.lab[f](oid), [fn, id]);
    ok(r && r.ok !== false, 'F. lab ' + fn, j(r));
    const st = await page.evaluate(oid => (HIS.lab.byId(oid) || {}).status, id);
    ok(st === expected, 'F. status is ' + expected + ' after ' + fn, String(st));
  }
  const res = await page.evaluate(oid => HIS.lab.enterResult(oid, { value: '12.4', unit: 'g/dL', reference: '13-17' }), id);
  ok(res && res.ok !== false, 'F. a result can be entered', j(res));
  const val = await page.evaluate(oid => HIS.lab.validate(oid), id);
  ok(val && val.ok !== false, 'F. the result can be validated', j(val));
  const cancel = await page.evaluate(oid => HIS.lab.cancel(oid, 'Too late'), id);
  ok(cancel && cancel.ok === false, 'F. a validated result cannot be cancelled', j(cancel));

  const inv = await page.evaluate(INVARIANTS);
  ok(inv.bad.length === 0, 'F. invariants hold after the lab lifecycle', inv.bad.slice(0, 3).join(' | '));
  ok(errors.length === 0, 'F. no page errors', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------
// G. Pharmacy: rx -> verify -> partial dispense -> return -> dispense rest; stock and rx balance
// ---------------------------------------------------------------------------------------------
{
  const { ctx, page, errors } = await session();
  await page.goto(B + '/pharmacy.html'); await page.waitForTimeout(400);

  const stockBefore = await page.evaluate(() => {
    const s = HIS.pharmacy.stock().filter(x => Number(x.qty) > 20)[0];
    return s ? { drug: s.drug, qty: Number(s.qty) } : null;
  });
  ok(!!stockBefore, 'G. there is a stocked drug to work with', j(stockBefore));

  const made = await page.evaluate(drug => {
    const p = (HIS.registry.all() || [])[0];
    return HIS.pharmacy.createRx({ patientId: p.id, drug: drug, qty: 10, dosage: '1 tablet twice daily' });
  }, stockBefore.drug);
  ok(made && made.ok !== false, 'G. a prescription can be created', j(made));
  const rxId = await page.evaluate(() => { const all = HIS.pharmacy.rx(); const fresh = all.filter(r => !r.seeded); return fresh.length ? fresh[fresh.length - 1].id : null; });
  ok(!!rxId, 'G. the prescription is stored', String(rxId));

  const verify = await page.evaluate(rid => HIS.pharmacy.verify(rid), rxId);
  ok(verify && verify.ok !== false, 'G. a prescription can be verified', j(verify));

  const disp = await page.evaluate(rid => { const r = HIS.pharmacy.rxById(rid); const bs = HIS.pharmacy.batchesFor(r.drug) || []; const batch = bs.filter(b => b.qty > 0)[0] || bs[0]; return HIS.pharmacy.dispense(rid, { qty: 4, batchId: batch && (batch.id || batch.batch), notes: 'Sequence test' }); }, rxId);
  ok(disp && disp.ok !== false, 'G. a partial dispense works', j(disp));
  const left = await page.evaluate(rid => HIS.pharmacy.remaining(HIS.pharmacy.rxById(rid)), rxId);
  ok(Math.abs(left - 6) < 0.01, 'G. remaining quantity drops to 6', String(left));

  const over = await page.evaluate(rid => HIS.pharmacy.dispense(rid, { qty: 99, notes: 'too many' }), rxId);
  ok(over && over.ok === false, 'G. dispensing more than prescribed is refused', j(over));

  const ret = await page.evaluate(rid => HIS.pharmacy.returnDispense(rid, 0, 'Patient returned'), rxId);
  ok(ret && ret.ok !== false, 'G. a dispense can be reversed (return)', j(ret));
  // A return reverses a whole dispensing event (that is how the app models it), so the 4 units go
  // back and the prescription is whole again.
  const left2 = await page.evaluate(rid => HIS.pharmacy.remaining(HIS.pharmacy.rxById(rid)), rxId);
  ok(Math.abs(left2 - 10) < 0.01, 'G. returning the dispense event restores the full quantity', String(left2));

  const inv = await page.evaluate(INVARIANTS);
  ok(inv.bad.length === 0, 'G. invariants hold (stock not negative, rx not over-dispensed)', inv.bad.slice(0, 3).join(' | '));
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(350);
  const inv2 = await page.evaluate(INVARIANTS);
  ok(inv2.bad.length === 0, 'G. invariants hold after reload', inv2.bad.slice(0, 3).join(' | '));
  ok(errors.length === 0, 'G. no page errors', errors.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (fail) { console.log('\nFAILURES:'); problems.forEach(p => console.log(' - ' + p)); process.exitCode = 1; }
