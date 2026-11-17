// Role-based access (M1). A frontend DEMONSTRATION of role-scoped navigation and page access.
//
// THIS IS NOT SECURITY. Every "restriction" below is enforced in the browser and is trivially
// bypassable. It exists to show how the same dataset looks from each hospital role's point of view.
// See docs/DESIGN-LOCK.md §10 for the addition rules this UI follows.
//
// Default role is `superadmin`, whose demo persona is Dr. Elsie Chen / Chief Physician — the same
// identity the header already rendered before this module existed. That keeps the shipped pages
// pixel-identical at rest (verified with scripts/visual-check.mjs) while making every other role
// reachable from the header switcher.
//
// Persisted in `mh_role` through HIS.store; load store.js and audit.js first.
(function () {
  var KEY = 'mh_role';

  // `pages` are page stems (filename without .html). `nav` is the order of the drawer links.
  // `home` must always be present in `pages`.
  var ROLES = {
    superadmin: {
      label: 'Super Administrator', short: 'Super Admin',
      person: { name: 'Dr. Elsie Chen', title: 'Chief Physician' },
      scope: 'Full system access, configuration, audit log and every clinical and financial screen.',
      pages: ['dashboard', 'registration', 'registration-form', 'outpatient-form', 'profile',
        'appointments', 'appointment-form', 'appointment-confirmed', 'consultation', 'treatment',
        'nursing', 'pharmacy', 'attendance', 'personnel', 'payroll', 'departments', 'billing'],
      nav: ['dashboard', 'registration', 'appointments', 'consultation', 'treatment', 'nursing',
        'pharmacy', 'attendance', 'personnel', 'payroll', 'departments', 'billing'],
      home: 'dashboard'
    },
    hospitaladmin: {
      label: 'Hospital Administrator', short: 'Hospital Admin',
      person: { name: 'Atty. Ramon Silva', title: 'Hospital Administrator' },
      scope: 'Operational oversight: admissions, occupancy, staffing, department performance and financial summaries.',
      pages: ['dashboard', 'registration', 'profile', 'appointments', 'consultation', 'treatment',
        'nursing', 'pharmacy', 'attendance', 'personnel', 'payroll', 'departments', 'billing'],
      nav: ['dashboard', 'registration', 'appointments', 'consultation', 'treatment', 'nursing',
        'pharmacy', 'attendance', 'personnel', 'payroll', 'departments', 'billing'],
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
      pages: ['dashboard', 'billing'],
      nav: ['dashboard', 'billing'],
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
      pages: ['dashboard', 'billing', 'payroll', 'profile'],
      nav: ['dashboard', 'billing', 'payroll'],
      home: 'dashboard'
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
    ['billing', 'Billing', 'receipt']
  ];

  function key() {
    var k = HIS.store.get(KEY, 'superadmin');
    return ROLES[k] ? k : 'superadmin';
  }
  function current() { return ROLES[key()]; }
  function person() { return current().person; }
  function stem() {
    var f = (location.pathname.split('/').pop() || 'index.html').replace(/\.html$/, '');
    return f || 'index';
  }
  function allows(page) { return current().pages.indexOf(page || stem()) > -1; }
  function nav() {
    var allowed = current().nav;
    return NAV.filter(function (n) { return allowed.indexOf(n[0]) > -1; });
  }
  // Switch role, persist, audit, then land on a page the new role can actually open.
  function set(k, opts) {
    if (!ROLES[k]) return false;
    var from = key();
    HIS.store.set(KEY, k);
    if (!(opts && opts.silent) && window.HIS.audit) {
      HIS.audit.append({
        who: ROLES[k].person.name, role: ROLES[k].label,
        what: 'Switched role: ' + ROLES[from].label + ' \u2192 ' + ROLES[k].label,
        entity: 'session', before: from, after: k
      });
    }
    return true;
  }
  // Land on the role's home when the current page is out of scope.
  function home() {
    var r = current();
    return r.external || (r.home + '.html');
  }
  function guard() {
    if (allows()) return true;
    location.replace(home());
    return false;
  }

  HIS.rbac = {
    KEY: KEY, ROLES: ROLES, NAV: NAV,
    key: key, current: current, person: person, stem: stem,
    allows: allows, nav: nav, set: set, home: home, guard: guard
  };
})();
