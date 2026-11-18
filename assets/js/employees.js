// Employee master (M10).
//
// WHY THIS FILE EXISTS
// M8 stored `basic: 60000` on the payroll row and payroll-calc.js treated that number as the pay
// for the PERIOD, then multiplied it by two to get a "monthly equivalent" for the contribution
// tables. Those numbers are monthly salaries: 60,000 for a chief physician, 26,000 for an
// administrative officer. Treating them as semi-monthly amounts doubled every salary (an
// administrative officer on 52,000 a month) and doubled every contribution and tax base with it.
//
// The master below stores ONE salary fact per person — `monthlyBasic` — and the engine derives the
// period amount from the pay frequency. There is no second, competing "basic for the period".
//
// `category` decides which labour rules apply. Managerial employees are not covered by the
// rank-and-file overtime and night-differential provisions of the Labor Code (Art. 82), so the
// engine pays them no OT or ND premium unless the hospital grants it by policy. That is a real
// distinction in Philippine payroll and it is why the field is here.
//
// Allowances are itemised because only some of them are taxable. A rice allowance is a de minimis
// benefit and is excluded from taxable compensation (BIR RR 11-2018, as amended); a professional
// allowance is ordinary compensation and is taxed. The 13th month is computed on basic only
// (PD 851, Sec. 2(a)) — never on allowances, overtime, night differential or premiums.
//
// DEMO DATA. Every person below is synthetic. Salary bands are plausible for a 60-bed private
// hospital in Metro Manila; they are not market data.
(function () {
  var EMPLOYEES = [
    {
      id: 'EMP-001', name: 'Dr. Elsie Chen', role: 'Chief Physician', dept: 'Administration',
      category: 'managerial', employment: 'regular', hired: '2016-02-01',
      monthlyBasic: 60000,
      allowances: [
        { label: 'Professional allowance', amount: 6000, taxable: true },
        { label: 'Rice allowance', amount: 2000, taxable: false }
      ],
      shift: { start: '08:00', end: '17:00', breakMinutes: 60 },
      restDays: [0, 6],
      tin: '123-456-789-000', sss: '34-1234567-8', philhealth: '12-345678901-2', pagibig: '1234-5678-9012'
    },
    {
      id: 'EMP-002', name: 'Dr. Laurice Laureta', role: 'Consultant', dept: 'Cardiology',
      category: 'managerial', employment: 'regular', hired: '2017-06-15',
      monthlyBasic: 55000,
      allowances: [
        { label: 'Professional allowance', amount: 5000, taxable: true },
        { label: 'Rice allowance', amount: 1500, taxable: false }
      ],
      shift: { start: '08:00', end: '17:00', breakMinutes: 60 },
      restDays: [0, 6],
      tin: '123-456-789-001', sss: '34-1234568-9', philhealth: '12-345678902-3', pagibig: '1234-5678-9013'
    },
    {
      id: 'EMP-003', name: 'Dr. Marc Laureta', role: 'Consultant', dept: 'Orthopedics',
      category: 'managerial', employment: 'regular', hired: '2018-01-08',
      monthlyBasic: 50000,
      allowances: [
        { label: 'Professional allowance', amount: 4500, taxable: true },
        { label: 'Rice allowance', amount: 1500, taxable: false }
      ],
      shift: { start: '08:00', end: '17:00', breakMinutes: 60 },
      restDays: [0, 6],
      tin: '123-456-789-002', sss: '34-1234569-0', philhealth: '12-345678903-4', pagibig: '1234-5678-9014'
    },
    {
      id: 'EMP-004', name: 'Dr. Yumie Pasiol', role: 'Resident Physician', dept: 'General Medicine',
      category: 'rank-and-file', employment: 'regular', hired: '2021-07-01',
      monthlyBasic: 42000,
      allowances: [
        { label: 'Professional allowance', amount: 3000, taxable: true },
        { label: 'Rice allowance', amount: 1500, taxable: false }
      ],
      shift: { start: '08:00', end: '17:00', breakMinutes: 60 },
      restDays: [0, 6],
      tin: '123-456-789-003', sss: '34-1234570-3', philhealth: '12-345678904-5', pagibig: '1234-5678-9015'
    },
    {
      id: 'EMP-005', name: 'Andrea Santos', role: 'Head Nurse', dept: 'Nursing',
      category: 'rank-and-file', employment: 'regular', hired: '2019-09-16',
      monthlyBasic: 35000,
      allowances: [
        { label: 'Professional allowance', amount: 2500, taxable: true },
        { label: 'Rice allowance', amount: 1500, taxable: false }
      ],
      shift: { start: '07:00', end: '15:00', breakMinutes: 0 },
      restDays: [0, 6],
      tin: '123-456-789-004', sss: '34-1234571-4', philhealth: '12-345678905-6', pagibig: '1234-5678-9016'
    },
    {
      id: 'EMP-006', name: 'Miguel Reyes', role: 'Medical Technologist', dept: 'Laboratory',
      category: 'rank-and-file', employment: 'regular', hired: '2020-11-03',
      monthlyBasic: 32000,
      allowances: [
        { label: 'Professional allowance', amount: 2000, taxable: true },
        { label: 'Rice allowance', amount: 1500, taxable: false }
      ],
      shift: { start: '08:00', end: '17:00', breakMinutes: 60 },
      restDays: [0, 6],
      tin: '123-456-789-005', sss: '34-1234572-5', philhealth: '12-345678906-7', pagibig: '1234-5678-9017'
    },
    {
      id: 'EMP-007', name: 'Sofia Mendoza', role: 'Pharmacist', dept: 'Pharmacy',
      category: 'rank-and-file', employment: 'regular', hired: '2022-02-14',
      monthlyBasic: 28000,
      allowances: [
        { label: 'Professional allowance', amount: 1500, taxable: true },
        { label: 'Rice allowance', amount: 1500, taxable: false }
      ],
      shift: { start: '09:00', end: '18:00', breakMinutes: 60 },
      restDays: [0, 6],
      tin: '123-456-789-006', sss: '34-1234573-6', philhealth: '12-345678907-8', pagibig: '1234-5678-9018'
    },
    {
      id: 'EMP-008', name: 'Daniel Cruz', role: 'Administrative Officer', dept: 'Administration',
      category: 'rank-and-file', employment: 'regular', hired: '2023-04-17',
      monthlyBasic: 26000,
      allowances: [
        { label: 'Professional allowance', amount: 1000, taxable: true },
        { label: 'Rice allowance', amount: 1500, taxable: false }
      ],
      shift: { start: '08:00', end: '17:00', breakMinutes: 60 },
      restDays: [0, 6],
      tin: '123-456-789-007', sss: '34-1234574-7', philhealth: '12-345678908-9', pagibig: '1234-5678-9019'
    }
  ];

  function byId(id) {
    return EMPLOYEES.filter(function (e) { return e.id === id; })[0] || null;
  }
  function all() { return EMPLOYEES.slice(); }
  function monthlyAllowance(e) {
    return (e.allowances || []).reduce(function (t, a) { return t + Number(a.amount || 0); }, 0);
  }
  function monthlyTaxableAllowance(e) {
    return (e.allowances || []).reduce(function (t, a) {
      return t + (a.taxable ? Number(a.amount || 0) : 0);
    }, 0);
  }
  function monthlyNonTaxableAllowance(e) {
    return monthlyAllowance(e) - monthlyTaxableAllowance(e);
  }

  HIS.employees = {
    all: all, byId: byId,
    monthlyAllowance: monthlyAllowance,
    monthlyTaxableAllowance: monthlyTaxableAllowance,
    monthlyNonTaxableAllowance: monthlyNonTaxableAllowance
  };
})();
