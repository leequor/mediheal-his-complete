// Philippine payroll engine (M10, replacing the M8 calculator).
//
// WHAT WAS WRONG IN M8
// The payroll rows stored `basic: 60000` and this module treated it as the pay FOR THE PERIOD,
// then multiplied by two to reach a "monthly equivalent" for the contribution tables. Those
// numbers are monthly salaries — 26,000 for an administrative officer, 60,000 for a chief
// physician. Doubling them put an administrative officer on 52,000 a month and a head nurse on
// 70,000, and every contribution and tax base was computed on the doubled figure.
//
// The reported M8 example (taxable 65,775, tax 12,381.20) is the symptom. 65,775 is neither a
// monthly nor a semi-monthly taxable amount for a 60,000 salary: it is 68,000 − 2,225, where
// 68,000 is two months of pay and 2,225 is half of the monthly contributions on 120,000. The
// semi-monthly table was then applied to that inflated base. Two errors that partly cancelled:
// the doubled base raised the tax, and the semi-monthly table (whose brackets are exactly half
// the monthly ones) lowered it again. The net effect was a tax about three times too high.
//
// THE MODEL NOW
//   employee.monthlyBasic        one salary fact, never a per-period amount
//   frequency                    monthly | semi-monthly | weekly | daily
//   period basic                 monthlyBasic / periodsPerMonth
//   statutory contributions      computed on the MONTHLY basic, then apportioned to the period
//   withholding                  the Annex E table for THAT frequency, on THAT period's taxable
//
// SOURCES — every rate below carries its issuer and effective date. Read them before changing a
// number. Nothing here is invented, and nothing here is a compliance claim.
//
//   BIR withholding      Annex "E", RR No. 11-2018, "Effective January 1, 2023 and onwards".
//                        Four tables (daily / weekly / semi-monthly / monthly) plus the annual
//                        table used for year-end reconciliation. The bracket bases are reproduced
//                        verbatim from the PDF, including the small rounding differences between
//                        brackets (e.g. the semi-monthly 16,770.70 does not exactly equal
//                        4,270.70 + 25% x (83,332 - 33,333)); the published figure governs.
//                        https://bir-cdn.bir.gov.ph/local/pdf/Annex%20E%20RR%2011-2018.pdf
//   SSS                  15% of the Monthly Salary Credit: employee 5%, employer 10%.
//                        MSC floor 5,000, ceiling 35,000, brackets 500 wide. A bracket runs from
//                        MSC-250 to MSC+249.99, so 12,300 falls in the 12,500 bracket while
//                        12,249 falls in the 12,000 one.
//                        SSS Circular No. 2024-006, effective January 2025.
//   PhilHealth           5% of monthly basic salary, employee 2.5%, employer 2.5%.
//                        Floor 10,000, ceiling 100,000 (premium floor 500, ceiling 5,000).
//                        PhilHealth Circular No. 2024-0031: 5.00% for 2025, unchanged for 2026.
//   Pag-IBIG             2% employee + 2% employer of the Fund Salary Credit, capped at 10,000
//                        (maximum 200 each). HDMF Circular No. 460.
//   Overtime             Labor Code Art. 87: +25% of the regular wage on an ordinary day; work
//                        beyond eight hours on a holiday or rest day earns the rate for that day
//                        plus at least 30%.
//   Night differential   Labor Code Art. 86: not less than 10% of the regular wage for each hour
//                        worked between 10:00 PM and 6:00 AM.
//   Rest day             Labor Code Art. 93: +30% of the regular wage.
//   Special non-working  Labor Code Art. 93: +30%; +50% when it falls on the scheduled rest day.
//   Regular holiday      Labor Code Art. 94: paid even if not worked; twice the regular rate if
//                        worked.
//   Coverage exclusion   Labor Code Art. 82: the hours-of-work provisions (Arts. 83-90, which
//                        include overtime and night differential) do not apply to managerial
//                        employees. Holiday and rest-day premiums still do.
//   13th month           PD 851: 1/12 of the basic salary earned in the calendar year. Sec. 2(b)
//                        excludes allowances not integrated into basic; the supplementary rules
//                        exclude overtime and other earnings that are not basic salary.
//   13th month tax       RA 10963 Sec. 32(B)(7)(e): 13th month pay and other benefits are exempt
//                        up to 90,000; the excess is taxable compensation.
//
// NOT LEGAL OR ACCOUNTING ADVICE. This is a demonstration engine. Rates change by circular, and a
// real deployment must have every figure confirmed against the current issuances by a Philippine
// payroll practitioner. `verify()` reports the age of the table so a stale one is visible.
(function () {
  var CONFIG = {
    version: '2026.3',
    effectiveFrom: '2025-01-01',
    reviewedOn: '2026-11-18',
    currency: 'PHP',
    hoursPerDay: 8,
    graceMinutes: 15,           // company policy, not statute: lateness inside 15 minutes is not docked
    specialDayPaidWhenNotWorked: true, // company policy: special non-working days are paid here
    sss: {
      source: 'SSS Circular No. 2024-006 (effective January 2025)',
      effectiveFrom: '2025-01-01',
      totalRate: 0.15, employeeRate: 0.05, employerRate: 0.10,
      mscFloor: 5000, mscCeiling: 35000, mscStep: 500, mscHalfWidth: 250,
      ecEmployer: 10              // Employees' Compensation, employer-paid, flat
    },
    philhealth: {
      source: 'PhilHealth Circular No. 2024-0031 (5.00% for 2025, unchanged 2026)',
      effectiveFrom: '2025-01-01',
      totalRate: 0.05, employeeRate: 0.025, employerRate: 0.025,
      salaryFloor: 10000, salaryCeiling: 100000
    },
    pagibig: {
      // TWO effective dates, because two instruments set two different things.
      //   RA 9679 s.7 fixes the rates: 1% for a monthly compensation of 1,500 or less, 2% above,
      //   employer 2% of every covered employee. That tier is statutory and still in force.
      //   The law lets the Board raise the maximum monthly compensation (then 5,000); HDMF
      //   Circular No. 460 exercised that power and set it to 10,000.
      // The circular could not be retrieved directly (the Pag-IBIG site answers with a reCAPTCHA
      // and the archived copy was unreachable), so the 1% tier rests on the statute, which a
      // circular cannot override. Flagged for HDMF confirmation in docs/PAYROLL.md.
      source: 'RA 9679 s.7 (rates); HDMF Circular No. 460 (fund salary cap 10,000)',
      effectiveFrom: '2009-07-21',
      capEffectiveFrom: '2024-02-01',
      employeeRate: 0.02, lowRate: 0.01, lowThreshold: 1500,
      employerRate: 0.02, fundSalaryCap: 10000
    },
    bir: {
      source: 'BIR Annex E, RR No. 11-2018 (effective January 1, 2023 and onwards)',
      effectiveFrom: '2023-01-01',
      // [upper bound, base tax, marginal rate, amount the rate applies over]
      daily: [
        { upTo: 685, base: 0, rate: 0, over: 0 },
        { upTo: 1095, base: 0, rate: 0.15, over: 685 },
        { upTo: 2191, base: 61.65, rate: 0.20, over: 1096 },
        { upTo: 5478, base: 280.85, rate: 0.25, over: 2192 },
        { upTo: 21917, base: 1102.60, rate: 0.30, over: 5479 },
        // The PDF renders this cell as "P 6,034.00.30"; the base is 6,034.00 and ".30" is the
        // start of the "+ 30%" fragment from the row above. Verified against the bracket:
        // 1,102.60 + 30% x (21,917 - 5,479) = 6,034.00.
        { upTo: Infinity, base: 6034.00, rate: 0.35, over: 21918 }
      ],
      weekly: [
        { upTo: 4808, base: 0, rate: 0, over: 0 },
        { upTo: 7691, base: 0, rate: 0.15, over: 4808 },
        { upTo: 15384, base: 432.60, rate: 0.20, over: 7692 },
        { upTo: 38461, base: 1971.20, rate: 0.25, over: 15385 },
        { upTo: 153845, base: 7740.45, rate: 0.30, over: 38462 },
        { upTo: Infinity, base: 42355.65, rate: 0.35, over: 153846 }
      ],
      semiMonthly: [
        { upTo: 10417, base: 0, rate: 0, over: 0 },
        { upTo: 16666, base: 0, rate: 0.15, over: 10417 },
        { upTo: 33332, base: 937.50, rate: 0.20, over: 16667 },
        { upTo: 83332, base: 4270.70, rate: 0.25, over: 33333 },
        { upTo: 333332, base: 16770.70, rate: 0.30, over: 83333 },
        { upTo: Infinity, base: 91770.70, rate: 0.35, over: 333333 }
      ],
      monthly: [
        { upTo: 20833, base: 0, rate: 0, over: 0 },
        { upTo: 33332, base: 0, rate: 0.15, over: 20833 },
        { upTo: 66666, base: 1875.00, rate: 0.20, over: 33333 },
        { upTo: 166666, base: 8541.80, rate: 0.25, over: 66667 },
        { upTo: 666666, base: 33541.80, rate: 0.30, over: 166667 },
        { upTo: Infinity, base: 183541.80, rate: 0.35, over: 666667 }
      ],
      annual: [
        { upTo: 250000, base: 0, rate: 0, over: 0 },
        { upTo: 400000, base: 0, rate: 0.15, over: 250000 },
        { upTo: 800000, base: 22500, rate: 0.20, over: 400000 },
        { upTo: 2000000, base: 102500, rate: 0.25, over: 800000 },
        { upTo: 8000000, base: 402500, rate: 0.30, over: 2000000 },
        { upTo: Infinity, base: 2202500, rate: 0.35, over: 8000000 }
      ]
    },
    labor: {
      source: 'Labor Code of the Philippines (PD 442), Arts. 82, 86, 87, 93, 94',
      effectiveFrom: '1974-11-01',
      restDay: 0.30,
      regularHoliday: 1.00,        // premium on top of the paid holiday: 200% in total
      specialHoliday: 0.30,
      specialOnRestDay: 0.50,
      restDayOnRegularHoliday: 1.60, // 260% total
      overtimeOrdinary: 1.25,
      overtimeRestDay: 1.69,
      overtimeRegularHoliday: 2.60,
      overtimeSpecial: 1.69,
      overtimeRestDayRegularHoliday: 3.38,
      overtimeRestDaySpecial: 1.95,
      nightDifferential: 0.10,
      nightStartHour: 22,
      nightEndHour: 6
    },
    thirteenth: {
      source: 'PD 851; RA 10963 Sec. 32(B)(7)(e) for the 90,000 exemption',
      effectiveFrom: '2018-01-01',
      taxExemptCap: 90000
    }
  };

  // ---- pay policy ------------------------------------------------------------------------------
  // TWO DIFFERENT QUESTIONS, TWO DIFFERENT FACTORS. They are not the same divisor because they do
  // not answer the same question, and collapsing them would either understate the statutory floor
  // or cut premium pay.
  //
  //   wageFloorFactor 365 — the NWPC conversion for a monthly-paid employee, used ONLY to test a
  //        monthly salary against a daily minimum wage. Source: NWPC FAQ, "How is the equivalent
  //        monthly rate (EMR) of monthly-paid and daily-paid employees computed?".
  //   dailyRateFactor 261 — the working-year factor this employer uses to price a day or an hour
  //        for absence, lateness, undertime, overtime, night differential and premiums.
  //
  // The DOLE conversion for a monthly-paid employee's daily rate is 365 (monthly x 12 / 365). This
  // policy uses 261, which produces a HIGHER daily rate (26,100 -> 1,200.00 rather than 858.08).
  // That is a company practice more favourable than the statutory conversion for every premium, and
  // it is retained deliberately: moving to 365 would reduce overtime, night differential and holiday
  // pay for existing staff, which raises a non-diminution question (Labor Code Art. 100) that a code
  // change cannot settle. See docs/PAYROLL.md §2A and policyImpact().
  var POLICIES = [
    {
      id: 'MH-PAY-2026.1',
      effectiveFrom: '2026-01-01',
      status: 'active',
      hoursPerDay: 8,
      dailyRateFactor: 261,
      dailyRateFactorSource: 'Company practice. DOLE converts a monthly-paid daily rate at 365; 261 is the working-year factor, retained for continuity and non-diminution.',
      wageFloorFactor: 365,
      wageFloorFactorSource: 'NWPC FAQ, equivalent monthly rate of monthly-paid employees.',
      absenceBasis: 'daily rate per day absent',
      lateBasis: 'hourly rate / 60 per minute',
      overtimeBasis: 'hourly rate x statutory multiplier',
      nightBasis: 'hourly rate x 10%',
      holidayBasis: 'daily rate x statutory premium',
      leaveBasis: 'paid leave is not converted: the period basic already pays it',
      // Extra hours beyond the schedule but within eight are NOT statutory overtime (Art. 87).
      // No company agreement grants them a premium, so they are paid at the ordinary hourly rate.
      additionalHoursPremium: 0,
      // The absence deduction is its own basis, not a reuse of the premium rate. `factor` is the
      // annual divisor for a monthly-paid employee; a daily-paid employee loses exactly their day.
      absence: {
        basis: 'daily-rate',
        factor: 261,
        status: 'configured-assumption',
        review: 'No employment contract, payroll manual or historical payslip is available for this demo. ' +
          'The 261-day factor is a configured assumption, not a proven practice. A Philippine payroll ' +
          'practitioner should confirm it against the employer\u2019s written policy before production.'
      }
    },
    {
      id: 'MH-PAY-2027.1',
      effectiveFrom: '2027-01-01',
      status: 'proposed',
      hoursPerDay: 8,
      dailyRateFactor: 365,
      dailyRateFactorSource: 'Aligns the daily rate with the DOLE conversion. Requires a non-diminution review before it can be activated.',
      wageFloorFactor: 365,
      wageFloorFactorSource: 'NWPC FAQ, equivalent monthly rate of monthly-paid employees.',
      absenceBasis: 'daily rate per day absent',
      lateBasis: 'hourly rate / 60 per minute',
      overtimeBasis: 'hourly rate x statutory multiplier',
      nightBasis: 'hourly rate x 10%',
      holidayBasis: 'daily rate x statutory premium',
      leaveBasis: 'paid leave is not converted: the period basic already pays it',
      additionalHoursPremium: 0,
      absence: {
        basis: 'daily-rate',
        factor: 365,
        status: 'proposed',
        review: 'Aligns the absence deduction with the DOLE monthly-paid conversion. Requires approval.'
      }
    }
  ];

  // The policy in force on a date. `proposed` policies are never returned.
  function policyFor(asOf) {
    var d = asOf ? String(asOf).slice(0, 10) : new Date().toISOString().slice(0, 10);
    var active = POLICIES.filter(function (p) {
      return p.status === 'active' && p.effectiveFrom <= d;
    }).sort(function (a, b) { return a.effectiveFrom < b.effectiveFrom ? 1 : -1; });
    return active[0] || POLICIES[0];
  }

  // Pay frequencies. `periodsPerMonth` apportions monthly statutory amounts to the period.
  var FREQUENCIES = {
    monthly: { key: 'monthly', label: 'Monthly', periodsPerMonth: 1, birTable: 'monthly', daysPerPeriod: 22 },
    'semi-monthly': { key: 'semi-monthly', label: 'Semi-monthly', periodsPerMonth: 2, birTable: 'semiMonthly', daysPerPeriod: 11 },
    weekly: { key: 'weekly', label: 'Weekly', periodsPerMonth: 52 / 12, birTable: 'weekly', daysPerPeriod: 5 },
    daily: { key: 'daily', label: 'Daily', periodsPerMonth: 261 / 12, birTable: 'daily', daysPerPeriod: 1 }
  };

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  // An unknown frequency is a programming error, not something to paper over with a default: a
  // monthly payroll silently computed as semi-monthly would under-withhold every period.
  function freq(key) {
    var f = FREQUENCIES[key];
    if (!f) throw new Error('Unknown pay frequency: ' + key);
    return f;
  }

  // ---- statutory tables ----------------------------------------------------------------------
  // The bracket that contains the salary. A bracket runs [MSC - 250, MSC + 249.99], so the
  // smallest qualifying MSC is ceil((salary - 249.99) / 500) * 500. Rounding to the nearest 500
  // would misplace 12,249 (belongs to 12,000) and 12,300 (belongs to 12,500).
  function msc(monthly) {
    var c = CONFIG.sss;
    var m = Math.ceil((Number(monthly) - (c.mscHalfWidth - 0.01)) / c.mscStep) * c.mscStep;
    return clamp(m, c.mscFloor, c.mscCeiling);
  }

  function sssMonthly(monthly) { return round2(msc(monthly) * CONFIG.sss.employeeRate); }
  function philhealthMonthly(monthly) {
    var c = CONFIG.philhealth;
    return round2(clamp(Number(monthly), c.salaryFloor, c.salaryCeiling) * c.employeeRate);
  }
  // Employee share. The 1% tier is decided on the monthly compensation, not on the capped fund
  // salary: an employee on 1,500 contributes 1% of 1,500, one on 1,501 contributes 2% of 1,501.
  function pagibigMonthly(monthly) {
    var c = CONFIG.pagibig;
    var m = Number(monthly) || 0;
    var rate = m <= c.lowThreshold ? c.lowRate : c.employeeRate;
    return round2(Math.min(m, c.fundSalaryCap) * rate);
  }

  // Employer share. Always 2%, with no low tier — RA 9679 s.7 sets one rate for all employers.
  function pagibigEmployerMonthly(monthly) {
    var c = CONFIG.pagibig;
    return round2(Math.min(Number(monthly) || 0, c.fundSalaryCap) * c.employerRate);
  }

  // Monthly employee and employer shares, plus the employer-only EC contribution. The employer
  // side is reported so a payslip can separate the two — the employee share is not the cost of
  // employment, and the M8 screen blurred that.
  function statutory(monthly) {
    var c = CONFIG;
    var sssEe = sssMonthly(monthly);
    var philEe = philhealthMonthly(monthly);
    var pagEe = pagibigMonthly(monthly);
    var sssEr = round2(msc(monthly) * c.sss.employerRate);
    var philEr = round2(clamp(Number(monthly), c.philhealth.salaryFloor, c.philhealth.salaryCeiling) * c.philhealth.employerRate);
    var pagEr = pagibigEmployerMonthly(monthly);
    return {
      employee: { sss: sssEe, philhealth: philEe, pagibig: pagEe, total: round2(sssEe + philEe + pagEe) },
      employer: { sss: sssEr, philhealth: philEr, pagibig: pagEr, ec: c.sss.ecEmployer,
        total: round2(sssEr + philEr + pagEr + c.sss.ecEmployer) },
      msc: msc(monthly),
      philhealthBase: clamp(Number(monthly), c.philhealth.salaryFloor, c.philhealth.salaryCeiling),
      pagibigBase: Math.min(Number(monthly), c.pagibig.fundSalaryCap),
      pagibigRate: pagibigRate(monthly)
    };
  }

  // One bracket lookup. `amount` must already be expressed in the table's own period.
  function bracketTax(table, amount) {
    for (var i = 0; i < table.length; i++) {
      if (amount <= table[i].upTo) {
        var b = table[i];
        if (!b.rate) return 0;
        return round2(b.base + (amount - b.over) * b.rate);
      }
    }
    return 0;
  }

  function withholding(taxable, frequency) {
    // The annual table is not a pay frequency: it exists for the year-end reconciliation only.
    if (frequency === 'annual') {
      return bracketTax(CONFIG.bir.annual, Math.max(0, Number(taxable) || 0));
    }
    var f = freq(frequency);
    var table = CONFIG.bir[f.birTable];
    if (!table) throw new Error('No withholding table for ' + frequency);
    return bracketTax(table, Math.max(0, Number(taxable) || 0));
  }

  // ---- rates --------------------------------------------------------------------------------
  // Full precision: rounding a rate before multiplying it by 2 hours or 3 days loses centavos.
  // Every amount is rounded once, when it becomes money.
  function dailyRate(monthlyBasic, asOf) {
    var p = policyFor(asOf);
    return (Number(monthlyBasic) || 0) * 12 / p.dailyRateFactor;
  }
  // The hourly rate divides the daily rate by the employee's OWN normal hours. A part-timer on four
  // hours a day is paid their daily rate for four hours, so dividing by eight would halve every
  // overtime and night-differential payment they receive.
  function normalHoursOf(emp) {
    var h = emp && emp.schedule && Number(emp.schedule.hoursPerDay);
    return isFinite(h) && h > 0 ? h : CONFIG.hoursPerDay;
  }
  function hourlyRate(monthlyBasic, asOf, hoursPerDay) {
    var h = Number(hoursPerDay) > 0 ? Number(hoursPerDay) : policyFor(asOf).hoursPerDay;
    return dailyRate(monthlyBasic, asOf) / h;
  }

  // The daily rate an employee is actually paid on. A daily- or hourly-paid employee has a stated
  // rate; deriving it from the monthly equivalent would round-trip through the annual factor and
  // change it (1,200 a day on a 313-day schedule becomes 1,439.08 if pushed back through 261).
  function dailyRateOf(emp, asOf) {
    if (emp && emp.payBasis === 'daily' && emp.dailyRate != null) return Number(emp.dailyRate);
    if (emp && emp.payBasis === 'hourly' && emp.hourlyRate != null) {
      return Number(emp.hourlyRate) * normalHoursOf(emp);
    }
    return dailyRate(monthlyOf(emp), asOf);
  }
  function hourlyRateOf(emp, asOf) {
    return dailyRateOf(emp, asOf) / normalHoursOf(emp);
  }

  // ---- attendance ----------------------------------------------------------------------------
  // The attendance store hands over counts, not money. An empty summary means "a full period with
  // no exceptions", which is what a payroll run uses when attendance has not been loaded yet.
  // A full period with no exceptions. The hour buckets are the classification every calculation
  // below depends on: ordinary hours are covered by the period basic, additional hours are beyond
  // the schedule but inside eight, statutory overtime is beyond eight.
  function emptySummary(days) {
    var h = days * CONFIG.hoursPerDay;
    return {
      scheduledDays: days, workedDays: days, absenceDays: 0, paidLeaveDays: 0, unpaidLeaveDays: 0,
      lateMinutes: 0, undertimeMinutes: 0, totalHours: h,
      scheduledHours: h, workedHours: h, ordinaryHours: h, additionalHours: 0,
      restDayHours: 0, regularHolidayHours: 0, specialHours: 0,
      otHours: { ordinary: 0, rest: 0, regularHoliday: 0, special: 0 },
      ndHours: 0, ndOtHours: 0,
      premiumDays: { rest: 0, regularHoliday: 0, special: 0, restRegularHoliday: 0, restSpecial: 0 }
    };
  }

  // Premium pay: the amount added ON TOP of the period basic, which already pays every scheduled
  // day (including regular holidays, Art. 94). A regular holiday actually worked therefore adds
  // 100%, bringing the day to 200%.
  // Premium pay, priced per HOUR so a partial day is exact. The base day is already inside the
  // period basic for a monthly-paid employee, so only the premium is added; a daily-paid employee's
  // equivalent monthly rate covers scheduled days only, so a rest day must also pay its base.
  //
  // `hours` prefers the precise figure from the attendance summary and falls back to the day count
  // (x8) for callers that only know how many rest or holiday days were worked.
  function premiumPay(summary, hourly, ctx) {
    ctx = ctx || {};
    var p = summary.premiumDays || {};
    var L = CONFIG.labor;
    var monthly = ctx.payBasis !== 'daily' && ctx.payBasis !== 'hourly';
    var paidSpecial = ctx.paidSpecialDays !== false;
    var hours = {
      rest: summary.restDayHours > 0 ? summary.restDayHours : (p.rest || 0) * CONFIG.hoursPerDay,
      regularHoliday: summary.regularHolidayHours > 0 ? summary.regularHolidayHours : (p.regularHoliday || 0) * CONFIG.hoursPerDay,
      special: summary.specialHours > 0 ? summary.specialHours : (p.special || 0) * CONFIG.hoursPerDay,
      restRegularHoliday: (p.restRegularHoliday || 0) * CONFIG.hoursPerDay,
      restSpecial: (p.restSpecial || 0) * CONFIG.hoursPerDay
    };
    var parts = [
      ['Rest day', hours.rest, monthly ? L.restDay : 1 + L.restDay],
      ['Regular holiday', hours.regularHoliday, L.regularHoliday],
      ['Special non-working day', hours.special, monthly || paidSpecial ? L.specialHoliday : 1 + L.specialHoliday],
      ['Rest day + regular holiday', hours.restRegularHoliday, monthly ? L.restDayOnRegularHoliday : 1 + L.restDayOnRegularHoliday],
      ['Rest day + special day', hours.restSpecial, monthly ? L.specialOnRestDay : 1 + L.specialOnRestDay]
    ];
    var total = 0, lines = [];
    parts.forEach(function (x) {
      if (x[1] <= 0) return;
      var amount = round2(hourly * x[2] * x[1]);
      lines.push({ label: x[0], hours: round2(x[1]), rate: x[2], amount: amount });
      total += amount;
    });
    return { total: round2(total), lines: lines };
  }

  // Hours beyond the schedule but within eight. Not Art. 87 overtime; paid at the ordinary hourly
  // rate unless an agreement grants a premium, which none does here.
  function additionalPay(summary, hourly, policy, eligible) {
    var h = summary.additionalHours || 0;
    if (!eligible || h <= 0) return { total: 0, hours: 0, lines: [], rate: 1 };
    var rate = 1 + (policy.additionalHoursPremium || 0);
    return {
      total: round2(hourly * rate * h), hours: round2(h),
      rate: rate, lines: [{ label: 'Additional hours within eight', hours: round2(h), rate: rate, amount: round2(hourly * rate * h) }]
    };
  }

  function overtimePay(summary, hourly, eligible) {
    var ot = summary.otHours || {};
    var L = CONFIG.labor;
    var parts = [
      ['Overtime \u2014 ordinary day', ot.ordinary || 0, L.overtimeOrdinary],
      ['Overtime \u2014 rest day', ot.rest || 0, L.overtimeRestDay],
      ['Overtime \u2014 regular holiday', ot.regularHoliday || 0, L.overtimeRegularHoliday],
      ['Overtime \u2014 special non-working day', ot.special || 0, L.overtimeSpecial]
    ];
    var total = 0, hours = 0, lines = [];
    parts.forEach(function (x) {
      hours += x[1];
      if (!eligible || x[1] <= 0) return;
      var amount = round2(hourly * x[2] * x[1]);
      lines.push({ label: x[0], hours: x[1], rate: x[2], amount: amount });
      total += amount;
    });
    return { total: round2(total), hours: round2(hours), lines: lines, eligible: !!eligible };
  }

  // Night differential is 10% of the regular wage for each hour between 10 PM and 6 AM. Hours that
  // are also overtime carry the overtime rate, so the differential is 10% of that rate.
  function nightPay(summary, hourly, eligible) {
    if (!eligible) return { total: 0, hours: 0, lines: [] };
    var base = round2(hourly * CONFIG.labor.nightDifferential * (summary.ndHours || 0));
    var ot = round2(hourly * CONFIG.labor.overtimeOrdinary * CONFIG.labor.nightDifferential * (summary.ndOtHours || 0));
    var lines = [];
    if (summary.ndHours) lines.push({ label: 'Night differential \u2014 ordinary hours', hours: summary.ndHours, amount: base });
    if (summary.ndOtHours) lines.push({ label: 'Night differential \u2014 overtime hours', hours: summary.ndOtHours, amount: ot });
    return { total: round2(base + ot), hours: round2((summary.ndHours || 0) + (summary.ndOtHours || 0)), lines: lines };
  }

  // The monthly figure the statutory tables are keyed on. For a monthly-paid employee it is the
  // salary itself; for a daily- or hourly-paid employee it is the NWPC equivalent monthly rate,
  // which is why the basis must be stated on the record rather than inferred.
  function monthlyOf(emp) {
    if (window.HIS && HIS.wageFloor) {
      var m = HIS.wageFloor.equivalentMonthly(emp);
      if (isFinite(m) && m > 0) return m;
    }
    return Number(emp && (emp.monthlyBasic != null ? emp.monthlyBasic : emp.basic)) || 0;
  }

  // The daily amount an unpaid absence costs. A daily-paid employee loses exactly the day they did
  // not work; a monthly-paid employee loses the policy's absence divisor, which is a separate
  // setting from the premium daily rate even when the two numbers currently agree.
  function absenceDailyOf(emp, asOf) {
    if (emp && emp.payBasis === 'daily' && emp.dailyRate != null) return Number(emp.dailyRate);
    if (emp && emp.payBasis === 'hourly' && emp.hourlyRate != null) {
      return Number(emp.hourlyRate) * normalHoursOf(emp);
    }
    var p = policyFor(asOf);
    var factor = (p.absence && p.absence.factor) || p.dailyRateFactor;
    return monthlyOf(emp) * 12 / factor;
  }

  // ---- the calculation -----------------------------------------------------------------------
  // compute(employee, opts)
  //   opts.frequency        default 'semi-monthly'
  //   opts.attendance       summary from HIS.attendancePeriod.summary(empId); empty = full period
  //   opts.otherDeductions  authorised deductions (loans, co-op, etc.)
  //   opts.days             scheduled days in the period (default from the frequency)
  //
  // Every returned figure is a number in pesos; `lines` is the audit trail the payslip prints.
  function compute(emp, opts) {
    opts = opts || {};
    if (!emp) throw new Error('compute() needs an employee');
    var f = freq(opts.frequency || 'semi-monthly');
    var monthly = monthlyOf(emp);
    var allowMonthly = emp.monthlyBasic != null
      ? HIS.employees.monthlyAllowance(emp)
      : (Number(emp.allow) || 0);
    var allowTaxableMonthly = emp.monthlyBasic != null
      ? HIS.employees.monthlyTaxableAllowance(emp)
      : allowMonthly;
    var allowNonTaxableMonthly = allowMonthly - allowTaxableMonthly;

    var summary = opts.attendance || emptySummary(opts.days || f.daysPerPeriod);
    var policy = policyFor(opts.asOf);
    var daily = dailyRateOf(emp, opts.asOf);
    var hourly = hourlyRateOf(emp, opts.asOf);

    var periodBasic = round2(monthly / f.periodsPerMonth);
    var allowancePeriod = round2(allowMonthly / f.periodsPerMonth);
    var allowanceTaxablePeriod = round2(allowTaxableMonthly / f.periodsPerMonth);
    var allowanceNonTaxablePeriod = round2(allowNonTaxableMonthly / f.periodsPerMonth);

    var absence = round2(absenceDailyOf(emp, opts.asOf) * (summary.absenceDays || 0));
    var late = round2(hourly / 60 * (summary.lateMinutes || 0));
    var undertime = round2(hourly / 60 * (summary.undertimeMinutes || 0));

    // Art. 82: the hours-of-work chapter does not cover managerial employees.
    var eligible = (emp.category || 'rank-and-file') === 'rank-and-file';
    var ot = overtimePay(summary, hourly, eligible);
    var nd = nightPay(summary, hourly, eligible);
    var additional = additionalPay(summary, hourly, policy, eligible);
    var premium = premiumPay(summary, hourly, {
      payBasis: emp.payBasis || 'monthly',
      paidSpecialDays: emp.schedule ? emp.schedule.paidSpecialDays !== false : true
    });

    var gross = round2(periodBasic - absence - late - undertime +
      premium.total + ot.total + nd.total + additional.total + allowancePeriod);

    // Contributions are monthly amounts. A semi-monthly payroll withholds half of each; a weekly
    // payroll withholds 12/52. The base is always the MONTHLY basic, never the period amount.
    var stat = statutory(monthly);
    var share = 1 / f.periodsPerMonth;
    var sss = round2(stat.employee.sss * share);
    var phil = round2(stat.employee.philhealth * share);
    var pag = round2(stat.employee.pagibig * share);
    var statutoryPeriod = round2(sss + phil + pag);

    // Taxable compensation for the period: gross, less the employee's own contributions, less any
    // non-taxable (de minimis) allowance. It is NOT annualised and NOT doubled.
    var taxable = round2(Math.max(0, gross - statutoryPeriod - allowanceNonTaxablePeriod));
    var tax = withholding(taxable, f.key);

    var other = round2(Number(opts.otherDeductions || 0));
    var room = round2(gross - statutoryPeriod - tax);
    var capped = false;
    if (other > room) { other = Math.max(0, room); capped = true; }
    // A gross below the contribution floor cannot fund the employee share; scale it and say so.
    if (statutoryPeriod > gross && statutoryPeriod > 0) {
      var k = gross / statutoryPeriod;
      sss = round2(sss * k); phil = round2(phil * k); pag = round2(pag * k);
      statutoryPeriod = round2(sss + phil + pag);
      taxable = round2(Math.max(0, gross - statutoryPeriod - allowanceNonTaxablePeriod));
      tax = withholding(taxable, f.key);
      capped = true;
    }

    var deductions = round2(statutoryPeriod + tax + other);
    var net = round2(Math.max(0, gross - deductions));

    var lines = [
      { label: 'Basic pay \u2014 ' + f.label.toLowerCase() + ' rate', amount: periodBasic, kind: 'earning' },
      { label: 'Absences without pay (' + (summary.absenceDays || 0) + ' day' + ((summary.absenceDays || 0) === 1 ? '' : 's') + ')', amount: -absence, kind: 'deduction' },
      { label: 'Late (' + (summary.lateMinutes || 0) + ' min beyond grace)', amount: -late, kind: 'deduction' },
      { label: 'Undertime (' + (summary.undertimeMinutes || 0) + ' min)', amount: -undertime, kind: 'deduction' },
      { label: 'Allowances', amount: allowancePeriod, kind: 'earning' }
    ];
    premium.lines.forEach(function (l) {
      lines.push({ label: l.label + ' premium (' + l.hours + ' h \u00d7 ' + Math.round(l.rate * 100) + '%)', amount: l.amount, kind: 'earning' });
    });
    additional.lines.forEach(function (l) {
      lines.push({ label: l.label + ' (' + l.hours + ' h \u00d7 ' + Math.round(l.rate * 100) + '%)', amount: l.amount, kind: 'earning' });
    });
    ot.lines.forEach(function (l) {
      lines.push({ label: l.label + ' (' + l.hours + ' h \u00d7 ' + Math.round(l.rate * 100) + '%)', amount: l.amount, kind: 'earning' });
    });
    nd.lines.forEach(function (l) {
      lines.push({ label: l.label + ' (' + l.hours + ' h)', amount: l.amount, kind: 'earning' });
    });
    lines.push({ label: 'Gross pay', amount: gross, kind: 'total' });
    lines.push({ label: 'SSS \u2014 5% of MSC ' + peso0(stat.msc) + ', employee share', amount: -sss, kind: 'deduction' });
    lines.push({ label: 'PhilHealth \u2014 2.5% of ' + peso0(stat.philhealthBase) + ', employee share', amount: -phil, kind: 'deduction' });
    lines.push({ label: 'Pag-IBIG \u2014 ' + Math.round(pagibigRate(monthly) * 100) + '% of ' + peso0(stat.pagibigBase) + ', employee share', amount: -pag, kind: 'deduction' });
    lines.push({ label: 'Withholding tax \u2014 BIR ' + f.label.toLowerCase() + ' table', amount: -tax, kind: 'deduction' });
    if (other) lines.push({ label: 'Other authorised deductions', amount: -other, kind: 'deduction' });
    lines.push({ label: 'Net pay', amount: net, kind: 'total' });

    return {
      employeeId: emp.id, employeeName: emp.name, frequency: f.key,
      monthlyBasic: round2(monthly), periodBasic: periodBasic,
      dailyRate: round2(daily), hourlyRate: round2(hourly),
      policy: { id: policy.id, dailyRateFactor: policy.dailyRateFactor, wageFloorFactor: policy.wageFloorFactor },
      days: {
        scheduled: summary.scheduledDays, worked: summary.workedDays,
        absent: summary.absenceDays, paidLeave: summary.paidLeaveDays,
        lateMinutes: summary.lateMinutes, undertimeMinutes: summary.undertimeMinutes,
        overtimeHours: ot.hours, additionalHours: additional.hours, nightHours: nd.hours
      },
      earnings: {
        basic: periodBasic,
        absence: -absence, late: -late, undertime: -undertime,
        premium: premium.total, overtime: ot.total, additional: additional.total, night: nd.total,
        allowances: allowancePeriod,
        allowancesTaxable: allowanceTaxablePeriod,
        allowancesNonTaxable: allowanceNonTaxablePeriod
      },
      gross: gross,
      statutory: { sss: sss, philhealth: phil, pagibig: pag, total: statutoryPeriod },
      employer: {
        sss: round2(stat.employer.sss * share),
        philhealth: round2(stat.employer.philhealth * share),
        pagibig: round2(stat.employer.pagibig * share),
        ec: round2(stat.employer.ec * share),
        total: round2(stat.employer.total * share)
      },
      taxable: taxable,
      tax: tax,
      other: other,
      deductions: deductions,
      net: net,
      capped: capped,
      otEligible: eligible,
      absenceBasis: {
        factor: emp.payBasis === 'daily' || emp.payBasis === 'hourly' ? null : ((policy.absence && policy.absence.factor) || policy.dailyRateFactor),
        dailyAmount: round2(absenceDailyOf(emp, opts.asOf)),
        status: emp.payBasis === 'daily' || emp.payBasis === 'hourly' ? 'stated rate' : (policy.absence && policy.absence.status) || 'configured-assumption'
      },
      basis: {
        msc: stat.msc,
        philhealthBase: stat.philhealthBase,
        pagibigBase: stat.pagibigBase,
        monthlyEquivalent: round2(monthly),
        contributionsMonthly: stat.employee.total,
        birTable: f.birTable
      },
      lines: lines
    };
  }

  // ---- 13th month and year-end ---------------------------------------------------------------
  // PD 851: one twelfth of the BASIC salary earned in the calendar year. Allowances, overtime,
  // night differential and premium pay are excluded (Sec. 2(b) and the supplementary rules).
  function thirteenthMonth(emp, opts) {
    opts = opts || {};
    var monthly = monthlyOf(emp);
    var months = opts.months == null ? 12 : Math.max(0, Math.min(12, Number(opts.months)));
    var basicEarned = opts.basicEarned != null ? Number(opts.basicEarned) : round2(monthly * months);
    var amount = round2(basicEarned / 12);
    var cap = CONFIG.thirteenth.taxExemptCap;
    var exempt = round2(Math.min(amount, cap));
    return {
      months: months, basicEarned: round2(basicEarned), amount: amount,
      taxExempt: exempt, taxableExcess: round2(amount - exempt),
      source: CONFIG.thirteenth.source
    };
  }

  // Year-end reconciliation. Annualises regular compensation, adds the taxable part of the 13th
  // month and other benefits, applies the annual table, and compares with what was withheld.
  // A positive `adjustment` is still due from the employee; a negative one is a refund.
  function annualize(emp, opts) {
    opts = opts || {};
    var monthly = monthlyOf(emp);
    var months = opts.months == null ? 12 : Number(opts.months);
    var taxableAllowance = emp.monthlyBasic != null
      ? HIS.employees.monthlyTaxableAllowance(emp)
      : (Number(emp.allow) || 0);
    var stat = statutory(monthly);

    var regularTaxable = round2((monthly + taxableAllowance) * months);
    var contributions = round2(stat.employee.total * months);
    var benefits = round2(Number(opts.benefits || 0));
    var benefitsExempt = round2(Math.min(benefits, CONFIG.thirteenth.taxExemptCap));
    var benefitsTaxable = round2(benefits - benefitsExempt);

    var taxableCompensation = round2(Math.max(0, regularTaxable - contributions + benefitsTaxable));
    var annualDue = bracketTax(CONFIG.bir.annual, taxableCompensation);
    var withheld = round2(Number(opts.taxWithheld || 0));

    return {
      months: months,
      regularTaxable: regularTaxable,
      contributions: contributions,
      benefits: benefits,
      benefitsExempt: benefitsExempt,
      benefitsTaxable: benefitsTaxable,
      taxableCompensation: taxableCompensation,
      annualDue: annualDue,
      taxWithheld: withheld,
      adjustment: round2(annualDue - withheld),
      direction: annualDue > withheld ? 'due' : (annualDue < withheld ? 'refund' : 'even')
    };
  }

  function pagibigRate(monthly) {
    var c = CONFIG.pagibig;
    return (Number(monthly) || 0) <= c.lowThreshold ? c.lowRate : c.employeeRate;
  }

  function peso0(n) {
    return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 });
  }

  // What a change of divisor would do to each employee, component by component.
  //
  // A single daily-rate comparison is not enough to call a change favourable or unfavourable: a
  // higher divisor lowers every premium (bad for the employee) and lowers the absence deduction
  // (good for the employee). The net depends on the mix, so the components are reported separately
  // and the net is labelled illustrative.
  //
  // Read-only. It never writes to a run, a payslip, an employee rate or a correction.
  function policyImpact(employees, proposedId) {
    var proposed = POLICIES.filter(function (p) { return p.id === proposedId; })[0] ||
      POLICIES.filter(function (p) { return p.status === 'proposed'; })[0];
    if (!proposed) return { ok: false, error: 'No proposed policy to compare against.' };
    var active = policyFor();

    function pair(before, after) {
      return { before: round2(before), after: round2(after), delta: round2(after - before) };
    }

    var rows = (employees || []).map(function (e) {
      var monthly = monthlyOf(e);
      var hours = normalHoursOf(e);
      var stated = e.payBasis === 'daily' || e.payBasis === 'hourly';

      var dailyBefore = stated ? dailyRateOf(e) : monthly * 12 / active.dailyRateFactor;
      var dailyAfter = stated ? dailyRateOf(e) : monthly * 12 / proposed.dailyRateFactor;
      var hourlyBefore = dailyBefore / hours;
      var hourlyAfter = dailyAfter / hours;

      var absFactorBefore = (active.absence && active.absence.factor) || active.dailyRateFactor;
      var absFactorAfter = (proposed.absence && proposed.absence.factor) || proposed.dailyRateFactor;
      var absenceBefore = stated ? dailyRateOf(e) : monthly * 12 / absFactorBefore;
      var absenceAfter = stated ? dailyRateOf(e) : monthly * 12 / absFactorAfter;

      var restRate = e.payBasis === 'daily' || e.payBasis === 'hourly' ? 1.30 : 0.30;
      var earnings = {
        ordinaryDaily: pair(dailyBefore, dailyAfter),
        hourly: pair(hourlyBefore, hourlyAfter),
        overtime2h: pair(hourlyBefore * 1.25 * 2, hourlyAfter * 1.25 * 2),
        night8h: pair(hourlyBefore * 0.10 * 8, hourlyAfter * 0.10 * 8),
        restDay8h: pair(hourlyBefore * restRate * 8, hourlyAfter * restRate * 8),
        holiday8h: pair(hourlyBefore * 1.00 * 8, hourlyAfter * 1.00 * 8)
      };
      var deductions = { absence1day: pair(absenceBefore, absenceAfter) };

      var earningsDelta = round2(
        earnings.overtime2h.delta + earnings.night8h.delta +
        earnings.restDay8h.delta + earnings.holiday8h.delta);
      var deductionDelta = deductions.absence1day.delta;

      return {
        employeeId: e.id, name: e.name, payBasis: e.payBasis || 'monthly',
        dailyBefore: round2(dailyBefore), dailyAfter: round2(dailyAfter),
        earnings: earnings,
        deductions: deductions,
        netIllustrative: {
          earningsDelta: earningsDelta,
          deductionDelta: round2(deductionDelta),
          net: round2(earningsDelta - deductionDelta)
        },
        premiumReduced: earningsDelta < -0.005
      };
    });

    var premiumDown = rows.filter(function (r) { return r.premiumReduced; }).length;
    var deductionDown = rows.filter(function (r) { return r.deductions.absence1day.delta < -0.005; }).length;
    return {
      ok: true,
      active: { id: active.id, factor: active.dailyRateFactor, absenceFactor: (active.absence && active.absence.factor) || active.dailyRateFactor },
      proposed: { id: proposed.id, factor: proposed.dailyRateFactor, absenceFactor: (proposed.absence && proposed.absence.factor) || proposed.dailyRateFactor, effectiveFrom: proposed.effectiveFrom, status: proposed.status },
      rows: rows,
      affected: premiumDown,
      summary: { premiumFalls: premiumDown, deductionFalls: deductionDown, employees: rows.length },
      note: premiumDown
        ? 'Moving to ' + proposed.dailyRateFactor + ' days lowers the daily and hourly rate, so overtime, ' +
          'night differential and premiums fall for ' + premiumDown + ' of ' + rows.length + ' employees, while the ' +
          'unpaid-absence deduction also falls. The two effects pull in opposite directions; the net is ' +
          'illustrative and depends on each employee\u2019s attendance and overtime mix. A reduction in premium pay ' +
          'is a potential diminution of an established benefit (Labor Code Art. 100) and needs an approved policy ' +
          'change, not a code change.'
        : 'No employee would see premium pay fall.'
    };
  }

  // Age of the table, and every source, so a stale config is visible rather than silent.
  function verify() {
    var from = new Date(CONFIG.effectiveFrom);
    var now = new Date();
    var months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
    return {
      version: CONFIG.version, effectiveFrom: CONFIG.effectiveFrom, monthsOld: months,
      reviewedOn: CONFIG.reviewedOn,
      policy: { id: policyFor().id, dailyRateFactor: policyFor().dailyRateFactor, wageFloorFactor: policyFor().wageFloorFactor },
      sources: {
        sss: CONFIG.sss.source, philhealth: CONFIG.philhealth.source,
        pagibig: CONFIG.pagibig.source, bir: CONFIG.bir.source,
        labor: CONFIG.labor.source, thirteenth: CONFIG.thirteenth.source,
        dailyRate: policyFor().dailyRateFactorSource, wageFloor: policyFor().wageFloorFactorSource
      }
    };
  }

  // Structural checks on the tables themselves. A bracket table that skips a peso range, or whose
  // bases do not line up with the previous bracket, would silently under- or over-withhold.
  function auditTables() {
    var out = [];
    Object.keys(CONFIG.bir).forEach(function (k) {
      var t = CONFIG.bir[k];
      if (k === 'source' || k === 'effectiveFrom') return;
      for (var i = 1; i < t.length; i++) {
        var prev = t[i - 1], cur = t[i];
        if (cur.over !== prev.upTo + 1 && cur.over !== prev.upTo) {
          out.push({ table: k, issue: 'gap between bracket ' + (i - 1) + ' and ' + i, expected: prev.upTo + 1, got: cur.over });
        }
        // The base must equal the tax at the top of the previous bracket (within a peso, because
        // the published tables round each base independently).
        var atTop = prev.rate ? prev.base + (prev.upTo - prev.over) * prev.rate : 0;
        if (Math.abs(atTop - cur.base) > 1) {
          out.push({ table: k, issue: 'base discontinuity at bracket ' + i, expected: round2(atTop), got: cur.base });
        }
      }
    });
    return out;
  }

  HIS.payrollCalc = {
    CONFIG: CONFIG, FREQUENCIES: FREQUENCIES,
    msc: msc, sssMonthly: sssMonthly, philhealthMonthly: philhealthMonthly,
    pagibigMonthly: pagibigMonthly, pagibigEmployerMonthly: pagibigEmployerMonthly,
    statutory: statutory, withholding: withholding, bracketTax: bracketTax,
    dailyRate: dailyRate, hourlyRate: hourlyRate,
    POLICIES: POLICIES, policyFor: policyFor, policyImpact: policyImpact,
    compute: compute, emptySummary: emptySummary, monthlyOf: monthlyOf, normalHoursOf: normalHoursOf,
    absenceDailyOf: absenceDailyOf,
    dailyRateOf: dailyRateOf, hourlyRateOf: hourlyRateOf,
    thirteenthMonth: thirteenthMonth, annualize: annualize,
    verify: verify, auditTables: auditTables
  };
})();
