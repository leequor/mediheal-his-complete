// Encounters (M12) — the episode a charge belongs to.
//
// WHY THIS EXISTS
// M11 raised charges against a patient and then guessed which invoice they belonged on ("the oldest
// one with a balance"). That is not a reliable reference: a patient with two open episodes would have
// a laboratory order from today's visit billed to last month's admission. A charge needs to name the
// encounter it happened in, and the encounter needs to name the invoice for that episode.
//
// WHAT AN ENCOUNTER IS
// One patient's interaction with the hospital, from the moment it opens to the moment it closes.
// Two kinds:
//   outpatient — a visit: registration, appointment, consultation, orders, completion.
//   inpatient  — an admission episode, owned by `admissions.js` and mirrored here so that a
//                laboratory order or a dispensed drug raised on the ward lands on the ward's bill.
//
// THE CHAIN
//   patient -> encounter -> invoice (optional) -> charge
// A charge resolves its invoice from the encounter it names. If the encounter has no invoice, the
// charge stays in the unbilled queue until a cashier assigns it. Nothing is guessed.
//
// STORAGE: `mh_encounters` (array). Synthetic records only.
(function () {
  var KEY = 'mh_encounters';

  var KINDS = { outpatient: 'Outpatient', inpatient: 'Inpatient' };
  var STATUSES = ['open', 'completed', 'cancelled'];

  // Seeded episodes for the activity the demo already shows. The two inpatient encounters carry the
  // invoice that already exists for that admission, so a ward order is billed to the ward's bill
  // through a real reference rather than through a search for "an invoice with a balance".
  var SEED = [
    { id: 'ENC-0001', patientId: 'PT-99213', kind: 'inpatient', status: 'open',
      dept: 'Cardiology', provider: 'Dr. Laurice Laureta', admissionId: 'ADM-0001', invoiceId: 'BL-8801',
      appointmentId: null, openedAt: '2026-08-29T09:10:00+08:00', closedAt: null, disposition: null,
      notes: 'Admitted for unstable angina.' },
    { id: 'ENC-0002', patientId: 'PT-99211', kind: 'inpatient', status: 'open',
      dept: 'Neurology', provider: 'Dr. Jeremias Esperanza', admissionId: 'ADM-0002', invoiceId: 'BL-8798',
      appointmentId: null, openedAt: '2026-08-30T23:05:00+08:00', closedAt: null, disposition: null,
      notes: 'Admitted for migraine with aura.' },
    { id: 'ENC-0003', patientId: 'PT-99210', kind: 'outpatient', status: 'open',
      dept: 'General Medicine', provider: 'Dr. Yumie Pasiol', admissionId: null, invoiceId: null,
      appointmentId: null, openedAt: '2026-08-31T08:50:00+08:00', closedAt: null, disposition: null,
      notes: 'Walk-in consultation.' },
    { id: 'ENC-0004', patientId: 'PT-99212', kind: 'outpatient', status: 'open',
      dept: 'Orthopaedics', provider: 'Dr. Marc Laureta', admissionId: null, invoiceId: null,
      appointmentId: null, openedAt: '2026-08-31T09:28:00+08:00', closedAt: null, disposition: null,
      notes: 'Fracture follow-up.' },
    { id: 'ENC-0005', patientId: 'PT-99215', kind: 'outpatient', status: 'completed',
      dept: 'Obstetrics & Gynecology', provider: 'Dr. Yumie Pasiol', admissionId: null, invoiceId: 'BL-8800',
      appointmentId: null, openedAt: '2026-08-29T10:05:00+08:00', closedAt: '2026-08-29T11:20:00+08:00',
      disposition: 'Discharged from clinic', notes: '' },
    { id: 'ENC-0006', patientId: 'PT-99209', kind: 'outpatient', status: 'completed',
      dept: 'Pediatrics', provider: 'Dr. Paolo Tipay', admissionId: null, invoiceId: null,
      appointmentId: null, openedAt: '2026-08-30T14:12:00+08:00', closedAt: '2026-08-30T15:00:00+08:00',
      disposition: 'Discharged from clinic', notes: '' }
  ];

  function read() {
    var rows = HIS.store.get(KEY, null);
    if (!Array.isArray(rows) || !rows.length) {
      rows = SEED.map(function (r) { return JSON.parse(JSON.stringify(r)); });
      HIS.store.set(KEY, rows);
    }
    return rows;
  }
  function save(rows) { HIS.store.set(KEY, rows); return rows; }
  function all() { return read().slice(); }
  function byId(id) { return read().filter(function (e) { return e.id === id; })[0] || null; }

  function nextId(rows) {
    var max = rows.reduce(function (m, e) {
      var v = parseInt(String(e.id).split('-').pop(), 10);
      return isNaN(v) ? m : Math.max(m, v);
    }, 0);
    return 'ENC-' + String(max + 1).padStart(4, '0');
  }

  function forPatient(patientId) {
    return all().filter(function (e) { return e.patientId === patientId; })
      .sort(function (a, b) { return new Date(b.openedAt) - new Date(a.openedAt); });
  }

  // The encounter a new charge should name: the patient's most recent OPEN episode. Returns null
  // when the patient has none, and the charge then stays unbilled rather than borrowing an invoice
  // from an unrelated visit.
  function openFor(patientId) {
    var open = forPatient(patientId).filter(function (e) { return e.status === 'open'; });
    return open[0] || null;
  }

  function invoiceOf(encounterId) {
    var e = encounterId ? byId(encounterId) : null;
    return e && e.invoiceId ? e.invoiceId : null;
  }

  // Open an episode. `kind` decides which module owns the clinical side; this record owns identity,
  // the invoice link and the lifecycle.
  function open(input) {
    input = input || {};
    var p = window.HIS.registry && HIS.registry.byId(input.patientId);
    if (!p) return { ok: false, error: 'Choose a patient.' };
    if (!KINDS[input.kind]) return { ok: false, error: 'Choose an encounter type.' };
    if (!String(input.dept || '').trim()) return { ok: false, error: 'An encounter needs a department.' };

    // One open episode of a kind per patient. A second visit is a second encounter, but only after
    // the first is closed — otherwise two invoices compete for the same order.
    var clash = forPatient(p.id).filter(function (e) {
      return e.status === 'open' && e.kind === input.kind;
    })[0];
    if (clash && !input.allowParallel) {
      return { ok: false, error: p.name + ' already has an open ' + KINDS[input.kind].toLowerCase() + ' encounter (' + clash.id + '). Close it first.', encounter: clash };
    }

    var rows = read();
    var e = {
      id: nextId(rows), patientId: p.id, kind: input.kind, status: 'open',
      dept: String(input.dept).trim(),
      provider: input.provider || p.doctor || '',
      admissionId: input.admissionId || null,
      invoiceId: input.invoiceId || null,
      appointmentId: input.appointmentId || null,
      openedAt: input.openedAt || new Date().toISOString(),
      closedAt: null, disposition: null,
      notes: String(input.notes || '').trim(),
      createdBy: actor()
    };
    rows.push(e);
    save(rows);
    audit('Encounter opened \u2014 ' + e.id + ' \u00b7 ' + KINDS[e.kind] + ' \u00b7 ' + p.name + ' (' + p.id + ')', e.id, null, 'open');
    return { ok: true, encounter: e };
  }

  // Return the patient's open encounter, creating one when there is none. This is what a clinical
  // screen calls before raising an order, so the order is never orphaned.
  //
  // The open episode is reused REGARDLESS of kind. A patient in a ward who has a laboratory test
  // drawn is still in the same inpatient episode; opening a parallel outpatient visit would put the
  // charge on an episode with no invoice and split one admission across two bills.
  function ensure(patientId, opts) {
    opts = opts || {};
    var p = window.HIS.registry && HIS.registry.byId(patientId);
    if (!p) return { ok: false, error: 'Patient not found.' };
    var existing = openFor(patientId);
    if (existing) return { ok: true, encounter: existing, created: false };
    return open({
      patientId: patientId, kind: opts.kind || 'outpatient',
      dept: opts.dept || p.dept || 'General Medicine',
      provider: opts.provider || p.doctor || '',
      appointmentId: opts.appointmentId || null,
      invoiceId: opts.invoiceId || null
    });
  }

  // Link the admission that owns an inpatient episode. The encounter is opened before the admission
  // record exists (the admission needs the encounter id), so the link is completed straight after.
  function attachAdmission(id, admissionId) {
    var rows = read(), e = rows.filter(function (x) { return x.id === id; })[0];
    if (!e) return { ok: false, error: 'Encounter not found.' };
    e.admissionId = admissionId || null;
    save(rows);
    return { ok: true, encounter: e };
  }

  function attachInvoice(id, invoiceId) {
    var rows = read(), e = rows.filter(function (x) { return x.id === id; })[0];
    if (!e) return { ok: false, error: 'Encounter not found.' };
    if (e.invoiceId === invoiceId) return { ok: true, encounter: e, unchanged: true };
    if (e.status !== 'open') return { ok: false, error: 'Only an open encounter can be billed to a different invoice.' };
    var before = e.invoiceId;
    e.invoiceId = invoiceId || null;
    save(rows);
    audit('Encounter invoice link changed \u2014 ' + e.id + ' \u2192 ' + (invoiceId || 'unbilled'), e.id, before || '\u2014', invoiceId || '\u2014');
    return { ok: true, encounter: e };
  }

  // Close the episode. A completed encounter can still be read; it can no longer receive charges.
  function complete(id, opts) {
    opts = opts || {};
    var rows = read(), e = rows.filter(function (x) { return x.id === id; })[0];
    if (!e) return { ok: false, error: 'Encounter not found.' };
    if (e.status !== 'open') return { ok: false, error: 'That encounter is already ' + e.status + '.' };
    e.status = 'completed';
    e.closedAt = new Date().toISOString();
    e.disposition = String(opts.disposition || 'Completed').trim();
    e.closedBy = actor();
    save(rows);
    audit('Encounter completed \u2014 ' + e.id + ' \u00b7 ' + e.disposition, e.id, 'open', 'completed');
    return { ok: true, encounter: e };
  }

  function cancel(id, reason) {
    var rows = read(), e = rows.filter(function (x) { return x.id === id; })[0];
    if (!e) return { ok: false, error: 'Encounter not found.' };
    if (e.status !== 'open') return { ok: false, error: 'Only an open encounter can be cancelled.' };
    if (!String(reason || '').trim()) return { ok: false, error: 'Cancelling an encounter needs a reason.' };
    e.status = 'cancelled';
    e.closedAt = new Date().toISOString();
    e.cancelReason = String(reason).trim();
    e.closedBy = actor();
    save(rows);
    audit('Encounter cancelled \u2014 ' + e.id + ' \u00b7 ' + e.cancelReason, e.id, 'open', 'cancelled');
    return { ok: true, encounter: e };
  }

  function stats() {
    var rows = all();
    return {
      total: rows.length,
      open: rows.filter(function (e) { return e.status === 'open'; }).length,
      outpatient: rows.filter(function (e) { return e.kind === 'outpatient' && e.status === 'open'; }).length,
      inpatient: rows.filter(function (e) { return e.kind === 'inpatient' && e.status === 'open'; }).length,
      completed: rows.filter(function (e) { return e.status === 'completed'; }).length
    };
  }

  function audit(what, entityId, before, after) {
    if (!window.HIS.audit) return;
    HIS.audit.append({ who: actor(), role: roleLabel(), what: what, entity: 'encounter:' + entityId, before: before, after: after });
  }
  function actor() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    return a ? a.name : 'system';
  }
  function roleLabel() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    if (!a || !window.HIS.rbac) return '\u2014';
    return (HIS.rbac.ROLES[a.role] || {}).label || a.role;
  }

  HIS.encounters = {
    KEY: KEY, KINDS: KINDS, STATUSES: STATUSES,
    all: all, byId: byId, forPatient: forPatient, openFor: openFor, invoiceOf: invoiceOf,
    open: open, ensure: ensure, attachInvoice: attachInvoice, attachAdmission: attachAdmission,
    complete: complete, cancel: cancel,
    stats: stats
  };
})();
