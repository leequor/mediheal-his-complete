// Pharmacy: medication inventory and dispensing (M6).
//
// Stock is held in BATCHES, because that is the only way to answer the two questions that matter:
// which batch leaves the shelf, and does it expire before the patient finishes it. A single
// "quantity on hand" number cannot answer either.
//
// RULES ENFORCED HERE (not in the screens):
//   - cannot dispense more than the batch holds
//   - cannot dispense from an expired batch
//   - cannot dispense more than the prescription has outstanding
//   - stock can never go negative
//   - every movement (receive / dispense / adjust) writes a stock-movement row and an audit row
//
// STORAGE: `mh_stock` (batches), `mh_rx` (prescriptions), `mh_stock_moves` (movements).
// Synthetic records only. See docs/DATA-MODEL.md.
(function () {
  var SKEY = 'mh_stock';
  var RKEY = 'mh_rx';
  var MKEY = 'mh_stock_moves';

  var TODAY = new Date('2026-08-31T12:00:00+08:00');

  // ---- seed inventory -----------------------------------------------------------------------
  // `expiry` values are chosen so the demo always has one low-stock line, one near-expiry batch
  // (inside 90 days) and one already-expired batch to show the disposal rule.
  var SEED_STOCK = [
    { id: 'BT-0001', drug: 'Amlodipine 5 mg tablet', generic: 'Amlodipine besylate', brand: 'Norvasc', strength: '5 mg', form: 'Tablet', route: 'Oral',
      batch: 'AML-2411', qty: 420, unit: 'tablet', reorder: 100, expiry: '2027-11-30', supplier: 'Zuellig Pharma', unitCost: 3.2, price: 5 },
    { id: 'BT-0002', drug: 'Metformin 500 mg tablet', generic: 'Metformin hydrochloride', brand: 'Glucophage', strength: '500 mg', form: 'Tablet', route: 'Oral',
      batch: 'MET-2408', qty: 760, unit: 'tablet', reorder: 200, expiry: '2027-08-31', supplier: 'Zuellig Pharma', unitCost: 2.1, price: 4 },
    { id: 'BT-0003', drug: 'Aspirin 81 mg tablet', generic: 'Acetylsalicylic acid', brand: 'Cardiprin', strength: '81 mg', form: 'Tablet', route: 'Oral',
      batch: 'ASP-2402', qty: 88, unit: 'tablet', reorder: 150, expiry: '2027-02-28', supplier: 'MedEthix', unitCost: 1.4, price: 3 },
    { id: 'BT-0004', drug: 'Atorvastatin 40 mg tablet', generic: 'Atorvastatin calcium', brand: 'Lipitor', strength: '40 mg', form: 'Tablet', route: 'Oral',
      batch: 'ATV-2405', qty: 240, unit: 'tablet', reorder: 80, expiry: '2026-11-15', supplier: 'Pfizer Distributors', unitCost: 9.8, price: 14 },
    { id: 'BT-0005', drug: 'Paracetamol 500 mg tablet', generic: 'Paracetamol', brand: 'Biogesic', strength: '500 mg', form: 'Tablet', route: 'Oral',
      batch: 'PCM-2410', qty: 1400, unit: 'tablet', reorder: 300, expiry: '2028-01-31', supplier: 'Unilab', unitCost: 0.9, price: 2 },
    { id: 'BT-0006', drug: 'Celecoxib 200 mg capsule', generic: 'Celecoxib', brand: 'Celebrex', strength: '200 mg', form: 'Capsule', route: 'Oral',
      batch: 'CLX-2403', qty: 96, unit: 'capsule', reorder: 60, expiry: '2027-05-31', supplier: 'Pfizer Distributors', unitCost: 18.5, price: 26 },
    { id: 'BT-0007', drug: 'Amoxicillin 500 mg capsule', generic: 'Amoxicillin trihydrate', brand: 'Amoxil', strength: '500 mg', form: 'Capsule', route: 'Oral',
      batch: 'AMX-2312', qty: 310, unit: 'capsule', reorder: 120, expiry: '2026-12-31', supplier: 'GlaxoSmithKline PH', unitCost: 6.4, price: 10 },
    { id: 'BT-0008', drug: 'Salbutamol 100 mcg inhaler', generic: 'Salbutamol sulfate', brand: 'Ventolin', strength: '100 mcg/dose', form: 'Metered inhaler', route: 'Inhalation',
      batch: 'SAL-2406', qty: 14, unit: 'inhaler', reorder: 20, expiry: '2027-09-30', supplier: 'GlaxoSmithKline PH', unitCost: 168, price: 240 },
    { id: 'BT-0009', drug: 'Sumatriptan 50 mg tablet', generic: 'Sumatriptan succinate', brand: 'Imigran', strength: '50 mg', form: 'Tablet', route: 'Oral',
      batch: 'SMT-2401', qty: 48, unit: 'tablet', reorder: 30, expiry: '2027-04-30', supplier: 'MedEthix', unitCost: 42, price: 62 },
    { id: 'BT-0010', drug: 'Propranolol 40 mg tablet', generic: 'Propranolol hydrochloride', brand: 'Inderal', strength: '40 mg', form: 'Tablet', route: 'Oral',
      batch: 'PRP-2407', qty: 180, unit: 'tablet', reorder: 80, expiry: '2027-10-31', supplier: 'AstraZeneca PH', unitCost: 3.6, price: 6 },
    { id: 'BT-0011', drug: 'Omeprazole 20 mg capsule', generic: 'Omeprazole', brand: 'Losec', strength: '20 mg', form: 'Capsule', route: 'Oral',
      batch: 'OMP-2309', qty: 54, unit: 'capsule', reorder: 100, expiry: '2026-09-30', supplier: 'AstraZeneca PH', unitCost: 7.2, price: 11 },
    { id: 'BT-0012', drug: 'Ceftriaxone 1 g vial', generic: 'Ceftriaxone sodium', brand: 'Rocephin', strength: '1 g', form: 'Powder for injection', route: 'Intravenous',
      batch: 'CFX-2301', qty: 22, unit: 'vial', reorder: 40, expiry: '2026-06-30', supplier: 'Roche Philippines', unitCost: 210, price: 300 }
  ];

  // Prescriptions seeded from the treatment plans, so the pharmacy queue is work a doctor actually
  // ordered in this demo rather than invented activity.
  var SEED_RX = [
    { id: 'RX-0001', patientId: 'PT-99213', drug: 'Aspirin 81 mg tablet', dosage: '1 tablet once daily after meals', qty: 30, unit: 'tablet',
      orderedBy: 'Dr. Laurice Laureta', orderedAt: '2026-08-31T10:00:00+08:00', status: 'Pending', dispensed: [], notes: 'Continue post-discharge.' },
    { id: 'RX-0002', patientId: 'PT-99213', drug: 'Atorvastatin 40 mg tablet', dosage: '1 tablet at bedtime', qty: 30, unit: 'tablet',
      orderedBy: 'Dr. Laurice Laureta', orderedAt: '2026-08-31T10:02:00+08:00', status: 'Pending', dispensed: [], notes: '' },
    { id: 'RX-0003', patientId: 'PT-99210', drug: 'Amoxicillin 500 mg capsule', dosage: '1 capsule every 8 hours for 7 days', qty: 21, unit: 'capsule',
      orderedBy: 'Dr. Yumie Pasiol', orderedAt: '2026-08-31T09:05:00+08:00', status: 'Pending', dispensed: [], notes: 'Take with food.' },
    { id: 'RX-0004', patientId: 'PT-99212', drug: 'Celecoxib 200 mg capsule', dosage: '1 capsule twice daily', qty: 20, unit: 'capsule',
      orderedBy: 'Dr. Marc Laureta', orderedAt: '2026-08-31T09:40:00+08:00', status: 'Dispensed',
      dispensed: [{ batchId: 'BT-0006', qty: 20, at: '2026-08-31T10:20:00+08:00', by: 'Miguel Reyes' }], notes: '' },
    { id: 'RX-0006', patientId: 'PT-99211', drug: 'Propranolol 40 mg tablet', dosage: '1 tablet twice daily', qty: 60, unit: 'tablet',
      orderedBy: 'Dr. Jeremias Esperanza', orderedAt: '2026-08-31T08:15:00+08:00', status: 'Verified',
      verifiedBy: 'Miguel Reyes', verifiedAt: '2026-08-31T08:40:00+08:00', dispensed: [], notes: 'Migraine prophylaxis.' },
    { id: 'RX-0005', patientId: 'PT-99215', drug: 'Paracetamol 500 mg tablet', dosage: '1 tablet every 6 hours as needed', qty: 12, unit: 'tablet',
      orderedBy: 'Dr. Yumie Pasiol', orderedAt: '2026-08-29T10:30:00+08:00', status: 'Dispensed',
      dispensed: [{ batchId: 'BT-0005', qty: 12, at: '2026-08-29T11:00:00+08:00', by: 'Miguel Reyes' }], notes: '' }
  ];

  function read(key, seed) {
    var rows = HIS.store.get(key, null);
    if (!Array.isArray(rows)) { rows = JSON.parse(JSON.stringify(seed)); HIS.store.set(key, rows); }
    return rows;
  }
  function stock() { return read(SKEY, SEED_STOCK); }
  function saveStock(rows) { HIS.store.set(SKEY, rows); return rows; }
  function rx() { return read(RKEY, SEED_RX); }
  function saveRx(rows) { HIS.store.set(RKEY, rows); return rows; }
  function moves() {
    var rows = HIS.store.get(MKEY, null);
    if (!Array.isArray(rows)) { rows = []; HIS.store.set(MKEY, rows); }
    return rows;
  }
  function saveMoves(rows) { HIS.store.set(MKEY, rows); return rows; }

  function actor() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    return a ? a.name : 'system';
  }
  function roleLabel() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    if (!a || !window.HIS.rbac) return '\u2014';
    return (HIS.rbac.ROLES[a.role] || {}).label || a.role;
  }
  function audit(what, entity, before, after) {
    if (!window.HIS.audit) return;
    HIS.audit.append({ who: actor(), role: roleLabel(), what: what, entity: entity, before: before, after: after });
  }

  function daysToExpiry(iso) { return Math.round((new Date(iso) - TODAY) / 864e5); }
  function isExpired(b) { return new Date(b.expiry).getTime() < TODAY.getTime(); }
  function isNearExpiry(b, days) { var d = daysToExpiry(b.expiry); return d >= 0 && d <= (days || 90); }

  // ---- stock reads --------------------------------------------------------------------------
  // Total on hand for a drug name, counting only batches that may actually be dispensed.
  function available(drug) {
    return stock().filter(function (b) { return b.drug === drug && !isExpired(b) && b.qty > 0; })
      .reduce(function (s, b) { return s + b.qty; }, 0);
  }
  function batchesFor(drug) {
    return stock().filter(function (b) { return b.drug === drug; })
      .sort(function (a, b) { return new Date(a.expiry) - new Date(b.expiry); }); // first-expiry-first-out
  }
  function lowStock() {
    var byDrug = {};
    stock().forEach(function (b) {
      var k = b.drug;
      byDrug[k] = byDrug[k] || { drug: k, reorder: b.reorder, qty: 0, unit: b.unit, expired: 0 };
      if (isExpired(b)) byDrug[k].expired += b.qty; else byDrug[k].qty += b.qty;
    });
    return Object.keys(byDrug).map(function (k) { return byDrug[k]; })
      .filter(function (r) { return r.qty <= r.reorder; })
      .sort(function (a, b) { return (a.qty - a.reorder) - (b.qty - b.reorder); });
  }
  function nearExpiry() {
    return stock().filter(function (b) { return !isExpired(b) && isNearExpiry(b) && b.qty > 0; })
      .sort(function (a, b) { return new Date(a.expiry) - new Date(b.expiry); });
  }
  function expired() {
    return stock().filter(function (b) { return isExpired(b) && b.qty > 0; })
      .sort(function (a, b) { return new Date(a.expiry) - new Date(b.expiry); });
  }

  // ---- prescriptions ------------------------------------------------------------------------
  function rxById(id) { return rx().filter(function (r) { return r.id === id; })[0] || null; }
  function forPatient(patientId) { return rx().filter(function (r) { return r.patientId === patientId; }); }
  function remaining(r) {
    var given = (r.dispensed || []).reduce(function (s, d) { return s + d.qty; }, 0);
    var back = (r.returns || []).reduce(function (s, d) { return s + d.qty; }, 0);
    return Math.max(0, r.qty - given + back);
  }
  function nextRxId(rows) {
    var max = rows.reduce(function (m, r) {
      var v = parseInt(String(r.id).replace(/\D/g, ''), 10);
      return isNaN(v) ? m : Math.max(m, v);
    }, 0);
    return 'RX-' + String(max + 1).padStart(4, '0');
  }

  function createRx(input) {
    if (!HIS.rbac.can('prescribe')) return { ok: false, error: 'Your account cannot perform this action.' };
    input = input || {};
    var p = window.HIS.registry && HIS.registry.byId(input.patientId);
    if (!p) return { ok: false, error: 'Choose a patient.' };
    if (!String(input.drug || '').trim()) return { ok: false, error: 'Choose a medication.' };
    var qty = Number(input.qty);
    if (!Number.isSafeInteger(qty) || qty <= 0) return { ok: false, error: 'Enter a whole quantity greater than zero.' };
    var rows = rx();
    var enc = window.HIS.encounters ? HIS.encounters.ensure(p.id, { dept: p.dept, provider: input.orderedBy || p.doctor }) : null;
    var r = {
      id: nextRxId(rows), patientId: p.id,
      encounterId: enc && enc.ok ? enc.encounter.id : null,
      drug: String(input.drug).trim(),
      dosage: String(input.dosage || '').trim(), qty: qty, unit: String(input.unit || 'tablet'),
      orderedBy: input.orderedBy || actor(), orderedAt: new Date().toISOString(),
      status: 'Pending', dispensed: [], returns: [], notes: String(input.notes || '').trim()
    };
    rows.push(r);
    saveRx(rows);
    audit('Prescription raised \u2014 ' + r.id + ' ' + r.drug + ' for ' + p.name, 'rx:' + r.id, null, 'Pending');
    return { ok: true, prescription: r };
  }

  function verify(id) {
    if (!HIS.rbac.can('pharmacyWork')) return { ok: false, error: 'Your account cannot perform this action.' };
    var rows = rx(), r = rows.filter(function (x) { return x.id === id; })[0];
    if (!r) return { ok: false, error: 'Prescription not found.' };
    if (r.status !== 'Pending') return { ok: false, error: 'Only a pending prescription can be verified.' };
    r.status = 'Verified';
    r.verifiedBy = actor();
    r.verifiedAt = new Date().toISOString();
    saveRx(rows);
    audit('Prescription verified \u2014 ' + r.id, 'rx:' + r.id, 'Pending', 'Verified');
    return { ok: true, prescription: r };
  }

  function reject(id, reason) {
    if (!HIS.rbac.can('pharmacyWork')) return { ok: false, error: 'Your account cannot perform this action.' };
    var rows = rx(), r = rows.filter(function (x) { return x.id === id; })[0];
    if (!r) return { ok: false, error: 'Prescription not found.' };
    if (r.status === 'Dispensed') return { ok: false, error: 'A dispensed prescription cannot be rejected.' };
    var before = r.status;
    r.status = 'Rejected';
    r.rejectReason = reason || '';
    saveRx(rows);
    audit('Prescription rejected \u2014 ' + r.id + (reason ? ' \u00b7 ' + reason : ''), 'rx:' + r.id, before, 'Rejected');
    return { ok: true, prescription: r };
  }

  // Dispense from a specific batch. Everything is validated before anything is written.
  function dispense(rxId, input) {
    if (!HIS.rbac.can('pharmacyWork')) return { ok: false, error: 'Your account cannot perform this action.' };
    input = input || {};
    var rows = rx(), r = rows.filter(function (x) { return x.id === rxId; })[0];
    if (!r) return { ok: false, error: 'Prescription not found.' };
    if (r.status === 'Rejected') return { ok: false, error: 'This prescription was rejected.' };
    if (r.status === 'Dispensed') return { ok: false, error: 'This prescription is already fully dispensed.' };
    if (['Verified', 'Partial'].indexOf(r.status) < 0) return { ok: false, error: 'Verify this prescription before dispensing.' };

    var want = Number(input.qty);
    if (!Number.isSafeInteger(want) || want <= 0) return { ok: false, error: 'Enter a whole quantity to dispense.' };
    var left = remaining(r);
    if (want > left) return { ok: false, error: 'Only ' + left + ' ' + r.unit + ' remain on this prescription.' };

    var batches = stock();
    var b = batches.filter(function (x) { return x.id === input.batchId; })[0];
    if (!b) return { ok: false, error: 'Choose a batch.' };
    if (b.drug !== r.drug) return { ok: false, error: 'That batch is a different medication.' };
    if (isExpired(b)) return { ok: false, error: 'Batch ' + b.batch + ' expired on ' + b.expiry + ' and cannot be dispensed.' };
    if (b.qty < want) return { ok: false, error: 'Batch ' + b.batch + ' holds only ' + b.qty + ' ' + b.unit + '.' };

    b.qty -= want;
    r.dispensed = (r.dispensed || []).concat([{ batchId: b.id, batch: b.batch, qty: want, at: new Date().toISOString(), by: actor() }]);
    r.status = remaining(r) === 0 ? 'Dispensed' : 'Partial';
    if (r.status === 'Dispensed') { r.dispensedBy = actor(); r.dispensedAt = new Date().toISOString(); }

    saveStock(batches);
    saveRx(rows);

    var mv = moves();
    mv.push({
      id: 'MV-' + String(mv.length + 1).padStart(4, '0'), at: new Date().toISOString(),
      kind: 'dispense', batchId: b.id, drug: b.drug, qty: -want, by: actor(),
      reason: 'Dispensed on ' + r.id + ' for ' + r.patientId
    });
    saveMoves(mv);

    audit('Medication dispensed \u2014 ' + want + ' ' + b.unit + ' ' + b.drug + ' (batch ' + b.batch + ') on ' + r.id +
      ' \u00b7 stock ' + (b.qty + want) + ' \u2192 ' + b.qty, 'rx:' + r.id, String(b.qty + want), String(b.qty));

    // Charge what actually left the shelf, at the batch's retail price. Keyed on the dispense event
    // (prescription + sequence), so a partial dispense bills only its own quantity and a retry
    // cannot bill it again.
    var billing = null;
    if (window.HIS.charges) {
      var enc = r.encounterId || (window.HIS.encounters ? (HIS.encounters.openFor(r.patientId) || {}).id : null);
      r.encounterId = enc || null;
      billing = HIS.charges.add({
        patientId: r.patientId, encounterId: r.encounterId,
        source: 'pharmacy', sourceId: r.id + '#' + r.dispensed.length,
        code: b.drug, description: b.drug + ' \u00b7 ' + want + ' ' + b.unit,
        qty: want, unitPrice: b.price,
        tariffCode: 'PHARM-' + b.id, tariffEffectiveFrom: '2026-01-01'
      });
    }
    return { ok: true, prescription: r, batch: b, remaining: remaining(r), billing: billing };
  }

  // Reverse ONE dispensing event in full. The original dispense row is never edited: the stock comes
  // back as its own movement, the charge for that event is voided with a reason, and the return is
  // recorded beside the dispense it reverses. Partial returns are refused rather than approximated —
  // a half-returned batch has no honest single price.
  function returnDispense(rxId, dispenseIndex, reason) {
    if (!HIS.rbac.can('pharmacyWork')) return { ok: false, error: 'Your account cannot perform this action.' };
    var rows = rx(), r = rows.filter(function (x) { return x.id === rxId; })[0];
    if (!r) return { ok: false, error: 'Prescription not found.' };
    if (!String(reason || '').trim()) return { ok: false, error: 'A return needs a reason.' };
    var d = (r.dispensed || [])[dispenseIndex];
    if (!d) return { ok: false, error: 'Dispensing event not found.' };
    if ((r.returns || []).some(function (x) { return x.dispenseIndex === dispenseIndex; })) {
      return { ok: false, error: 'That dispensing event has already been returned.' };
    }

    var batches = stock(), b = batches.filter(function (x) { return x.id === d.batchId; })[0];
    if (!b) return { ok: false, error: 'The batch this was dispensed from no longer exists.' };

    b.qty += d.qty;
    saveStock(batches);

    r.returns = (r.returns || []).concat([{
      dispenseIndex: dispenseIndex, batchId: d.batchId, batch: d.batch,
      qty: d.qty, at: new Date().toISOString(), by: actor(), reason: String(reason).trim()
    }]);
    r.status = remaining(r) === 0 ? 'Dispensed' : (r.status === 'Dispensed' ? 'Partial' : r.status);
    saveRx(rows);

    var mv = moves();
    mv.push({
      id: 'MV-' + String(mv.length + 1).padStart(4, '0'), at: new Date().toISOString(),
      kind: 'return', batchId: b.id, drug: b.drug, qty: d.qty, by: actor(),
      reason: 'Returned from ' + r.id + ' event ' + (dispenseIndex + 1) + ' \u00b7 ' + String(reason).trim()
    });
    saveMoves(mv);

    var billing = null;
    if (window.HIS.charges) {
      billing = HIS.charges.voidForSource('pharmacy', r.id + '#' + (dispenseIndex + 1),
        'Dispensing event returned \u00b7 ' + String(reason).trim());
    }
    audit('Dispensing returned \u2014 ' + d.qty + ' ' + b.unit + ' ' + b.drug + ' (batch ' + b.batch + ') on ' + r.id +
      ' \u00b7 stock ' + (b.qty - d.qty) + ' \u2192 ' + b.qty, 'rx:' + r.id, String(b.qty - d.qty), String(b.qty));
    return { ok: true, prescription: r, batch: b, billing: billing, remaining: remaining(r) };
  }

  // ---- inventory movement -------------------------------------------------------------------
  function receive(input) {
    if (!HIS.rbac.can('pharmacyWork')) return { ok: false, error: 'Your account cannot perform this action.' };
    input = input || {};
    if (!String(input.drug || '').trim()) return { ok: false, error: 'Choose a medication.' };
    var qty = Number(input.qty);
    if (!Number.isSafeInteger(qty) || qty <= 0) return { ok: false, error: 'Enter a whole quantity greater than zero.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiry || '') || !isFinite(Date.parse(input.expiry)) || new Date(input.expiry).toISOString().slice(0, 10) !== input.expiry) return { ok: false, error: 'Enter a valid batch expiry date.' };
    if (new Date(input.expiry).getTime() < Date.now()) return { ok: false, error: 'That batch is already expired.' };
    if (['unitCost', 'price', 'reorder'].some(function (k) { var n = Number(input[k] == null || input[k] === '' ? 0 : input[k]); return !isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER / 100; })) return { ok: false, error: 'Cost, price and reorder level must be finite, non-negative numbers.' };
    var batches = stock();
    var b = {
      id: 'BT-' + String(batches.length + 1).padStart(4, '0'),
      drug: String(input.drug).trim(), generic: input.generic || '', brand: input.brand || '',
      strength: input.strength || '', form: input.form || '', route: input.route || '',
      batch: String(input.batch || '').trim() || 'BATCH-' + (batches.length + 1),
      qty: qty, unit: input.unit || 'tablet', reorder: Number(input.reorder) || 0,
      expiry: input.expiry, supplier: String(input.supplier || '').trim(),
      unitCost: Number(input.unitCost) || 0, price: Number(input.price) || 0
    };
    batches.push(b);
    saveStock(batches);
    var mv = moves();
    mv.push({ id: 'MV-' + String(mv.length + 1).padStart(4, '0'), at: new Date().toISOString(), kind: 'receive', batchId: b.id, drug: b.drug, qty: qty, by: actor(), reason: 'Stock received \u00b7 supplier ' + (b.supplier || '\u2014') });
    saveMoves(mv);
    audit('Stock received \u2014 ' + qty + ' ' + b.unit + ' ' + b.drug + ' batch ' + b.batch + ' expiring ' + b.expiry, 'stock:' + b.id, '0', String(qty));
    return { ok: true, batch: b };
  }

  function adjust(batchId, delta, reason) {
    if (!HIS.rbac.can('pharmacyWork')) return { ok: false, error: 'Your account cannot perform this action.' };
    var batches = stock(), b = batches.filter(function (x) { return x.id === batchId; })[0];
    if (!b) return { ok: false, error: 'Batch not found.' };
    var d = Number(delta);
    if (!Number.isSafeInteger(d) || d === 0 || !Number.isSafeInteger(b.qty + d)) return { ok: false, error: 'Enter a non-zero whole adjustment.' };
    if (b.qty + d < 0) return { ok: false, error: 'Stock cannot go negative (batch holds ' + b.qty + ').' };
    if (!String(reason || '').trim()) return { ok: false, error: 'An adjustment needs a reason.' };
    var before = b.qty;
    b.qty += d;
    saveStock(batches);
    var mv = moves();
    mv.push({ id: 'MV-' + String(mv.length + 1).padStart(4, '0'), at: new Date().toISOString(), kind: 'adjust', batchId: b.id, drug: b.drug, qty: d, by: actor(), reason: reason });
    saveMoves(mv);
    audit('Stock adjusted \u2014 ' + b.drug + ' batch ' + b.batch + ' \u00b7 ' + reason, 'stock:' + b.id, String(before), String(b.qty));
    return { ok: true, batch: b };
  }

  // Remove an expired batch from the shelf. The quantity is not recoverable, so this is a disposal
  // movement rather than a plain zeroing of the row.
  function dispose(batchId, reason) {
    if (!HIS.rbac.can('pharmacyWork')) return { ok: false, error: 'Your account cannot perform this action.' };
    var batches = stock(), b = batches.filter(function (x) { return x.id === batchId; })[0];
    if (!b) return { ok: false, error: 'Batch not found.' };
    if (b.qty === 0) return { ok: false, error: 'That batch is already empty.' };
    var before = b.qty;
    var mv = moves();
    mv.push({ id: 'MV-' + String(mv.length + 1).padStart(4, '0'), at: new Date().toISOString(), kind: 'dispose', batchId: b.id, drug: b.drug, qty: -before, by: actor(), reason: reason || 'Expired stock disposal' });
    saveMoves(mv);
    b.qty = 0;
    saveStock(batches);
    audit('Expired stock disposed \u2014 ' + before + ' ' + b.unit + ' ' + b.drug + ' batch ' + b.batch, 'stock:' + b.id, String(before), '0');
    return { ok: true, batch: b };
  }

  function stats() {
    var batches = stock(), prescriptions = rx();
    return {
      pending: prescriptions.filter(function (r) { return r.status === 'Pending'; }).length,
      verified: prescriptions.filter(function (r) { return r.status === 'Verified'; }).length,
      partial: prescriptions.filter(function (r) { return r.status === 'Partial'; }).length,
      dispensedToday: prescriptions.filter(function (r) {
        return r.status === 'Dispensed' && r.dispensedAt && r.dispensedAt.slice(0, 10) === '2026-08-31';
      }).length,
      skus: Object.keys(batches.reduce(function (m, b) { m[b.drug] = 1; return m; }, {})).length,
      low: lowStock().length,
      nearExpiry: nearExpiry().length,
      expired: expired().length,
      stockValue: batches.reduce(function (s, b) { return s + b.qty * (b.unitCost || 0); }, 0)
    };
  }

  HIS.pharmacy = {
    STOCK_KEY: SKEY, RX_KEY: RKEY, MOVES_KEY: MKEY,
    stock: stock, rx: rx, moves: moves,
    rxById: rxById, forPatient: forPatient, remaining: remaining,
    available: available, batchesFor: batchesFor,
    lowStock: lowStock, nearExpiry: nearExpiry, expired: expired,
    isExpired: isExpired, daysToExpiry: daysToExpiry,
    createRx: createRx, verify: verify, reject: reject, dispense: dispense, returnDispense: returnDispense,
    receive: receive, adjust: adjust, dispose: dispose, stats: stats
  };
  ["createRx","verify","reject","dispense","returnDispense","receive","adjust","dispose"].forEach(function (name) {
    if (HIS.pharmacy[name]) HIS.pharmacy[name] = HIS.store.atomic(HIS.pharmacy[name]);
  });

})();
