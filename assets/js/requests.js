// Patient correction requests.
//
// WHY THIS FILE EXISTS
// The portal's "Request a correction" box used to write into `mh_profile_requests`, a key nothing
// else in the application read. A patient was told their request "appears in the audit log" and no
// screen anywhere listed it, so the request went nowhere. This module is the one owner of that
// record: the portal creates it, Registration and the patient's profile read it, and staff close it.
//
// A request is never applied to the patient row automatically. Registration edits the record (which
// writes its own audit entry) and then marks the request resolved, so the trail shows both the ask
// and the change. `docs/DATA-MODEL.md` keeps HIS.registry the owner of the patient row; this file
// owns only the request about it.
(function () {
  var KEY = 'mh_patient_requests';
  var FIELDS = ['Contact number', 'Home address', 'Name or date of birth', 'PhilHealth / HMO cover', 'Something else'];

  function all() {
    var rows = HIS.store.get(KEY, null);
    return Array.isArray(rows) ? rows : [];
  }
  function save(rows) { HIS.store.set(KEY, rows); return rows; }
  function byId(id) { return all().filter(function (r) { return r.id === id; })[0] || null; }
  function open() { return all().filter(function (r) { return r.status === 'open'; }); }
  function forPatient(patientId) {
    return all().filter(function (r) { return r.patientId === patientId; })
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; });
  }
  function nextId(rows) {
    var n = rows.reduce(function (m, r) {
      var v = parseInt(String(r.id).replace(/\D/g, ''), 10);
      return isNaN(v) ? m : Math.max(m, v);
    }, 0);
    return 'PRQ-' + ('000' + (n + 1)).slice(-4);
  }

  function actor() {
    var a = window.HIS && HIS.auth && HIS.auth.account ? HIS.auth.account() : null;
    if (!a) return { name: 'system', role: '\u2014', email: '' };
    var label = window.HIS.rbac && HIS.rbac.ROLES[a.role] ? HIS.rbac.ROLES[a.role].label : a.role;
    return { name: a.name, role: label, email: a.email };
  }

  function create(input) {
    var text = String(input.text || '').trim();
    if (text.length < 8) return { ok: false, error: 'Describe the change in a few words first.' };
    var rows = all();
    var who = actor();
    var patient = HIS.registry && HIS.registry.byId ? HIS.registry.byId(input.patientId) : null;
    var rec = {
      id: nextId(rows),
      patientId: input.patientId || null,
      patientName: patient ? patient.name : (input.patientName || ''),
      accountId: input.accountId || null,
      accountEmail: input.accountEmail || who.email,
      field: FIELDS.indexOf(input.field) > -1 ? input.field : 'Something else',
      text: text,
      at: new Date().toISOString(),
      status: 'open',
      handledBy: null, handledAt: null, note: ''
    };
    rows.push(rec);
    save(rows);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: who.name, role: who.role,
        what: 'Correction requested \u2014 ' + rec.field + ': ' + text.slice(0, 90),
        entity: 'patient:' + rec.patientId, before: null, after: rec.id
      });
    }
    return { ok: true, request: rec };
  }

  // Staff closes a request. `status` is 'resolved' (the record was corrected) or 'dismissed'
  // (nothing needed changing). The note is required for a dismissal so the patient is told why.
  function close(id, status, note) {
    var rows = all();
    var i = rows.filter(function (r) { return r.id === id; })[0];
    if (!i) return { ok: false, error: 'That request no longer exists.' };
    if (i.status !== 'open') return { ok: false, error: 'That request is already closed.' };
    if (status === 'dismissed' && !String(note || '').trim()) {
      return { ok: false, error: 'Say why the request needs no change, so the patient is not left guessing.' };
    }
    var idx = rows.indexOf(i);
    var who = actor();
    rows[idx] = Object.assign({}, i, {
      status: status, handledBy: who.name, handledAt: new Date().toISOString(), note: String(note || '').trim()
    });
    save(rows);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: who.name, role: who.role,
        what: 'Correction request ' + status + ' \u2014 ' + i.id + (note ? ' \u00b7 ' + note : ''),
        entity: 'patient:' + i.patientId, before: 'open', after: status
      });
    }
    return { ok: true, request: rows[idx] };
  }

  function stats() {
    var rows = all();
    return {
      total: rows.length,
      open: rows.filter(function (r) { return r.status === 'open'; }).length,
      resolved: rows.filter(function (r) { return r.status === 'resolved'; }).length,
      dismissed: rows.filter(function (r) { return r.status === 'dismissed'; }).length
    };
  }

  HIS.requests = {
    KEY: KEY, FIELDS: FIELDS,
    all: all, open: open, byId: byId, forPatient: forPatient,
    create: create, close: close, stats: stats
  };
})();
