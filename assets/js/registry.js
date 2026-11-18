// Patient registry (M5). THE authoritative patient identity for the whole application.
//
// WHY THIS EXISTS
// Before M5 the same person could exist under several names: `HIS.patients` held five Figma rows,
// billing referenced PT-99215 which was not in that array, the registration forms worked around the
// gap by taking `max(id)+1` over a union of two lists, and the patient portal had its own account
// store with no link to any hospital record at all. This module replaces that with one table.
//
// CONTRACT
//   1. `HIS.registry` is the only place a patient record is created or edited.
//   2. `HIS.patients` is re-pointed at the registry (getter) so existing modules that read it keep
//      working and can no longer see a different patient list than the portal does.
//   3. A login email is NEVER a patient ID. The link is explicit: `account.patientId`, or a row in
//      the guardian table for a dependent.
//
// STORAGE: `mh_patients` (array), `mh_guardians` (array). Browser-only, synthetic records only.
// See docs/DATA-MODEL.md.
(function () {
  var PKEY = 'mh_patients';
  var GKEY = 'mh_guardians';

  // ---------------------------------------------------------------------------------------------
  // Seed. The first five rows are the Figma Registration frame (23:2285) verbatim, so the page keeps
  // rendering pixel-identical; demographics are added around them. PT-99215 and PT-99214 were already
  // referenced by Billing and by the registration forms' own comments but were missing here, which is
  // why the forms had to guess at the next free MRN.
  // ---------------------------------------------------------------------------------------------
  var SEED = [
    {
      id: 'PT-99213', name: 'Isabel Geliz V. Ramos', first: 'Isabel Geliz', middle: 'Villanueva', last: 'Ramos',
      age: 54, dob: '1972-03-14', sex: 'Female', civil: 'Married',
      mobile: '+63 917 555 0142', email: 'isabel.ramos@example.ph',
      address: { street: '18 Mabini Street', barangay: 'Barangay San Roque', city: 'Quezon City', province: 'Metro Manila', zip: '1103', region: 'NCR' },
      emergency: { name: 'Ramon Ramos', relation: 'Spouse', mobile: '+63 917 555 0188' },
      bloodType: 'O+', allergies: 'Penicillin',
      philhealth: { no: '12-345678901-2', category: 'Employed (Private)', memberSince: '2009-06-01', dependents: 2, eligibility: 'Verified', verifiedAt: '2026-08-29' },
      hmo: { provider: 'Maxicare', memberId: 'MX-4471902', plan: 'Corporate HMO', loa: 'LOA-2026-08812', coverage: 25000, status: 'Approved' },
      type: 'Inpatient', dept: 'Cardiology', doctor: 'Dr. Laurice Laureta',
      registered: 'Aug 31, 2026 \u00b7 09:42 AM', status: 'Admitted', attention: true,
      ward: 'Cardiology Ward', bed: 'C-204', admittedAt: '2026-08-29T09:10:00+08:00'
    },
    {
      id: 'PT-99212', name: 'Rilaneh Marie L. Acabal', first: 'Rilaneh Marie', middle: 'Lopez', last: 'Acabal',
      age: 37, dob: '1989-07-22', sex: 'Female', civil: 'Single',
      mobile: '+63 918 220 4471', email: 'rilaneh.acabal@example.ph',
      address: { street: '42 Rizal Avenue', barangay: 'Barangay Poblacion', city: 'Cebu City', province: 'Cebu', zip: '6000', region: 'Region VII' },
      emergency: { name: 'Lourdes Acabal', relation: 'Mother', mobile: '+63 918 220 9900' },
      bloodType: 'A+', allergies: 'None recorded',
      philhealth: { no: '09-876543210-3', category: 'Employed (Private)', memberSince: '2014-02-01', dependents: 0, eligibility: 'Verified', verifiedAt: '2026-08-31' },
      hmo: { provider: 'Intellicare', memberId: 'IC-2290811', plan: 'Individual', loa: null, coverage: 0, status: 'Not requested' },
      type: 'Outpatient', dept: 'Orthopedics', doctor: 'Dr. Marc Laureta',
      registered: 'Aug 31, 2026 \u00b7 09:28 AM', status: 'Waiting', attention: true,
      ward: null, bed: null, admittedAt: null
    },
    {
      id: 'PT-99210', name: 'Tobias Reyes', first: 'Tobias', middle: 'Bautista', last: 'Reyes',
      age: 88, dob: '1938-01-09', sex: 'Male', civil: 'Widowed',
      mobile: '+63 915 330 7788', email: 't.reyes@example.ph',
      address: { street: '7 Bonifacio Extension', barangay: 'Barangay Malabanias', city: 'Angeles City', province: 'Pampanga', zip: '2009', region: 'Region III' },
      emergency: { name: 'Cecilia Reyes', relation: 'Daughter', mobile: '+63 915 330 7712' },
      bloodType: 'B+', allergies: 'Sulfa drugs',
      philhealth: { no: '03-112233445-6', category: 'Senior Citizen', memberSince: '1998-01-01', dependents: 0, eligibility: 'Verified', verifiedAt: '2026-08-31' },
      hmo: { provider: null, memberId: null, plan: null, loa: null, coverage: 0, status: 'None' },
      type: 'Outpatient', dept: 'General Medicine', doctor: 'Dr. Yumie Pasiol',
      registered: 'Aug 31, 2026 \u00b7 08:50 AM', status: 'In Consultation', attention: true,
      ward: null, bed: null, admittedAt: null
    },
    {
      id: 'PT-99211', name: 'Eleanor Whitfield', first: 'Eleanor', middle: 'Grace', last: 'Whitfield',
      age: 29, dob: '1997-11-30', sex: 'Female', civil: 'Single',
      mobile: '+63 926 441 0091', email: 'eleanor.whitfield@example.ph',
      address: { street: 'Unit 12B One Rockwell', barangay: 'Barangay Poblacion', city: 'Makati City', province: 'Metro Manila', zip: '1210', region: 'NCR' },
      emergency: { name: 'Margaret Whitfield', relation: 'Mother', mobile: '+63 926 441 0044' },
      bloodType: 'AB+', allergies: 'Latex',
      philhealth: { no: '11-556677889-0', category: 'Employed (Private)', memberSince: '2019-08-01', dependents: 0, eligibility: 'Pending', verifiedAt: null },
      hmo: { provider: 'PhilCare', memberId: 'PC-8812034', plan: 'Corporate HMO', loa: 'LOA-2026-08777', coverage: 18000, status: 'Approved' },
      type: 'Inpatient', dept: 'Neurology', doctor: 'Dr. Jeremias Esperanza',
      registered: 'Aug 30, 2026 \u00b7 11:30 PM', status: 'Admitted', attention: false,
      ward: 'Neurology Ward', bed: 'N-112', admittedAt: '2026-08-30T23:05:00+08:00'
    },
    {
      id: 'PT-99209', name: 'Hana Kobayashi', first: 'Hana', middle: 'Sato', last: 'Kobayashi',
      age: 40, dob: '1986-05-18', sex: 'Female', civil: 'Married',
      mobile: '+63 939 118 2244', email: 'hana.kobayashi@example.ph',
      address: { street: '88 Acacia Lane', barangay: 'Barangay Kasambagan', city: 'Cebu City', province: 'Cebu', zip: '6000', region: 'Region VII' },
      emergency: { name: 'Kenji Kobayashi', relation: 'Spouse', mobile: '+63 939 118 2200' },
      bloodType: 'O-', allergies: 'None recorded',
      philhealth: { no: '07-334455667-8', category: 'Employed (Private)', memberSince: '2012-03-01', dependents: 1, eligibility: 'Verified', verifiedAt: '2026-08-30' },
      hmo: { provider: null, memberId: null, plan: null, loa: null, coverage: 0, status: 'None' },
      type: 'Outpatient', dept: 'Pediatrics', doctor: 'Dr. Paolo Tipay',
      registered: 'Aug 30, 2026 \u00b7 02:12 PM', status: 'Completed', attention: false,
      ward: null, bed: null, admittedAt: null
    },
    {
      // Referenced by invoice BL-8800 but absent from HIS.patients before M5.
      id: 'PT-99215', name: 'Maria Santos', first: 'Maria', middle: 'Cruz', last: 'Santos',
      age: 31, dob: '1995-02-08', sex: 'Female', civil: 'Married',
      mobile: '+63 917 802 6613', email: 'maria.santos@example.ph',
      address: { street: '31 Katipunan Street', barangay: 'Barangay Pinyahan', city: 'Quezon City', province: 'Metro Manila', zip: '1100', region: 'NCR' },
      emergency: { name: 'Jose Santos', relation: 'Spouse', mobile: '+63 917 802 6699' },
      bloodType: 'A-', allergies: 'None recorded',
      philhealth: { no: '12-998877665-4', category: 'Employed (Private)', memberSince: '2017-09-01', dependents: 1, eligibility: 'Verified', verifiedAt: '2026-08-29' },
      hmo: { provider: null, memberId: null, plan: null, loa: null, coverage: 0, status: 'None' },
      type: 'Outpatient', dept: 'Obstetrics & Gynecology', doctor: 'Dr. Yumie Pasiol',
      registered: 'Aug 29, 2026 \u00b7 10:05 AM', status: 'Completed', attention: false,
      ward: null, bed: null, admittedAt: null
    },
    {
      // Referenced by the registration forms' own comments as a live record that was missing.
      id: 'PT-99214', name: 'Nestor Villamor', first: 'Nestor', middle: 'Ang', last: 'Villamor',
      age: 62, dob: '1964-09-02', sex: 'Male', civil: 'Married',
      mobile: '+63 927 664 1120', email: 'nestor.villamor@example.ph',
      address: { street: '5 Magsaysay Drive', barangay: 'Barangay San Nicolas', city: 'Batangas City', province: 'Batangas', zip: '4200', region: 'Region IV-A' },
      emergency: { name: 'Perla Villamor', relation: 'Spouse', mobile: '+63 927 664 1188' },
      bloodType: 'B-', allergies: 'Aspirin',
      philhealth: { no: '04-223344556-7', category: 'Self-employed', memberSince: '2010-05-01', dependents: 0, eligibility: 'Verified', verifiedAt: '2026-08-31' },
      hmo: { provider: null, memberId: null, plan: null, loa: null, coverage: 0, status: 'None' },
      type: 'Outpatient', dept: 'General Medicine', doctor: 'Dr. Elsie Chen',
      registered: 'Aug 31, 2026 \u00b7 07:40 AM', status: 'Completed', attention: false,
      ward: null, bed: null, admittedAt: null
    }
  ];

  function read(key, fallback) { return HIS.store.get(key, fallback); }
  function write(key, v) { return HIS.store.set(key, v); }

  function all() {
    var rows = read(PKEY, null);
    if (!Array.isArray(rows) || !rows.length) {
      rows = SEED.map(function (r) { return JSON.parse(JSON.stringify(r)); });
      write(PKEY, rows);
    }
    return rows;
  }
  function save(rows) { write(PKEY, rows); return rows; }

  function byId(id) {
    if (!id) return null;
    var key = String(id).trim().toUpperCase();
    return all().filter(function (p) { return String(p.id).toUpperCase() === key; })[0] || null;
  }

  // Free-text search across the fields a clerk would actually type.
  function search(q) {
    var s = String(q == null ? '' : q).trim().toLowerCase();
    if (!s) return all();
    return all().filter(function (p) {
      return [p.id, p.name, p.first, p.last, p.mobile, p.email, p.dept, p.doctor]
        .join(' ').toLowerCase().indexOf(s) > -1;
    });
  }

  function nextMrn() {
    var max = all().reduce(function (m, p) {
      var n = parseInt(String(p.id).replace(/\D/g, ''), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 99200);
    return 'PT-' + (max + 1);
  }

  // Duplicate detection: same last name AND same date of birth is a probable duplicate; same name
  // alone is only a *possible* duplicate, because Filipino naming repeats a great deal. Neither
  // merges automatically — the caller decides, which is what the brief asks for.
  function duplicates(input) {
    var last = String(input.last || '').trim().toLowerCase();
    var dob = String(input.dob || '').trim();
    var full = String(input.name || '').trim().toLowerCase();
    var probable = [], possible = [];
    all().forEach(function (p) {
      var sameLast = last && String(p.last || '').toLowerCase() === last;
      var sameDob = dob && String(p.dob || '') === dob;
      if (sameLast && sameDob) probable.push(p);
      else if (full && String(p.name || '').toLowerCase() === full) possible.push(p);
      else if (p.mobile && input.mobile && String(p.mobile).replace(/\D/g, '') === String(input.mobile).replace(/\D/g, '')) possible.push(p);
    });
    return { probable: probable, possible: possible };
  }

  function create(input) {
    input = input || {};
    var name = String(input.name || [input.first, input.middle, input.last].filter(Boolean).join(' ') || '').trim();
    if (!name) return { ok: false, error: 'A patient name is required.' };
    if (!input.dob) return { ok: false, error: 'A date of birth is required.' };
    var rows = all();
    var id = input.id && !byId(input.id) ? String(input.id).toUpperCase() : nextMrn();
    var rec = {
      id: id, name: name,
      first: input.first || name.split(' ')[0] || '',
      middle: input.middle || '',
      last: input.last || name.split(' ').slice(-1)[0] || '',
      age: input.age != null ? Number(input.age) : ageFrom(input.dob),
      dob: input.dob, sex: input.sex || '', civil: input.civil || '',
      mobile: input.mobile || '', email: input.email || '',
      address: input.address || { street: '', barangay: '', city: '', province: '', zip: '', region: '' },
      emergency: input.emergency || { name: '', relation: '', mobile: '' },
      bloodType: input.bloodType || '', allergies: input.allergies || 'None recorded',
      philhealth: input.philhealth || { no: '', category: '', memberSince: '', dependents: 0, eligibility: 'Not checked', verifiedAt: null },
      hmo: input.hmo || { provider: null, memberId: null, plan: null, loa: null, coverage: 0, status: 'None' },
      type: input.type || 'Outpatient', dept: input.dept || '', doctor: input.doctor || '',
      registered: input.registered || stamp(), status: input.status || 'Waiting', attention: !!input.attention,
      ward: input.ward || null, bed: input.bed || null, admittedAt: input.admittedAt || null,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy || (window.HIS && HIS.auth && HIS.auth.account() ? HIS.auth.account().name : 'system')
    };
    rows.push(rec);
    save(rows);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: rec.createdBy, role: roleLabel(),
        what: 'Patient record created \u2014 ' + rec.name + ' (' + rec.id + ')',
        entity: 'patient:' + rec.id, before: null, after: rec.id
      });
    }
    return { ok: true, patient: rec };
  }

  function update(id, patch) {
    var rows = all();
    var i = rows.findIndex(function (p) { return p.id === id; });
    if (i < 0) return { ok: false, error: 'Patient not found.' };
    var before = rows[i];
    var after = Object.assign({}, before, patch, { id: before.id });
    rows[i] = after;
    save(rows);
    var changed = Object.keys(patch).filter(function (k) { return k !== 'id'; });
    if (window.HIS.audit && changed.length) {
      HIS.audit.append({
        who: actorName(), role: roleLabel(),
        what: 'Patient record updated \u2014 ' + after.name + ' (' + after.id + ') \u00b7 ' + changed.join(', '),
        entity: 'patient:' + after.id, before: before[changed[0]], after: after[changed[0]]
      });
    }
    return { ok: true, before: before, patient: after };
  }

  function ageFrom(dob) {
    if (!dob) return null;
    var d = new Date(dob);
    if (isNaN(d)) return null;
    var t = new Date('2026-08-31T00:00:00+08:00');
    var a = t.getFullYear() - d.getFullYear();
    var m = t.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < d.getDate())) a--;
    return a;
  }

  function stamp() {
    return new Date().toLocaleString('en-PH', {
      timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    }).replace(',', ' \u00b7');
  }
  function actorName() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    return a ? a.name : 'system';
  }
  function roleLabel() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    if (!a || !HIS.rbac) return '\u2014';
    return (HIS.rbac.ROLES[a.role] || {}).label || a.role;
  }

  // ---- account <-> patient ------------------------------------------------------------------
  // The link lives on the ACCOUNT (`patientId`), which is what the seeded patient login already uses.
  // A guardian link lives in the guardian table because one guardian may cover several dependents
  // and each link carries its own authorisation scope.
  function accountFor(patientId) {
    if (!HIS.accounts) return null;
    return HIS.accounts.all().filter(function (a) { return a.patientId === patientId; })[0] || null;
  }

  function linkAccount(accountId, patientId) {
    if (!HIS.accounts) return { ok: false, error: 'Account store unavailable.' };
    var acct = HIS.accounts.byId(accountId);
    if (!acct) return { ok: false, error: 'Account not found.' };
    if (patientId && !byId(patientId)) return { ok: false, error: 'Patient record not found.' };
    var clash = patientId ? HIS.accounts.all().filter(function (a) {
      return a.patientId === patientId && a.id !== accountId;
    }) : [];
    if (clash.length) {
      return { ok: false, error: 'That patient record is already linked to ' + clash[0].email + '.' };
    }
    var r = HIS.accounts.update(accountId, { patientId: patientId || null });
    if (!r.ok) return r;
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actorName(), role: roleLabel(),
        what: 'Patient account link changed \u2014 ' + acct.email + ' \u2192 ' + (patientId || 'none'),
        entity: 'account:' + acct.id, before: acct.patientId || null, after: patientId || null
      });
    }
    return { ok: true, account: r.account };
  }

  // ---- guardians -----------------------------------------------------------------------------
  function guardians() {
    var rows = read(GKEY, null);
    if (!Array.isArray(rows)) { rows = []; write(GKEY, rows); }
    return rows;
  }
  function saveGuardians(rows) { write(GKEY, rows); return rows; }

  // Dependents this account is authorised to view. Only `status === 'active'` rows count.
  function dependentsOf(accountId) {
    if (!accountId) return [];
    return guardians()
      .filter(function (g) { return g.accountId === accountId && g.status === 'active'; })
      .map(function (g) { return byId(g.patientId); })
      .filter(Boolean);
  }
  function guardianRowsFor(patientId) {
    return guardians().filter(function (g) { return g.patientId === patientId; });
  }

  function addGuardian(input) {
    input = input || {};
    if (!input.accountId) return { ok: false, error: 'Choose the guardian account.' };
    if (!input.patientId) return { ok: false, error: 'Choose the dependent patient.' };
    if (!byId(input.patientId)) return { ok: false, error: 'Patient record not found.' };
    var acct = HIS.accounts && HIS.accounts.byId(input.accountId);
    if (!acct) return { ok: false, error: 'Guardian account not found.' };
    if (acct.patientId === input.patientId) return { ok: false, error: 'That account already owns this patient record.' };
    var rows = guardians();
    if (rows.some(function (g) { return g.accountId === input.accountId && g.patientId === input.patientId; })) {
      return { ok: false, error: 'That guardian link already exists.' };
    }
    var row = {
      id: 'GD-' + String(rows.length + 1).padStart(4, '0'),
      accountId: input.accountId, patientId: input.patientId,
      relationship: input.relationship || 'Guardian',
      scope: input.scope || 'appointments,billing,documents,medical',
      status: 'active',
      authorizedBy: actorName(), authorizedAt: new Date().toISOString(),
      reference: input.reference || ''
    };
    rows.push(row);
    saveGuardians(rows);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: row.authorizedBy, role: roleLabel(),
        what: 'Guardian authorisation granted \u2014 ' + acct.email + ' for ' + input.patientId + ' (' + row.relationship + ')',
        entity: 'guardian:' + row.id, before: null, after: 'active'
      });
    }
    return { ok: true, guardian: row };
  }

  function revokeGuardian(id, reason) {
    var rows = guardians();
    var i = rows.findIndex(function (g) { return g.id === id; });
    if (i < 0) return { ok: false, error: 'Guardian link not found.' };
    rows[i].status = 'revoked';
    rows[i].revokedAt = new Date().toISOString();
    rows[i].revokedBy = actorName();
    rows[i].revokeReason = reason || '';
    saveGuardians(rows);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: rows[i].revokedBy, role: roleLabel(),
        what: 'Guardian authorisation revoked \u2014 ' + rows[i].id + (reason ? ' \u00b7 ' + reason : ''),
        entity: 'guardian:' + id, before: 'active', after: 'revoked'
      });
    }
    return { ok: true, guardian: rows[i] };
  }

  // ---- cross-module reads --------------------------------------------------------------------
  // Appointments carry an explicit `pt` (patient ID) in the seed. Rows created before that field
  // existed are matched by exact full name as a fallback, never by surname alone.
  function appointmentsFor(patientId) {
    var p = byId(patientId);
    if (!p) return [];
    var list = (window.HIS && HIS.appointments) || [];
    try {
      var extra = HIS.store.get('mh_appts_extra', []);
      if (Array.isArray(extra) && extra.length) list = list.concat(extra);
    } catch (e) { /* storage blocked */ }
    return list.filter(function (a) {
      if (a.pt) return a.pt === p.id;
      var n = String(a.patient || '').trim().toLowerCase();
      return n && (n === String(p.name).toLowerCase() || n === String(p.first).toLowerCase());
    });
  }

  function invoicesFor(patientId) {
    var bills = (window.HIS && HIS.billing && HIS.billing.bills) || [];
    return bills.filter(function (b) { return b.pt === patientId; });
  }

  function stats() {
    var rows = all();
    return {
      total: rows.length,
      inpatient: rows.filter(function (p) { return p.type === 'Inpatient'; }).length,
      outpatient: rows.filter(function (p) { return p.type === 'Outpatient'; }).length,
      attention: rows.filter(function (p) { return p.attention; }).length,
      linked: rows.filter(function (p) { return !!accountFor(p.id); }).length
    };
  }

  HIS.registry = {
    KEY: PKEY, GUARDIAN_KEY: GKEY,
    all: all, save: save, byId: byId, search: search, create: create, update: update,
    nextMrn: nextMrn, duplicates: duplicates, ageFrom: ageFrom,
    accountFor: accountFor, linkAccount: linkAccount,
    guardians: guardians, dependentsOf: dependentsOf, guardianRowsFor: guardianRowsFor,
    addGuardian: addGuardian, revokeGuardian: revokeGuardian,
    appointmentsFor: appointmentsFor, invoicesFor: invoicesFor, stats: stats
  };

  // Re-point the legacy array at the registry so no module can see a different patient list.
  // `HIS.patients` was a plain array; nothing in the codebase pushes to it, so a getter is safe.
  try {
    Object.defineProperty(HIS, 'patients', {
      configurable: true, enumerable: true,
      get: function () { return HIS.registry.all(); }
    });
  } catch (e) { /* a page that froze HIS keeps its local array */ }
})();
