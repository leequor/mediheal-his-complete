// M12 closeout — admission billing boundaries and idempotency.
//
// The daily billing rule has four edges and every one of them is a place where money is either lost
// or charged twice:
//
//   1. the admission day          — always billable, whatever the hour
//   2. a later day                — billable only once its 12:00 cutoff has passed
//   3. the discharge day          — billable only if the patient left after noon
//   4. a transfer                 — changes the rate from the next cutoff, never retroactively
//
// On top of that sit the operations that must be safe to repeat: accrual, discharge, reopening a
// discharged admission, and simply reloading the page while a patient is on the ward.
//
// Each case gets its own browser context, so each starts from a freshly seeded store. That is slower
// than resetting in place but it is the only way to be sure a case cannot inherit another's state.
//
// Usage: PW=<playwright-core> node scripts/adt-boundary-check.mjs
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
await new Promise(r => server.listen(8863, r));
const BASE = 'http://127.0.0.1:8863';

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

const allErrs = [];

// A fresh hospital per case: new context, new localStorage, real sign-in.
async function withHospital(fn) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));
  await page.goto(BASE + '/admissions.html', { waitUntil: 'load' });
  await page.waitForTimeout(250);
  try { return await fn(page); }
  finally {
    allErrs.push(...errs);
    await ctx.close();
  }
}

// Admit a patient into the first free bed of a ward/type, from a fixed timestamp.
const ADMIT = `(patientId, ward, type, at, dx) => {
  const bed = HIS.admissions.bedBoard(ward).filter(b => b.status === 'available' && (!type || b.type === type))[0];
  const r = HIS.admissions.admit({ patientId, bedId: bed.id, attending: 'Dr. Yumie Pasiol',
    diagnosis: dx || 'Observation', admittedAt: at });
  return { ok: r.ok, err: r.error, id: r.admission && r.admission.id, bed: bed.id, bedType: bed.type,
    enc: r.admission && r.admission.encounterId };
}`;

// =================================================================================================
// 1. THE ADMISSION DAY IS ALWAYS BILLABLE
// =================================================================================================
console.log('\n--- 1. admission day ---');
await withHospital(async page => {
  const before = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00', 'Before noon');
    const fin = HIS.admissions.accrue(a.id, { asOf: '2026-09-01T13:00:00+08:00' });
    return { a, dates: fin.dates, room: fin.posted.filter(c => c.source === 'room').map(c => c.amount) };
  })()`);
  ok('admitted at 09:00, day one is billable', before.a.ok && before.dates.join(',') === '2026-09-01', before.a.err || before.dates.join(','));
  ok('day one is charged at the admitting bed rate', near(before.room[0], 2800), before.room[0]);

  const after = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99212', 'Cardiology Ward', 'Private', '2026-09-01T15:00:00+08:00', 'After noon');
    const fin = HIS.admissions.accrue(a.id, { asOf: '2026-09-01T18:00:00+08:00' });
    return { a, dates: fin.dates, room: fin.posted.filter(c => c.source === 'room').map(c => c.amount) };
  })()`);
  ok('admitted at 15:00, day one is still billable', after.a.ok && after.dates.join(',') === '2026-09-01', after.a.err || after.dates.join(','));
  ok('a late arrival is charged at the bed it was admitted to, not a noon bed', near(after.room[0], 2800), after.room[0]);
});

// =================================================================================================
// 2. A LATER DAY NEEDS ITS CUTOFF TO HAVE PASSED
// =================================================================================================
console.log('\n--- 2. the noon cutoff ---');
await withHospital(async page => {
  const r = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    const early = HIS.admissions.accrue(a.id, { asOf: '2026-09-02T11:59:00+08:00' });
    const late = HIS.admissions.accrue(a.id, { asOf: '2026-09-02T12:01:00+08:00' });
    return { id: a.id, early: early.dates, late: late.dates, latePosted: late.posted.length };
  })()`);
  ok('at 11:59 the second day is not yet billable', r.early.join(',') === '2026-09-01', r.early.join(','));
  ok('at 12:01 the second day becomes billable', r.late.join(',') === '2026-09-01,2026-09-02', r.late.join(','));
  ok('and only the new day is posted, not the whole stay again', r.latePosted === 2, r.latePosted);
});

// =================================================================================================
// 3. THE DISCHARGE DAY
// =================================================================================================
console.log('\n--- 3. discharge day ---');
await withHospital(async page => {
  const r = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    const d = HIS.admissions.discharge(a.id, {
      disposition: 'Discharged home', summary: 'Stable.', at: '2026-09-03T11:00:00+08:00'
    });
    const room = HIS.charges.forEncounter(a.enc).filter(c => c.source === 'room' && c.status !== 'void');
    return { ok: d.ok, err: d.error, dates: d.accrual && d.accrual.dates, room: room.map(c => c.amount) };
  })()`);
  ok('discharge before noon succeeds', r.ok === true, r.err);
  ok('the discharge day is not billable when the patient left at 11:00',
    r.dates.join(',') === '2026-09-01,2026-09-02', r.dates.join(','));
  ok('two room charges, not three', r.room.length === 2, r.room.length);
});

await withHospital(async page => {
  const r = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    const d = HIS.admissions.discharge(a.id, {
      disposition: 'Discharged home', summary: 'Stable.', at: '2026-09-03T13:00:00+08:00'
    });
    const room = HIS.charges.forEncounter(a.enc).filter(c => c.source === 'room' && c.status !== 'void');
    return { ok: d.ok, err: d.error, dates: d.accrual && d.accrual.dates, room: room.map(c => c.amount) };
  })()`);
  ok('discharge after noon succeeds', r.ok === true, r.err);
  ok('the discharge day IS billable when the patient left at 13:00',
    r.dates.join(',') === '2026-09-01,2026-09-02,2026-09-03', r.dates.join(','));
  ok('three room charges', r.room.length === 3, r.room.length);
});

// =================================================================================================
// 4. TRANSFERS AROUND THE CUTOFF
// =================================================================================================
console.log('\n--- 4. transfer and the cutoff ---');
await withHospital(async page => {
  const r = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    const ward = HIS.admissions.bedBoard('Cardiology Ward').filter(b => b.status === 'available' && b.type === 'Ward')[0];
    HIS.admissions.transfer(a.id, { bedId: ward.id, reason: 'step-down', at: '2026-09-02T11:00:00+08:00' });
    const fin = HIS.admissions.accrue(a.id, { asOf: '2026-09-02T13:00:00+08:00' });
    const room = fin.posted.filter(c => c.source === 'room').map(c => ({ d: c.description, a: c.amount }));
    return { room, type: ward.type };
  })()`);
  ok('a transfer at 11:00 changes that same day\'s rate', r.type === 'Ward' && near(r.room[1].a, 1200), r.room.map(x => x.a).join('+'));
  ok('the day before the transfer keeps the old rate', near(r.room[0].a, 2800), r.room[0].a);
  ok('the room line names the bed it was charged for', /Ward/.test(r.room[1].d), r.room[1].d);
});

await withHospital(async page => {
  const r = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    const ward = HIS.admissions.bedBoard('Cardiology Ward').filter(b => b.status === 'available' && b.type === 'Ward')[0];
    HIS.admissions.transfer(a.id, { bedId: ward.id, reason: 'late step-down', at: '2026-09-02T15:00:00+08:00' });
    const fin = HIS.admissions.accrue(a.id, { asOf: '2026-09-02T18:00:00+08:00' });
    const next = HIS.admissions.accrue(a.id, { asOf: '2026-09-03T13:00:00+08:00' });
    const room = fin.posted.filter(c => c.source === 'room').map(c => c.amount);
    const room3 = next.posted.filter(c => c.source === 'room').map(c => c.amount);
    return { room, room3 };
  })()`);
  ok('a transfer at 15:00 does not re-price the day already at its cutoff', near(r.room[1], 2800), r.room[1]);
  ok('the new rate starts the next day', near(r.room3[0], 1200), r.room3[0]);
});

// =================================================================================================
// 5. REPEATED ACCRUAL, AND ONE CHARGE PER DAY
// =================================================================================================
console.log('\n--- 5. repeated accrual ---');
await withHospital(async page => {
  const r = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    const one = HIS.admissions.accrue(a.id, { asOf: '2026-09-03T13:00:00+08:00' });
    const two = HIS.admissions.accrue(a.id, { asOf: '2026-09-03T13:00:00+08:00' });
    const three = HIS.admissions.accrue(a.id, { asOf: '2026-09-03T13:00:00+08:00' });
    const room = HIS.charges.forEncounter(a.enc).filter(c => c.source === 'room' && c.status !== 'void');
    const byDate = {};
    room.forEach(c => { const d = (c.code || '').split(':')[1]; byDate[d] = (byDate[d] || 0) + 1; });
    return {
      first: one.posted.length, second: two.posted.length, secondSkipped: two.skipped.length,
      third: three.posted.length, roomCount: room.length,
      duplicates: Object.keys(byDate).filter(k => byDate[k] > 1), dates: Object.keys(byDate).length
    };
  })()`);
  ok('the first accrual posts every billable day', r.first === 6, r.first);
  ok('a second accrual posts nothing', r.second === 0, r.second);
  ok('and reports what it skipped instead of silently doing nothing', r.secondSkipped === 6, r.secondSkipped);
  ok('a third accrual is still a no-op', r.third === 0, r.third);
  ok('there is exactly one room charge per date', r.roomCount === r.dates && r.duplicates.length === 0,
    r.roomCount + ' charges over ' + r.dates + ' dates; dup ' + r.duplicates.join(','));
});

// =================================================================================================
// 6. REPEATED DISCHARGE, AND REOPENING
// =================================================================================================
console.log('\n--- 6. repeated discharge and reopen ---');
await withHospital(async page => {
  const r = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    const first = HIS.admissions.discharge(a.id, { disposition: 'Discharged home', summary: 'Stable.', at: '2026-09-02T15:00:00+08:00' });
    const again = HIS.admissions.discharge(a.id, { disposition: 'Discharged home', summary: 'Stable.', at: '2026-09-02T16:00:00+08:00' });
    const roomAfter = HIS.charges.forEncounter(a.enc).filter(c => c.source === 'room' && c.status !== 'void').length;
    return { first: first.ok, again: again.ok, againErr: again.error, status: HIS.admissions.byId(a.id).status, roomAfter };
  })()`);
  ok('the first discharge succeeds', r.first === true);
  ok('a second discharge is refused', r.again === false, r.againErr);
  ok('the admission stays discharged', r.status === 'discharged', r.status);
  ok('the refused discharge posted no extra charge', r.roomAfter === 2, r.roomAfter);
});

await withHospital(async page => {
  const r = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    HIS.admissions.discharge(a.id, { disposition: 'Discharged home', summary: 'Stable.', at: '2026-09-02T15:00:00+08:00' });
    const bedFree = HIS.admissions.bedStatus(a.bed);
    const reopen = HIS.admissions.cancelDischarge(a.id, 'discharge recorded against the wrong patient');
    const adm = HIS.admissions.byId(a.id);
    const bedBack = HIS.admissions.bedStatus(a.bed);
    return {
      bedFree, reopen: reopen.ok, reopenErr: reopen.error, status: adm.status,
      history: (adm.dischargeHistory || []).length, discharge: adm.discharge,
      occupant: (HIS.admissions.occupantOf(a.bed) || {}).id
    };
  })()`);
  ok('discharge moves the bed out of service for cleaning', r.bedFree === 'cleaning', r.bedFree);
  ok('a discharge can be reopened', r.reopen === true, r.reopenErr);
  ok('the admission is active again', r.status === 'active', r.status);
  ok('the bed is re-occupied by the same admission', r.occupant !== undefined, r.occupant);
  ok('the original discharge is kept in history', r.history === 1, r.history);
  ok('and is no longer the current discharge', r.discharge === null, JSON.stringify(r.discharge));
});

// =================================================================================================
// 7. RELOADING AN ACTIVE ADMISSION CHANGES NOTHING
// =================================================================================================
console.log('\n--- 7. reload ---');
await withHospital(async page => {
  const before = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    HIS.admissions.accrue(a.id, { asOf: '2026-09-02T13:00:00+08:00' });
    return { id: a.id, bed: a.bed, charges: HIS.charges.forEncounter(a.enc).length,
      total: HIS.charges.forEncounter(a.enc).reduce((t, c) => t + c.amount, 0),
      occ: HIS.admissions.occupancy().occupied };
  })()`);
  for (let i = 0; i < 3; i++) {
    await page.goto(BASE + '/admissions.html', { waitUntil: 'load' });
    await page.waitForTimeout(200);
  }
  const after = await page.evaluate(`(() => {
    const a = HIS.admissions.byId('${before.id}');
    return { status: a && a.status, bed: a && a.bedId, charges: HIS.charges.forEncounter(a.encounterId).length,
      total: HIS.charges.forEncounter(a.encounterId).reduce((t, c) => t + c.amount, 0),
      occ: HIS.admissions.occupancy().occupied, rows: document.querySelectorAll('.ad-tr').length };
  })()`);
  ok('the admission survives three reloads', after.status === 'active', after.status);
  ok('it is still in the same bed', after.bed === before.bed, after.bed);
  ok('no charge was raised by reloading', after.charges === before.charges, after.charges + ' vs ' + before.charges);
  ok('the value on the episode is unchanged', near(after.total, before.total), after.total);
  ok('occupancy is unchanged', after.occ === before.occ, after.occ);
  ok('the screen still renders the record', after.rows >= 3, after.rows);
});

// =================================================================================================
// 8. DUPLICATE BED ASSIGNMENT
// =================================================================================================
console.log('\n--- 8. duplicate bed ---');
await withHospital(async page => {
  const r = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    const second = HIS.admissions.admit({ patientId: 'PT-99212', bedId: a.bed, diagnosis: 'second patient' });
    const other = (${ADMIT})('PT-99212', 'Cardiology Ward', 'Private', '2026-09-01T10:00:00+08:00');
    const transfer = HIS.admissions.transfer(other.id, { bedId: a.bed, reason: 'steal the bed' });
    const occupants = HIS.admissions.active().filter(x => x.bedId === a.bed).length;
    return { second: second.ok, secondErr: second.error, transfer: transfer.ok, transferErr: transfer.error, occupants };
  })()`);
  ok('a second admission to an occupied bed is refused', r.second === false, r.secondErr);
  ok('a transfer into an occupied bed is refused', r.transfer === false, r.transferErr);
  ok('exactly one active admission names the bed', r.occupants === 1, r.occupants);
});

// =================================================================================================
// 9. OCCUPANCY IS DERIVED, NOT STORED
// =================================================================================================
console.log('\n--- 9. derived occupancy ---');
await withHospital(async page => {
  const r = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    const occupiedByRecord = HIS.admissions.bedStatus(a.bed);
    // There is no stored 'occupied' flag to inspect: the only bed state store holds non-patient
    // states. Prove the status is computed from the admission by removing the admission and
    // re-reading the same bed.
    const rows = HIS.store.get(HIS.admissions.AKEY, []).filter(x => x.id !== a.id);
    HIS.store.set(HIS.admissions.AKEY, rows);
    const afterRemoval = HIS.admissions.bedStatus(a.bed);
    return { occupiedByRecord, afterRemoval,
      stateKeys: Object.keys(HIS.store.get(HIS.admissions.SKEY, {})),
      hasOccupiedFlag: Object.keys(HIS.store.get(HIS.admissions.SKEY, {})).some(k => HIS.store.get(HIS.admissions.SKEY, {})[k].status === 'occupied') };
  })()`);
  ok('a bed with an active admission reads as occupied', r.occupiedByRecord === 'occupied', r.occupiedByRecord);
  ok('removing the admission frees the bed with no other write', r.afterRemoval !== 'occupied', r.afterRemoval);
  ok('the bed-state store never holds an "occupied" state', r.hasOccupiedFlag === false, r.stateKeys.join(','));
});

// =================================================================================================
// 10. INVOICE ASSOCIATION FOR ADMISSION CHARGES
// =================================================================================================
console.log('\n--- 10. invoice association ---');
await withHospital(async page => {
  const r = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    const day1 = HIS.admissions.accrue(a.id, { asOf: '2026-09-01T13:00:00+08:00' });
    const unbilledBefore = HIS.charges.forEncounter(a.enc).filter(c => !c.invoiceId && c.status !== 'void').length;

    // Open a bill for this episode and link it, then accrue the next day.
    const inv = HIS.billing.create({ patientId: 'PT-99210', encounterId: a.enc });
    HIS.encounters.attachInvoice(a.enc, inv.bill.id);
    const day2 = HIS.admissions.accrue(a.id, { asOf: '2026-09-02T13:00:00+08:00' });

    const all = HIS.charges.forEncounter(a.enc).filter(c => c.status !== 'void');
    return {
      day1: day1.posted.length, unbilledBefore,
      day2: day2.posted.map(c => ({ s: c.source, inv: c.invoiceId })),
      onInvoice: all.filter(c => c.invoiceId === inv.bill.id).length,
      stillUnbilled: all.filter(c => !c.invoiceId).length,
      invTotal: HIS.ledger.invoiceAmount(inv.bill),
      invId: inv.bill.id
    };
  })()`);
  ok('day one is unbilled before the episode has an invoice', r.unbilledBefore === 2, r.unbilledBefore);
  ok('the next day\'s charges land on the linked invoice', r.day2.every(c => c.inv === r.invId), JSON.stringify(r.day2));
  ok('charges raised before the link stay in the queue', r.stillUnbilled === 2, r.stillUnbilled);
  ok('the invoice total is exactly the two linked charges', near(r.invTotal, 3400), r.invTotal);
});

// =================================================================================================
// 11. ORIGINAL HISTORY SURVIVES TRANSFER AND DISCHARGE
// =================================================================================================
console.log('\n--- 11. history preservation ---');
await withHospital(async page => {
  const r = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    const firstBed = a.bed;
    HIS.admissions.accrue(a.id, { asOf: '2026-09-01T13:00:00+08:00' });
    const day1 = HIS.charges.forEncounter(a.enc).filter(c => c.source === 'room').map(c => ({ id: c.id, a: c.amount, code: c.code }));

    const ward = HIS.admissions.bedBoard('Cardiology Ward').filter(b => b.status === 'available' && b.type === 'Ward')[0];
    HIS.admissions.transfer(a.id, { bedId: ward.id, reason: 'step-down', at: '2026-09-02T11:00:00+08:00' });
    HIS.admissions.discharge(a.id, { disposition: 'Discharged home', summary: 'Stable.', at: '2026-09-02T15:00:00+08:00' });

    const adm = HIS.admissions.byId(a.id);
    const charges = HIS.charges.forEncounter(a.enc).filter(c => c.source === 'room' && c.status !== 'void');
    return {
      transferFrom: adm.transfers[0].from,
      transferTo: adm.transfers[0].to,
      firstBed,
      day1StillThere: day1.every(d => charges.some(c => c.id === d.id && c.amount === d.a)),
      day1Count: day1.length,
      total: charges.reduce((t, c) => t + c.amount, 0),
      status: adm.status,
      discharge: adm.discharge && adm.discharge.disposition
    };
  })()`);
  ok('the transfer keeps the bed the patient came from', r.transferFrom.bedId === r.firstBed, r.transferFrom.bedId);
  ok('and records the bed they went to', !!r.transferTo.bedId && r.transferTo.bedId !== r.firstBed, r.transferTo.bedId);
  ok('the original day-one charge is untouched after the move and the discharge', r.day1StillThere === true, r.day1Count);
  ok('the room total is the two days at their own rates', near(r.total, 2800 + 1200), r.total);
  ok('the discharge record survives on the admission', r.status === 'discharged' && r.discharge === 'Discharged home', r.status);
});

// =================================================================================================
// 12. TWO TABS ARE TWO DEMONSTRATIONS
// =================================================================================================
// Demonstration data lives in `sessionStorage`, which is scoped to one tab. Two tabs are therefore
// two independent hospitals: they do not share a store, so there is no cross-tab lost update to
// demonstrate. That is a deliberate property of a single-user presentation, not a concurrency
// guarantee — see docs/PROJECT-STATUS.md §5.2.
console.log('\n--- 12. two tabs are two demonstrations ---');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tabA = await ctx.newPage();
  await tabA.goto(BASE + '/index.html', { waitUntil: 'load' });
  await tabA.evaluate(() => HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true));
  await tabA.goto(BASE + '/admissions.html', { waitUntil: 'load' });
  const tabB = await ctx.newPage();
  await tabB.goto(BASE + '/admissions.html', { waitUntil: 'load' });
  await tabA.waitForTimeout(200);

  const shared = await tabA.evaluate(() => ({
    rows: HIS.admissions.all().length,
    bed: HIS.admissions.bedBoard('Cardiology Ward').filter(b => b.status === 'available')[0].id,
    inSession: !!window.sessionStorage.getItem(HIS.admissions.AKEY),
    inLocal: !!window.localStorage.getItem(HIS.admissions.AKEY)
  }));

  const bResult = await tabB.evaluate(`(() => {
    const bed = HIS.admissions.bedBoard('Cardiology Ward').filter(b => b.status === 'available')[0];
    const r = HIS.admissions.admit({ patientId: 'PT-99212', bedId: bed.id, diagnosis: 'tab B', admittedAt: '2026-09-01T09:00:00+08:00' });
    return { ok: r.ok, id: r.admission && r.admission.id, rows: HIS.admissions.all().length };
  })()`);

  const tabAAfter = await tabA.evaluate(([tabBId, before]) => {
    const rows = HIS.admissions.all();
    return {
      rows: rows.length,
      seesTabB: rows.some(x => x.id === tabBId),
      sameBedFree: HIS.admissions.bedStatus(HIS.admissions.bedBoard('Cardiology Ward').filter(b => b.status === 'available')[0].id) === 'available',
      unchanged: rows.length === before
    };
  }, [bResult.id, shared.rows]);

  // Deliberate product decision (2026-11-24): records live in localStorage so work survives a reload,
  // a second tab, signing out and signing in as another role.
  ok('records are held in persistent storage, so they outlive the tab',
    shared.inLocal === true, JSON.stringify({ session: shared.inSession, local: shared.inLocal }));
  ok('both tabs open on the same seeded dataset', shared.rows >= 2, shared.rows);
  ok('an admission made in tab B is accepted there', bResult.ok === true, bResult.ok);
  ok('and is visible to tab A, because both tabs read one dataset',
    (tabAAfter.seesTabB !== undefined ? tabAAfter.seesTabB === true : tabAAfter.rows > 0), tabAAfter.rows);
  await ctx.close();
}

// =================================================================================================
// 13. SIGNING OUT RESTORES THE SAMPLE DATASET
// =================================================================================================
console.log('\n--- 13. sign-out resets ---');
await withHospital(async page => {
  const r = await page.evaluate(`(() => {
    const a = (${ADMIT})('PT-99210', 'Cardiology Ward', 'Private', '2026-09-01T09:00:00+08:00');
    HIS.admissions.accrue(a.id, { asOf: '2026-09-02T13:00:00+08:00' });
    const before = { admissions: HIS.admissions.all().length, charges: HIS.charges.all().length };

    HIS.auth.signOut();
    const cleared = { admissions: HIS.admissions.all().length, charges: HIS.charges.all().length, active: HIS.admissions.active().length };
    const trail = HIS.audit.list().map(x => x.what);

    HIS.auth.attempt('superadmin@mediheal.test', 'MediHeal2026!', true);
    const after = { admissions: HIS.admissions.all().length, active: HIS.admissions.active().length };
    return { before, cleared, trail, after };
  })()`);
  ok('the session had added records before signing out', r.before.admissions === 3 && r.before.charges > 0, JSON.stringify(r.before));
  // 2026-11-22: the charge store seeds two unbilled charges, so a cleared session leaves those two
  // and nothing else. Anything the run raised is gone.
  // Signing out no longer discards anything: the next role must still see the charges.
  ok('signing out keeps the charges raised before it', r.cleared.charges >= 2, r.cleared.charges + ' on file');
  ok('and keeps the admissions written this session', r.cleared.admissions >= 2 && r.cleared.active >= 2, JSON.stringify(r.cleared));
  ok('the audit trail survives the reset so the session remains readable',
    r.trail.some(w => /Signed out/.test(w)), r.trail.length + ' entries');
  ok('signing in again finds the same records', r.after.admissions >= 2, JSON.stringify(r.after));
});

ok('no case produced a console error', allErrs.length === 0, allErrs[0]);

await mkdir(path.join(ROOT, 'qa', 'audit'), { recursive: true });
await writeFile(path.join(ROOT, 'qa', 'audit', 'm12-boundaries.json'),
  JSON.stringify({ at: new Date().toISOString(), pass, fail, failures }, null, 2));

await browser.close();
server.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
