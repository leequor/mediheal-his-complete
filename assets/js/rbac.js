// Role-based access (M1, reworked in M3 to account-based identity).
//
// The active role is resolved from the SIGNED-IN ACCOUNT (`HIS.auth.account().role`), never from a
// user-editable role string. There is no role switcher: a person signs in with their own email and
// the account record decides everything.
//
// THIS IS NOT SECURITY. Every "restriction" below is enforced in the browser and is trivially
// bypassable. It shows how the same dataset looks from each hospital role's point of view.
// See docs/DESIGN-LOCK.md §10 for the addition rules this UI follows, and docs/AUTH.md for what a
// real deployment would need.
//
// Load order: data.js -> store.js -> audit.js -> kit.js -> accounts.js -> auth.js -> rbac.js.
(function () {
  // `pages` are page stems (filename without .html). `nav` is the order of the drawer links.
  // `home` must always be present in `pages`.
  //
  // 2026-11-22 — the roster was cut from 14 roles to 11. Three of them overlapped enough that the
  // demo was showing the same work twice: Hospital Administrator duplicated the Super Administrator
  // (every page except Accounts), Receptionist duplicated Front Desk Registration, and Cashier
  // duplicated Billing & Finance. Merging them keeps every screen reachable and makes the account
  // list readable. `registration` and `finance` below are the merged roles.
  var ROLES = {
    superadmin: {
      label: 'Super Administrator', short: 'Super Admin',
      person: { name: 'Dr. Elsie Chen', title: 'Chief Physician' },
      scope: 'Full system access, configuration, audit log and every clinical and financial screen.',
      pages: ['dashboard', 'registration', 'registration-form', 'outpatient-form', 'profile',
        'appointments', 'appointment-form', 'appointment-confirmed', 'admissions', 'consultation', 'treatment',
        'nursing', 'pharmacy', 'laboratory', 'charges', 'attendance', 'personnel', 'payroll', 'departments', 'billing',
        'claims', 'reports', 'audit', 'accounts', 'settings'],
      nav: ['dashboard', 'registration', 'admissions', 'appointments', 'consultation', 'treatment', 'nursing',
        'pharmacy', 'laboratory', 'charges', 'attendance', 'personnel', 'payroll', 'departments', 'billing', 'claims', 'reports', 'audit', 'accounts', 'settings'],
      home: 'dashboard'
    },
    registration: {
      label: 'Front Desk & Registration', short: 'Front Desk',
      person: { name: 'Maricel Bautista', title: 'Front Desk Officer' },
      scope: 'Patient lookup and registration, appointment booking and check-in, the walk-in queue, and the corrections patients send from the portal.',
      pages: ['dashboard', 'registration', 'registration-form', 'outpatient-form', 'profile',
        'appointments', 'appointment-form', 'appointment-confirmed', 'admissions'],
      nav: ['dashboard', 'registration', 'admissions', 'appointments'],
      home: 'registration'
    },
    doctor: {
      label: 'Doctor / Physician', short: 'Physician',
      person: { name: 'Dr. Elsie Chen', title: 'Chief Physician' },
      scope: 'Patient records, consultations, diagnoses, prescriptions, laboratory orders and follow-ups.',
      pages: ['dashboard', 'registration', 'profile', 'appointments', 'consultation', 'treatment', 'laboratory', 'pharmacy'],
      nav: ['dashboard', 'registration', 'appointments', 'consultation', 'treatment', 'laboratory', 'pharmacy'],
      home: 'dashboard'
    },
    nurse: {
      label: 'Nurse', short: 'Nurse',
      person: { name: 'Sofia Mendoza', title: 'Staff Nurse' },
      scope: 'Assignments, triage, vital signs, nursing assessments, medication administration and shift handover.',
      pages: ['dashboard', 'profile', 'admissions', 'nursing', 'treatment', 'laboratory', 'pharmacy'],
      nav: ['dashboard', 'admissions', 'nursing', 'treatment', 'laboratory', 'pharmacy'],
      home: 'dashboard'
    },
    pharmacist: {
      label: 'Pharmacist', short: 'Pharmacist',
      person: { name: 'Miguel Reyes', title: 'Pharmacist' },
      scope: 'Prescription verification, dispensing, batch and expiry tracking, stock levels and inventory reports.',
      pages: ['dashboard', 'profile', 'pharmacy', 'laboratory', 'treatment'],
      nav: ['dashboard', 'pharmacy', 'laboratory', 'treatment'],
      home: 'pharmacy'
    },
    lab: {
      label: 'Laboratory / Diagnostic', short: 'Laboratory',
      person: { name: 'Daniel Cruz', title: 'Medical Technologist' },
      scope: 'Test requests, specimen collection and tracking, result entry, validation and critical-result alerts.',
      pages: ['dashboard', 'laboratory', 'profile', 'treatment', 'consultation'],
      nav: ['dashboard', 'laboratory', 'treatment', 'consultation'],
      home: 'laboratory'
    },
    finance: {
      label: 'Billing & Finance', short: 'Billing',
      person: { name: 'Rowena Lim', title: 'Billing & Finance Officer' },
      scope: 'Invoices, charges, payments and receipts, payer claims, collections, reconciliation and financial reporting.',
      pages: ['dashboard', 'billing', 'charges', 'claims', 'reports', 'profile'],
      nav: ['dashboard', 'billing', 'charges', 'claims', 'reports'],
      home: 'billing'
    },
    hr: {
      label: 'HR / Payroll Officer', short: 'HR',
      person: { name: 'Carmela Dizon', title: 'HR Officer' },
      scope: 'Personnel, attendance, shifts, leave, payroll, deductions and payslips.',
      pages: ['dashboard', 'personnel', 'attendance', 'payroll'],
      nav: ['dashboard', 'personnel', 'attendance', 'payroll'],
      home: 'payroll'
    },
    depthead: {
      label: 'Department Head', short: 'Dept Head',
      person: { name: 'Dr. Laurice Laureta', title: 'Cardiology Head' },
      scope: 'Department staffing, workload, patient queues, statistics and attendance.',
      pages: ['dashboard', 'departments', 'admissions', 'personnel', 'attendance', 'profile'],
      nav: ['dashboard', 'departments', 'admissions', 'personnel', 'attendance'],
      home: 'departments'
    },
    auditor: {
      label: 'Auditor / Compliance', short: 'Auditor',
      person: { name: 'Ferdinand Yap', title: 'Compliance Auditor' },
      scope: 'Read-only access to the audit trail, payment history, payroll changes and administrative activity.',
      pages: ['dashboard', 'billing', 'charges', 'claims', 'payroll', 'profile', 'audit', 'reports'],
      nav: ['dashboard', 'billing', 'charges', 'claims', 'payroll', 'audit', 'reports'],
      home: 'audit'
    },
    patient: {
      label: 'Patient / Guardian', short: 'Patient',
      person: { name: 'Patient Portal', title: 'Patient' },
      scope: 'Appointments, billing statements, authorised documents and dependent profiles — in the separate patient portal.',
      pages: [], nav: [], home: 'portal', external: 'portal.html'
    }
  };

  // Nav metadata lives here so rbac.js owns the whole navigation model.
  // [stem, label, icon, group]. The group is what the drawer prints as a section heading; a role
  // with items in one group only (Front Desk) gets no headings at all.
  var NAV = [
    ['dashboard', 'Dashboard', 'grid', 'Overview'],
    ['registration', 'Registration', 'users', 'Patients'],
    ['admissions', 'Admissions', 'bed', 'Patients'],
    ['appointments', 'Appointments', 'calendar-check', 'Patients'],
    ['consultation', 'Consultation', 'clipboard-plus', 'Clinical'],
    ['treatment', 'Treatment', 'bag', 'Clinical'],
    ['nursing', 'Nursing', 'heart', 'Clinical'],
    ['pharmacy', 'Pharmacy', 'pill', 'Clinical'],
    ['laboratory', 'Laboratory', 'flask', 'Clinical'],
    ['charges', 'Charges', 'tag', 'Revenue'],
    ['billing', 'Billing', 'receipt', 'Revenue'],
    ['claims', 'Claims', 'claim', 'Revenue'],
    ['personnel', 'Personnel', 'id', 'People'],
    ['attendance', 'Attendance', 'users', 'People'],
    ['payroll', 'Payroll', 'peso', 'People'],
    ['departments', 'Departments', 'branches', 'Organisation'],
    ['reports', 'Reports', 'chart', 'Organisation'],
    ['audit', 'Audit log', 'shield', 'Organisation'],
    ['accounts', 'Accounts', 'key', 'Organisation'],
    ['settings', 'Configuration', 'sliders', 'Organisation']
  ];

  // No session means no role. A guest role keeps every helper total instead of returning undefined.
  var GUEST = { label: 'Signed out', short: 'Guest', person: { name: 'Signed out', title: '' }, scope: '', pages: [], nav: [], home: 'index' };

  function key() {
    if (!window.HIS.auth) return null;
    var a = HIS.auth.account();
    return a && ROLES[a.role] ? a.role : null;
  }
  function current() { return ROLES[key()] || GUEST; }
  // Identity always comes from the signed-in account record, never from a stored role string.
  function person() {
    var a = window.HIS.auth ? HIS.auth.account() : null;
    if (a) return { name: a.name, title: a.title || ROLES[a.role].label, email: a.email, dept: a.dept };
    return GUEST.person;
  }
  function stem() {
    var f = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
    return f || 'index';
  }
  function allows(page) { return current().pages.indexOf(page || stem()) > -1; }
  function nav() {
    var allowed = current().nav;
    return NAV.filter(function (n) { return allowed.indexOf(n[0]) > -1; });
  }
  // Same links, grouped for the drawer. A role with a single group returns one entry so the
  // renderer can skip the heading.
  function navGroups() {
    var out = [], seen = {};
    nav().forEach(function (n) {
      var g = n[3] || 'Menu';
      if (!seen[g]) { seen[g] = { group: g, items: [] }; out.push(seen[g]); }
      seen[g].items.push(n);
    });
    return out;
  }
  // Land on the role's home when the current page is out of scope.
  function home() {
    var r = current();
    if (!r.home) return 'index.html';
    return r.external || (r.home + '.html');
  }
  // Route guard: authentication first, then role scope.
  function guard() {
    if (window.HIS.auth && !HIS.auth.requireAuth()) return false;
    if (!allows()) { location.replace(home()); return false; }
    return true;
  }

  HIS.rbac = {
    ROLES: ROLES, NAV: NAV,
    key: key, current: current, person: person, stem: stem,
    allows: allows, nav: nav, navGroups: navGroups, home: home, guard: guard
  };
})();
