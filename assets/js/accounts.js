// Account store (M3). Individual demo identities, one per role.
//
// THIS IS A DEMONSTRATION IDENTITY SYSTEM, NOT SECURITY.
// Everything lives in localStorage on a public static site. Anyone can read, edit or delete it.
// The "password verifier" below is a fast non-cryptographic digest, NOT a password hash, and it
// must never be described as one. Real authentication requires a server holding an Argon2/bcrypt
// hash and issuing an HttpOnly session cookie — see docs/AUTH.md.
//
// Storage: `mh_accounts` (array of records). Seeded once, then owned by the Super Administrator
// screen. Never stores a plaintext password.
(function () {
  var KEY = 'mh_accounts';

  // Public demo password for every seeded account. Documented in docs/AUTH.md and shown on the
  // sign-in screen. There is no secrecy claim: this is a demo, not a credential.
  var DEMO_PASSWORD = 'MediHeal2026!';

  // FNV-1a 32-bit, applied twice with different seeds, rendered as 16 hex chars.
  // NOT a password hash: no salt, no work factor, trivially reversible by brute force.
  function digest(s) {
    var str = String(s == null ? '' : s);
    function fnv(seed) {
      var h = seed >>> 0;
      for (var i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return ('0000000' + h.toString(16)).slice(-8);
    }
    return fnv(0x811c9dc5) + fnv(0x01000193);
  }

  function norm(email) { return String(email == null ? '' : email).trim().toLowerCase(); }

  // Seeded roster. `role` keys must exist in HIS.rbac.ROLES; `patientId` links the patient account
  // to a real hospital record (M5). Emails are `.test` reserved names, not real mailboxes.
  //
  // 2026-11-22 — eleven accounts, not fourteen. Hospital Administrator, Receptionist and Cashier
  // were removed when their roles were merged (see the note in rbac.js): the demo was listing the
  // same person's work under two names, and a fourteen-row account list is a wall, not a roster.
  var SEED = [
    ['superadmin@mediheal.test', 'Dr. Elsie Chen', 'superadmin', 'Administration', 'Chief Physician', null],
    ['reception@mediheal.test', 'Maricel Bautista', 'registration', 'Front Desk', 'Front Desk Officer', null],
    ['doctor@mediheal.test', 'Dr. Laurice Laureta', 'doctor', 'Cardiology', 'Consultant', null],
    ['nurse@mediheal.test', 'Sofia Mendoza', 'nurse', 'Nursing', 'Staff Nurse', null],
    ['pharmacy@mediheal.test', 'Miguel Reyes', 'pharmacist', 'Pharmacy', 'Pharmacist', null],
    ['laboratory@mediheal.test', 'Daniel Cruz', 'lab', 'Laboratory', 'Medical Technologist', null],
    ['finance@mediheal.test', 'Rowena Lim', 'finance', 'Billing', 'Billing & Finance Officer', null],
    ['hr@mediheal.test', 'Carmela Dizon', 'hr', 'Human Resources', 'HR Officer', null],
    ['department.head@mediheal.test', 'Dr. Marc Laureta', 'depthead', 'Orthopedics', 'Department Head', null],
    ['auditor@mediheal.test', 'Ferdinand Yap', 'auditor', 'Compliance', 'Compliance Auditor', null],
    ['patient@mediheal.test', 'Isabel Geliz V. Ramos', 'patient', 'Patient', 'Patient', 'PT-99213']
  ];

  function seed() {
    var now = new Date().toISOString();
    return SEED.map(function (s, i) {
      return {
        id: 'USR-' + ('000' + (i + 1)).slice(-4),
        email: s[0],
        name: s[1],
        role: s[2],
        dept: s[3],
        title: s[4],
        patientId: s[5],
        status: 'active',
        verifier: digest(DEMO_PASSWORD),
        createdAt: now,
        lastLogin: null,
        resetRequired: false,
        seeded: true
      };
    });
  }

  function all() {
    var rows = HIS.store.get(KEY, null);
    if (!Array.isArray(rows) || !rows.length) {
      rows = seed();
      HIS.store.set(KEY, rows);
    }
    return rows;
  }
  function save(rows) { HIS.store.set(KEY, rows); return rows; }
  function byEmail(email) {
    var e = norm(email);
    return all().filter(function (a) { return norm(a.email) === e; })[0] || null;
  }
  function byId(id) { return all().filter(function (a) { return a.id === id; })[0] || null; }
  function exists(email) { return !!byEmail(email); }
  function nextId(rows) {
    var n = rows.reduce(function (m, a) {
      var v = parseInt(String(a.id).replace(/\D/g, ''), 10);
      return isNaN(v) ? m : Math.max(m, v);
    }, 0);
    return 'USR-' + ('000' + (n + 1)).slice(-4);
  }

  function verify(account, password) {
    return !!account && account.verifier === digest(password);
  }

  // Create. Returns { ok, account } or { ok:false, error }.
  function create(input) {
    input = input || {};
    var email = norm(input.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a valid email address.' };
    var rows = all();
    if (rows.some(function (a) { return norm(a.email) === email; })) return { ok: false, error: 'An account with that email already exists.' };
    if (!HIS.rbac || !HIS.rbac.ROLES[input.role]) return { ok: false, error: 'Choose a valid role.' };
    var acct = {
      id: nextId(rows), email: email, name: String(input.name || '').trim() || email.split('@')[0],
      role: input.role, dept: String(input.dept || '').trim(), title: String(input.title || '').trim(),
      patientId: input.patientId || null, status: 'active',
      verifier: digest(input.password || DEMO_PASSWORD), createdAt: new Date().toISOString(),
      lastLogin: null, resetRequired: false, seeded: false
    };
    rows.push(acct);
    save(rows);
    return { ok: true, account: acct };
  }

  // Patch a record. Refuses to remove the last active Super Administrator.
  function update(id, patch) {
    var rows = all();
    var i = rows.findIndex(function (a) { return a.id === id; });
    if (i < 0) return { ok: false, error: 'Account not found.' };
    var before = rows[i];
    var after = Object.assign({}, before, patch);
    if (before.role === 'superadmin' && (after.role !== 'superadmin' || after.status !== 'active')) {
      var remaining = rows.filter(function (a) {
        return a.id !== id && a.role === 'superadmin' && a.status === 'active';
      }).length;
      if (!remaining) return { ok: false, error: 'This is the last active Super Administrator. Promote another account first.' };
    }
    rows[i] = after;
    save(rows);
    return { ok: true, before: before, account: after };
  }

  function setPassword(id, password) {
    var rows = all();
    var i = rows.findIndex(function (a) { return a.id === id; });
    if (i < 0) return { ok: false, error: 'Account not found.' };
    if (String(password || '').length < 8) return { ok: false, error: 'Use at least 8 characters.' };
    rows[i].verifier = digest(password);
    rows[i].resetRequired = true;
    save(rows);
    return { ok: true };
  }

  function touchLogin(id) {
    var rows = all();
    var i = rows.findIndex(function (a) { return a.id === id; });
    if (i < 0) return;
    rows[i].lastLogin = new Date().toISOString();
    save(rows);
  }

  function stats() {
    var rows = all();
    return {
      total: rows.length,
      active: rows.filter(function (a) { return a.status === 'active'; }).length,
      inactive: rows.filter(function (a) { return a.status !== 'active'; }).length,
      byRole: rows.reduce(function (m, a) { m[a.role] = (m[a.role] || 0) + 1; return m; }, {})
    };
  }

  HIS.accounts = {
    KEY: KEY, DEMO_PASSWORD: DEMO_PASSWORD, digest: digest, norm: norm,
    all: all, save: save, byEmail: byEmail, byId: byId, exists: exists,
    verify: verify, create: create, update: update, setPassword: setPassword,
    touchLogin: touchLogin, stats: stats
  };
})();
