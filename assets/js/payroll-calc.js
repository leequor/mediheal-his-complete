// Philippine statutory payroll calculation (M8).
//
// WHY THIS FILE EXISTS
// payroll.js used to reverse-engineer the stored `ded` figure with invented rates:
//     phil = basic * 0.025;  sss = min(1350, basic * 0.0225);  pag = 750;
//     tax  = ded - phil - sss - pag;
// The tax was therefore whatever was left over — the "calculation" could not disagree with the
// number it was supposed to be checking. Nothing here is invented now, and `ded` is no longer read.
//
// SOURCES — read these before changing a rate. Every rule carries its effective date.
//   SSS          15% of the Monthly Salary Credit, employee share 5%, employer 10%.
//                MSC floor PHP 5,000, ceiling PHP 35,000, in PHP 500 steps.
//                SSS Circular No. 2024-006, effective January 2025; unchanged for 2026.
//   PhilHealth   5% of monthly basic salary, employee share 2.5%.
//                Salary floor PHP 10,000, ceiling PHP 100,000 (premium floor PHP 500, ceiling
//                PHP 5,000). Premium rate under the Universal Health Care Act schedule.
//   Pag-IBIG     2% employee share of the Fund Salary Credit, capped at PHP 10,000
//                (maximum PHP 200 per month). HDMF Circular No. 460.
//   Withholding  BIR graduated rates on taxable compensation, TRAIN law as amended by RA 10963
//                and RA 11956. The semi-monthly table below is the one a semi-monthly payroll uses.
//
// THIS IS NOT LEGAL OR ACCOUNTING ADVICE AND NOT A COMPLIANCE CLAIM. Rates change by circular;
// the config is dated so a stale table is visible rather than silent, and `verify()` reports how
// old it is. A real deployment must confirm every figure against the current issuances and have
// the payroll reviewed by a Philippine accountant.
//
// PAY PERIOD: the demo payroll is semi-monthly (Aug 16-31). Statutory contributions are MONTHLY
// amounts, so each is computed on the monthly equivalent and halved — which is how a semi-monthly
// payroll actually withholds them.
(function () {
  var CONFIG = {
    effectiveFrom: '2025-01-01',
    reviewedOn: '2026-08-31',
    period: { type: 'semi-monthly', periodsPerMonth: 2 },
    currency: 'PHP',
    sss: {
      source: 'SSS Circular No. 2024-006 (effective Jan 2025)',
      totalRate: 0.15, employeeRate: 0.05, employerRate: 0.10,
      mscFloor: 5000, mscCeiling: 35000, mscStep: 500
    },
    philhealth: {
      source: 'Universal Health Care Act premium schedule (5% total, 2.5% employee)',
      totalRate: 0.05, employeeRate: 0.025,
      salaryFloor: 10000, salaryCeiling: 100000
    },
    pagibig: {
      source: 'HDMF Circular No. 460 (Fund Salary Credit cap PHP 10,000)',
      employeeRate: 0.02, fundSalaryCap: 10000
    },
    bir: {
      source: 'TRAIN law as amended (RA 10963, RA 11956) - semi-monthly withholding table',
      // [lower bound of the bracket, base tax, marginal rate, lower bound the rate applies over]
      semiMonthly: [
        { upTo: 10417, base: 0, rate: 0, over: 0 },
        { upTo: 16667, base: 0, rate: 0.15, over: 10417 },
        { upTo: 33333, base: 937.50, rate: 0.20, over: 16667 },
        { upTo: 83333, base: 4270.70, rate: 0.25, over: 33333 },
        { upTo: 333333, base: 16770.70, rate: 0.30, over: 83333 },
        { upTo: Infinity, base: 91770.70, rate: 0.35, over: 333333 }
      ]
    }
  };

  var round2 = function (n) { return Math.round(Number(n || 0) * 100) / 100; };
  var clamp = function (n, lo, hi) { return Math.min(hi, Math.max(lo, n)); };

  // Monthly Salary Credit: the bracket whose range contains the salary, in PHP 500 steps.
  function msc(monthly) {
    var c = CONFIG.sss;
    var stepped = Math.ceil(monthly / c.mscStep) * c.mscStep;
    return clamp(stepped, c.mscFloor, c.mscCeiling);
  }

  // ---- monthly statutory amounts -------------------------------------------------------------
  function sssMonthly(monthly) {
    return round2(msc(monthly) * CONFIG.sss.employeeRate);
  }
  function philhealthMonthly(monthly) {
    var c = CONFIG.philhealth;
    return round2(clamp(monthly, c.salaryFloor, c.salaryCeiling) * c.employeeRate);
  }
  function pagibigMonthly(monthly) {
    var c = CONFIG.pagibig;
    return round2(Math.min(monthly, c.fundSalaryCap) * c.employeeRate);
  }

  // BIR withholding for one semi-monthly period, on taxable compensation for that period.
  function birSemiMonthly(taxable) {
    var table = CONFIG.bir.semiMonthly;
    for (var i = 0; i < table.length; i++) {
      if (taxable <= table[i].upTo) {
        var b = table[i];
        if (!b.rate) return 0;
        return round2(b.base + (taxable - b.over) * b.rate);
      }
    }
    return 0;
  }

  // ---- the calculation -----------------------------------------------------------------------
  // `emp.basic` is the BASIC PAY FOR THE PERIOD (the Payroll column is "Basic salary" for the
  // period, and the period is Aug 16-31). The monthly equivalent is what the contribution tables
  // are keyed on.
  function compute(emp, opts) {
    opts = opts || {};
    var cfg = CONFIG.period;
    var basic = Number(emp.basic) || 0;
    var allow = Number(emp.allow) || 0;
    var monthlyEquivalent = basic * cfg.periodsPerMonth;

    var sssM = sssMonthly(monthlyEquivalent);
    var philM = philhealthMonthly(monthlyEquivalent);
    var pagM = pagibigMonthly(monthlyEquivalent);

    var sss = round2(sssM / cfg.periodsPerMonth);
    var phil = round2(philM / cfg.periodsPerMonth);
    var pag = round2(pagM / cfg.periodsPerMonth);

    var gross = round2(basic + allow);

    // You cannot withhold more than the employee earned. Below the contribution floor a small
    // gross would otherwise produce a negative payslip (₱1 of pay against ₱250 of contributions),
    // so the employee share is scaled to the pay and the employer carries the remainder — which is
    // what happens in practice. The flag is reported so a payslip can say so.
    var capped = false;
    var statutory = round2(sss + phil + pag);
    if (statutory > gross && statutory > 0) {
      var f = gross / statutory;
      sss = round2(sss * f);
      phil = round2(phil * f);
      pag = round2(pag * f);
      statutory = round2(sss + phil + pag);
      capped = true;
    }

    // Contributions are deductible from gross compensation before withholding tax.
    var taxable = round2(Math.max(0, gross - statutory));
    var tax = birSemiMonthly(taxable);

    // Other deductions cannot push pay below zero either.
    var other = round2(Number(emp.otherDeductions) || 0);
    var room = round2(gross - statutory - tax);
    if (other > room) { other = Math.max(0, room); capped = true; }

    var deductions = round2(statutory + tax + other);
    var net = round2(Math.max(0, gross - deductions));

    return {
      basic: basic, allowances: allow, gross: gross,
      monthlyEquivalent: monthlyEquivalent,
      msc: msc(monthlyEquivalent),
      sss: sss, philhealth: phil, pagibig: pag, tax: tax, other: other,
      taxable: taxable,
      deductions: deductions, net: net, capped: capped,
      lines: [
        ['Basic pay', basic],
        ['Allowances', allow],
        ['Gross pay', gross],
        ['SSS contribution (5% of MSC ' + peso0(msc(monthlyEquivalent)) + ')', -sss],
        ['PhilHealth (2.5% of ' + peso0(clamp(monthlyEquivalent, 10000, 100000)) + ')', -phil],
        ['Pag-IBIG (2% capped at ' + peso0(10000) + ')', -pag],
        ['Withholding tax (BIR semi-monthly)', -tax]
      ].concat(other ? [['Other deductions', -other]] : [])
        .concat([['Net pay', net]])
    };
  }

  function peso0(n) { return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 }); }

  // How stale is the table? Reported on the payroll screen so nobody assumes it is current.
  function verify() {
    var from = new Date(CONFIG.effectiveFrom);
    var now = new Date();
    var months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
    return { effectiveFrom: CONFIG.effectiveFrom, monthsOld: months, sources: {
      sss: CONFIG.sss.source, philhealth: CONFIG.philhealth.source,
      pagibig: CONFIG.pagibig.source, bir: CONFIG.bir.source
    } };
  }

  HIS.payrollCalc = {
    CONFIG: CONFIG, msc: msc,
    sssMonthly: sssMonthly, philhealthMonthly: philhealthMonthly, pagibigMonthly: pagibigMonthly,
    birSemiMonthly: birSemiMonthly, compute: compute, verify: verify
  };
})();
