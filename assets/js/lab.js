// Laboratory orders and results (M6).
//
// A physician orders a test; the laboratory collects a specimen, processes it, enters a result and
// validates it. Only a VALIDATED result is released to the patient record — an entered result is a
// draft and must not appear in the portal or be treated as final.
//
// WHAT THIS IS NOT
// The abnormal/critical flag below is a MECHANICAL comparison of the entered number against the
// reference range printed on the order. It is not an interpretation and it is not a diagnosis.
// Nothing in this module infers a condition from a value, and the screens say so.
//
// STORAGE: `mh_lab`. Synthetic records only. See docs/DATA-MODEL.md.
(function () {
  var KEY = 'mh_lab';

  // Test catalogue. `range` is the reference interval printed on the report; `critical` is the
  // interval outside which the laboratory must telephone the ordering physician. Both are demo
  // values for a synthetic hospital and must not be used clinically.
  var CATALOG = {
    'CBC with platelet count': { category: 'Hematology', specimen: 'Whole blood (EDTA)', unit: '10^9/L', range: '4.0 - 11.0', critical: '< 2.0 or > 30.0' },
    'Hemoglobin': { category: 'Hematology', specimen: 'Whole blood (EDTA)', unit: 'g/dL', range: '12.0 - 16.0', critical: '< 7.0' },
    'Fasting blood sugar': { category: 'Chemistry', specimen: 'Serum (fasting)', unit: 'mg/dL', range: '70 - 99', critical: '< 40 or > 400' },
    'Creatinine': { category: 'Chemistry', specimen: 'Serum', unit: 'mg/dL', range: '0.6 - 1.3', critical: '> 4.0' },
    'Potassium': { category: 'Chemistry', specimen: 'Serum', unit: 'mmol/L', range: '3.5 - 5.1', critical: '< 2.5 or > 6.5' },
    'Troponin I': { category: 'Chemistry', specimen: 'Serum', unit: 'ng/mL', range: '< 0.04', critical: '> 0.40' },
    'Urinalysis': { category: 'Clinical microscopy', specimen: 'Midstream urine', unit: '', range: 'Normal', critical: '' },
    'Dengue NS1 antigen': { category: 'Serology', specimen: 'Serum', unit: '', range: 'Negative', critical: '' },
    'Chest X-ray PA': { category: 'Imaging', specimen: 'Radiograph', unit: '', range: 'No active finding', critical: '' },
    'ECG 12-lead': { category: 'Cardiology', specimen: 'Tracing', unit: '', range: 'Sinus rhythm', critical: '' },
    'Echocardiogram': { category: 'Cardiology', specimen: 'Study', unit: '', range: 'Normal wall motion', critical: '' },
    'MRI brain': { category: 'Imaging', specimen: 'Study', unit: '', range: 'No acute finding', critical: '' },
    'Coronary angiography': { category: 'Cardiology', specimen: 'Procedure', unit: '', range: 'No significant stenosis', critical: '' }
  };

  var STATUSES = ['Ordered', 'Collected', 'In Process', 'Resulted', 'Validated', 'Cancelled'];
  var PRIORITIES = ['Routine', 'Urgent', 'STAT'];

  // ---- seed ---------------------------------------------------------------------------------
  // Every order belongs to a patient that exists in HIS.registry, and the tests are the ones the
  // treatment plans already name, so the laboratory is not inventing work nobody ordered.
  var SEED = [
    { id: 'LAB-0001', patientId: 'PT-99213', orderedBy: 'Dr. Laurice Laureta', dept: 'Cardiology',
      test: 'Troponin I', priority: 'STAT', orderedAt: '2026-08-31T09:52:00+08:00',
      status: 'Validated', assignedTo: 'Daniel Cruz',
      collected: { at: '2026-08-31T10:05:00+08:00', by: 'Daniel Cruz' },
      result: { value: '0.42', unit: 'ng/mL', reference: '< 0.04', flag: 'Critical', notes: 'Repeat sample requested. Ordering physician telephoned at 10:48; acknowledgement not yet recorded.' },
      resultedBy: 'Daniel Cruz', resultedAt: '2026-08-31T10:40:00+08:00',
      validatedBy: 'Daniel Cruz', validatedAt: '2026-08-31T10:52:00+08:00', criticalAck: false },

    { id: 'LAB-0002', patientId: 'PT-99213', orderedBy: 'Dr. Laurice Laureta', dept: 'Cardiology',
      test: 'ECG 12-lead', priority: 'Urgent', orderedAt: '2026-08-29T09:40:00+08:00',
      status: 'Validated', assignedTo: 'Daniel Cruz',
      collected: { at: '2026-08-29T09:55:00+08:00', by: 'Daniel Cruz' },
      result: { value: 'ST depression V4-V6', unit: '', reference: 'Sinus rhythm', flag: 'Abnormal', notes: 'Tracing filed with the chart.' },
      resultedBy: 'Daniel Cruz', resultedAt: '2026-08-29T10:20:00+08:00',
      validatedBy: 'Daniel Cruz', validatedAt: '2026-08-29T10:30:00+08:00', criticalAck: false },

    { id: 'LAB-0003', patientId: 'PT-99210', orderedBy: 'Dr. Yumie Pasiol', dept: 'General Medicine',
      test: 'Chest X-ray PA', priority: 'Routine', orderedAt: '2026-08-31T08:58:00+08:00',
      status: 'Ordered', assignedTo: null, collected: null, result: null,
      resultedBy: null, resultedAt: null, validatedBy: null, validatedAt: null, criticalAck: false },

    { id: 'LAB-0004', patientId: 'PT-99211', orderedBy: 'Dr. Jeremias Esperanza', dept: 'Neurology',
      test: 'MRI brain', priority: 'Routine', orderedAt: '2026-08-31T07:20:00+08:00',
      status: 'In Process', assignedTo: 'Daniel Cruz',
      collected: { at: '2026-08-31T08:10:00+08:00', by: 'Daniel Cruz' },
      result: null, resultedBy: null, resultedAt: null, validatedBy: null, validatedAt: null, criticalAck: false },

    { id: 'LAB-0005', patientId: 'PT-99212', orderedBy: 'Dr. Marc Laureta', dept: 'Orthopedics',
      test: 'CBC with platelet count', priority: 'Routine', orderedAt: '2026-08-31T09:35:00+08:00',
      status: 'Collected', assignedTo: 'Daniel Cruz',
      collected: { at: '2026-08-31T09:50:00+08:00', by: 'Daniel Cruz' },
      result: null, resultedBy: null, resultedAt: null, validatedBy: null, validatedAt: null, criticalAck: false },

    { id: 'LAB-0006', patientId: 'PT-99215', orderedBy: 'Dr. Yumie Pasiol', dept: 'General Medicine',
      test: 'Urinalysis', priority: 'Routine', orderedAt: '2026-08-29T10:20:00+08:00',
      status: 'Validated', assignedTo: 'Daniel Cruz',
      collected: { at: '2026-08-29T10:35:00+08:00', by: 'Daniel Cruz' },
      result: { value: 'Normal', unit: '', reference: 'Normal', flag: 'Normal', notes: '' },
      resultedBy: 'Daniel Cruz', resultedAt: '2026-08-29T11:05:00+08:00',
      validatedBy: 'Daniel Cruz', validatedAt: '2026-08-29T11:15:00+08:00', criticalAck: false },

    { id: 'LAB-0007', patientId: 'PT-99213', orderedBy: 'Dr. Laurice Laureta', dept: 'Cardiology',
      test: 'Echocardiogram', priority: 'Routine', orderedAt: '2026-08-30T14:00:00+08:00',
      status: 'Resulted', assignedTo: 'Daniel Cruz',
      collected: { at: '2026-08-30T14:30:00+08:00', by: 'Daniel Cruz' },
      result: { value: 'EF 48%, mild hypokinesia', unit: '', reference: 'Normal wall motion', flag: 'Abnormal', notes: 'Awaiting validation by the duty cardiologist.' },
      resultedBy: 'Daniel Cruz', resultedAt: '2026-08-30T15:10:00+08:00',
      validatedBy: null, validatedAt: null, criticalAck: false }
  ];

  function all() {
    var rows = HIS.store.get(KEY, null);
    if (!Array.isArray(rows)) { rows = SEED.map(function (r) { return JSON.parse(JSON.stringify(r)); }); HIS.store.set(KEY, rows); }
    return rows;
  }
  function save(rows) { HIS.store.set(KEY, rows); return rows; }
  function byId(id) { return all().filter(function (o) { return o.id === id; })[0] || null; }
  function forPatient(patientId) { return all().filter(function (o) { return o.patientId === patientId; }); }

  function nextId(rows) {
    var max = rows.reduce(function (m, o) {
      var v = parseInt(String(o.id).replace(/\D/g, ''), 10);
      return isNaN(v) ? m : Math.max(m, v);
    }, 0);
    return 'LAB-' + String(max + 1).padStart(4, '0');
  }

  // Mechanical flag. Two configured rules, both printed on the order:
  //   1. a per-test CRITICAL threshold ('> 0.40', '< 2.0 or > 30.0') — outside it the laboratory
  //      must telephone the ordering physician
  //   2. otherwise the reference interval ('70 - 99', '< 0.04')
  // Text-only tests (imaging, ECG) are never auto-flagged: "Normal" there is a reading, not a
  // number, so a human sets it. Nothing here infers a condition from a value.
  function flagFor(value, reference, testName) {
    var v = parseFloat(String(value).replace(/[^0-9.\-]/g, ''));
    if (!isFinite(v)) return 'Normal';
    var cat = (testName && CATALOG[testName]) || {};
    var crit = String(cat.critical || '');
    if (crit) {
      var parts = crit.split(/\s+or\s+/);
      for (var i = 0; i < parts.length; i++) {
        var m = parts[i].match(/^\s*([<>])\s*(-?[\d.]+)/);
        if (!m) continue;
        var lim = parseFloat(m[2]);
        if (m[1] === '>' && v > lim) return 'Critical';
        if (m[1] === '<' && v < lim) return 'Critical';
      }
    }
    if (!reference) return 'Normal';
    var nums = String(reference).match(/-?\d+(\.\d+)?/g);
    if (!nums || !nums.length) return 'Normal';
    if (nums.length >= 2 && /-/.test(reference)) {
      var lo = parseFloat(nums[0]), hi = parseFloat(nums[1]);
      if (v < lo || v > hi) return 'Abnormal';
      return 'Normal';
    }
    if (/^</.test(String(reference).trim())) {
      var l2 = parseFloat(nums[0]);
      return v > l2 ? 'Abnormal' : 'Normal';
    }
    return 'Normal';
  }

  function actor() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    return a ? a.name : 'system';
  }
  function audit(what, o, before, after) {
    if (!window.HIS.audit) return;
    HIS.audit.append({
      who: actor(), role: roleLabel(),
      what: what + ' \u2014 ' + o.id + ' ' + o.test + ' (' + o.patientId + ')',
      entity: 'lab:' + o.id, before: before, after: after
    });
  }
  function roleLabel() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    if (!a || !window.HIS.rbac) return '\u2014';
    return (HIS.rbac.ROLES[a.role] || {}).label || a.role;
  }

  function create(input) {
    input = input || {};
    var p = window.HIS.registry && HIS.registry.byId(input.patientId);
    if (!p) return { ok: false, error: 'Choose a patient.' };
    if (!CATALOG[input.test]) return { ok: false, error: 'Choose a test from the catalogue.' };
    var rows = all();
    var o = {
      id: nextId(rows), patientId: p.id, orderedBy: input.orderedBy || actor(),
      dept: input.dept || p.dept || '', test: input.test,
      priority: PRIORITIES.indexOf(input.priority) > -1 ? input.priority : 'Routine',
      orderedAt: new Date().toISOString(), status: 'Ordered', assignedTo: null,
      collected: null, result: null, resultedBy: null, resultedAt: null,
      validatedBy: null, validatedAt: null, criticalAck: false,
      notes: String(input.notes || '').trim()
    };
    rows.push(o);
    save(rows);
    audit('Lab order created', o, null, 'Ordered');
    return { ok: true, order: o };
  }

  // Each transition is guarded, so a screen cannot skip a step by calling the wrong function.
  function collect(id) {
    var rows = all(), o = rows.filter(function (x) { return x.id === id; })[0];
    if (!o) return { ok: false, error: 'Order not found.' };
    if (o.status !== 'Ordered') return { ok: false, error: 'Only an ordered test can be collected.' };
    o.status = 'Collected';
    o.collected = { at: new Date().toISOString(), by: actor() };
    o.assignedTo = o.assignedTo || actor();
    save(rows);
    audit('Specimen collected', o, 'Ordered', 'Collected');
    return { ok: true, order: o };
  }

  function process(id) {
    var rows = all(), o = rows.filter(function (x) { return x.id === id; })[0];
    if (!o) return { ok: false, error: 'Order not found.' };
    if (o.status !== 'Collected') return { ok: false, error: 'The specimen must be collected first.' };
    o.status = 'In Process';
    o.assignedTo = actor();
    save(rows);
    audit('Processing started', o, 'Collected', 'In Process');
    return { ok: true, order: o };
  }

  function enterResult(id, data) {
    data = data || {};
    var rows = all(), o = rows.filter(function (x) { return x.id === id; })[0];
    if (!o) return { ok: false, error: 'Order not found.' };
    if (o.status !== 'In Process' && o.status !== 'Collected') {
      return { ok: false, error: 'Enter a result only after the specimen is collected.' };
    }
    var value = String(data.value == null ? '' : data.value).trim();
    if (!value) return { ok: false, error: 'Enter a result value or reading.' };
    var cat = CATALOG[o.test] || {};
    o.result = {
      value: value,
      unit: String(data.unit || cat.unit || '').trim(),
      reference: String(data.reference || cat.range || '').trim(),
      // A technician may override the mechanical flag, but only deliberately.
      flag: data.flag || flagFor(value, data.reference || cat.range, o.test),
      notes: String(data.notes || '').trim()
    };
    o.status = 'Resulted';
    o.resultedBy = actor();
    o.resultedAt = new Date().toISOString();
    save(rows);
    audit('Result entered', o, 'In Process', 'Resulted \u00b7 ' + o.result.value + ' ' + o.result.unit);
    return { ok: true, order: o };
  }

  function validate(id) {
    var rows = all(), o = rows.filter(function (x) { return x.id === id; })[0];
    if (!o) return { ok: false, error: 'Order not found.' };
    if (o.status !== 'Resulted') return { ok: false, error: 'Only an entered result can be validated.' };
    // A result cannot be validated by the person who entered it, in a real laboratory. In this
    // single-technologist demo that rule would block every order, so it is stated on screen
    // instead of silently enforced.
    o.status = 'Validated';
    o.validatedBy = actor();
    o.validatedAt = new Date().toISOString();
    save(rows);
    audit('Result validated', o, 'Resulted', 'Validated');
    return { ok: true, order: o };
  }

  function cancel(id, reason) {
    var rows = all(), o = rows.filter(function (x) { return x.id === id; })[0];
    if (!o) return { ok: false, error: 'Order not found.' };
    if (o.status === 'Validated') return { ok: false, error: 'A validated result cannot be cancelled.' };
    var before = o.status;
    o.status = 'Cancelled';
    o.cancelReason = reason || '';
    save(rows);
    audit('Order cancelled', o, before, 'Cancelled');
    return { ok: true, order: o };
  }

  function acknowledgeCritical(id) {
    var rows = all(), o = rows.filter(function (x) { return x.id === id; })[0];
    if (!o) return { ok: false, error: 'Order not found.' };
    o.criticalAck = true;
    o.criticalAckBy = actor();
    o.criticalAckAt = new Date().toISOString();
    save(rows);
    audit('Critical result acknowledged', o, 'unacknowledged', 'acknowledged');
    return { ok: true, order: o };
  }

  function stats() {
    var rows = all();
    var n = function (s) { return rows.filter(function (o) { return o.status === s; }).length; };
    return {
      total: rows.length,
      ordered: n('Ordered'),
      collected: n('Collected'),
      processing: n('In Process'),
      resulted: n('Resulted'),
      validated: n('Validated'),
      critical: rows.filter(function (o) {
        return o.status === 'Validated' && o.result && o.result.flag === 'Critical' && !o.criticalAck;
      }).length,
      abnormal: rows.filter(function (o) { return o.result && o.result.flag === 'Abnormal'; }).length
    };
  }

  HIS.lab = {
    KEY: KEY, CATALOG: CATALOG, STATUSES: STATUSES, PRIORITIES: PRIORITIES,
    all: all, save: save, byId: byId, forPatient: forPatient, create: create,
    collect: collect, process: process, enterResult: enterResult, validate: validate,
    cancel: cancel, acknowledgeCritical: acknowledgeCritical, flagFor: flagFor, stats: stats
  };
})();
