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
  var ROLES = {
    superadmin: {
      label: 'Super Administrator', short: 'Super Admin',
      person: { name: 'Dr. Elsie Chen', title: 'Chief Physician' },
      scope: 'Full system access, configuration, audit log and every clinical and financial screen.',
      pages: ['dashboard', 'registration', 'registration-form', 'outpatient-form', 'profile',
        'appointments', 'appointment-form', 'appointment-confirmed', 'consultation', 'treatment',
        'nursing', 'pharmacy', 'attendance', 'personnel', 'payroll', 'departments', 'billing',
        'reports', 'audit', 'accounts'],
      nav: ['dashboard', 'registration', 'appointments', 'consultation', 'treatment', 'nursing',
        'pharmacy', 'attendance', 'personnel', 'payroll', 'departments', 'billing', 'reports', 'audit', 'accounts'],
      home: 'dashboard'
    },
    hospitaladmin: {
      label: 'Hospital Administrator', short: 'Hospital Admin',
      person: { name: 'Atty. Ramon Silva', title: 'Hospital Administrator' },
      scope: 'Operational oversight: admissions, occupancy, staffing, department performance and financial summaries.',
      pages: ['dashboard', 'registration', 'profile', 'appointments', 'consultation', 'treatment',
        'nursing', 'pharmacy', 'attendance', 'personnel', 'payroll', 'departments', 'billing',
        'reports', 'audit'],
      nav: ['dashboard', 'registration', 'appointments', 'consultation', 'treatment', 'nursing',
        'pharmacy', 'attendance', 'personnel', 'payroll', 'departments', 'billing', 'reports', 'audit'],
      home: 'dashboard'
    },
    receptionist: {
      label: 'Receptionist / Front Desk', short: 'Front Desk',
      person: { name: 'Maricel Bautista', title: 'Front Desk Officer' },
      scope: 'Patient lookup, registration, appointment booking, rescheduling, check-in and the walk-in queue.',
      pages: ['dashboard', 'registration', 'registration-form', 'outpatient-form', 'profile',
        'appointments', 'appointment-form', 'appointment-confirmed'],
      nav: ['dashboard', 'registration', 'appointments'],
      home: 'dashboard'
    },
    registration: {
      label: 'Registration & Admissions', short: 'Registration',
      person: { name: 'Joel Aquino', title: 'Admissions Officer' },
      scope: 'Patient identification, demographics, PhilHealth and HMO details, inpatient and outpatient admission paperwork.',
      pages: ['dashboard', 'registration', 'registration-form', 'outpatient-form', 'profile',
        'appointments', 'appointment-form', 'appointment-confirmed'],
      nav: ['dashboard', 'registration', 'appointments'],
      home: 'registration'
    },
    doctor: {
      label: 'Doctor / Physician', short: 'Physician',
      person: { name: 'Dr. Elsie Chen', title: 'Chief Physician' },
      scope: 'Patient records, consultations, diagnoses, prescriptions, laboratory orders and follow-ups.',
      pages: ['dashboard', 'registration', 'profile', 'appointments', 'consultation', 'treatment'],
      nav: ['dashboard', 'registration', 'appointments', 'consultation', 'treatment'],
      home: 'dashboard'
    },
    nurse: {
      label: 'Nurse', short: 'Nurse',
      person: { name: 'Sofia Mendoza', title: 'Staff Nurse' },
      scope: 'Assignments, triage, vital signs, nursing assessments, medication administration and shift handover.',
      pages: ['dashboard', 'profile', 'nursing', 'treatment'],
      nav: ['dashboard', 'nursing', 'treatment'],
      home: 'dashboard'
    },
    pharmacist: {
      label: 'Pharmacist', short: 'Pharmacist',
      person: { name: 'Miguel Reyes', title: 'Pharmacist' },
      scope: 'Prescription verification, dispensing, batch and expiry tracking, stock levels and inventory reports.',
      pages: ['dashboard', 'profile', 'pharmacy', 'treatment'],
      nav: ['dashboard', 'pharmacy', 'treatment'],
      home: 'dashboard'
    },
    lab: {
      label: 'Laboratory / Diagnostic', short: 'Laboratory',
      person: { name: 'Daniel Cruz', title: 'Medical Technologist' },
      scope: 'Test requests, specimen collection and tracking, result entry, validation and critical-result alerts.',
      pages: ['dashboard', 'profile', 'treatment', 'consultation'],
      nav: ['dashboard', 'treatment', 'consultation'],
      home: 'dashboard'
    },
    cashier: {
      label: 'Cashier / Billing', short: 'Cashier',
      person: { name: 'Aileen Ramos', title: 'Cashier' },
      scope: 'Invoices, charges, payments, deposits, outstanding balances, refunds and receipts.',
      pages: ['dashboard', 'billing', 'profile'],
      nav: ['dashboard', 'billing'],
      home: 'billing'
    },
    finance: {
      label: 'Finance / Accounting', short: 'Finance',
      person: { name: 'Rowena Lim', title: 'Finance Officer' },
      scope: 'Collections, revenue, reconciliation, payer mix and financial reporting.',
      pages: ['dashboard', 'billing', 'reports'],
      nav: ['dashboard', 'billing', 'reports'],
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
      pages: ['dashboard', 'departments', 'personnel', 'attendance', 'profile'],
      nav: ['dashboard', 'departments', 'personnel', 'attendance'],
      home: 'departments'
    },
    auditor: {
      label: 'Auditor / Compliance', short: 'Auditor',
      person: { name: 'Ferdinand Yap', title: 'Compliance Auditor' },
      scope: 'Read-only access to the audit trail, payment history, payroll changes and administrative activity.',
      pages: ['dashboard', 'billing', 'payroll', 'profile', 'audit', 'reports'],
      nav: ['dashboard', 'billing', 'payroll', 'audit', 'reports'],
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
  var NAV = [
    ['dashboard', 'Dashboard', 'grid'],
    ['registration', 'Registration', 'users'],
    ['appointments', 'Appointments', 'calendar-check'],
    ['consultation', 'Consultation', 'clipboard-plus'],
    ['treatment', 'Treatment', 'bag'],
    ['nursing', 'Nursing', 'heart'],
    ['pharmacy', 'Pharmacy', 'pill'],
    ['attendance', 'Staff', 'users'],
    ['personnel', 'Personnel', 'id'],
    ['payroll', 'Payroll', 'peso'],
    ['departments', 'Departments', 'branches'],
    ['billing', 'Billing', 'receipt'],
    ['reports', 'Reports', 'chart'],
    ['audit', 'Audit log', 'shield'],
    ['accounts', 'Accounts', 'key']
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
    allows: allows, nav: nav, home: home, guard: guard
  };
})();
