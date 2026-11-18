// Philippine minimum-wage validation (M10.1, corrected in M10.2).
//
// THE CONVERSION THIS FILE USED TO GET WRONG
// M10.1 divided every monthly salary by 261: `monthly x 12 / 261`. That is the factor for a
// DAILY-PAID employee who is not paid on Saturdays and Sundays. Applying it to a monthly-paid
// employee overstates their daily rate by about 40%, so a monthly-paid employee on 20,000 was
// reported at 919.54 a day — comfortably above a 755 floor — when their correct equivalent is
// 657.53 and they are below it. The error let underpaid staff pass.
//
// NWPC guidance, "How is the equivalent monthly rate (EMR) of monthly-paid and daily-paid employees
// computed?" (https://nwpc.dole.gov.ph/faqs/):
//
//   Monthly-paid
//     EMR = Applicable Daily Rate x 365 / 12
//     365 = 298 ordinary + 52 Sundays/rest days + 12 regular holidays + 3 special days
//
//   Daily-paid, required to work every day including Sundays and holidays
//     EMR = Daily Rate x 393.50 / 12
//
//   Daily-paid, not paid on Sundays/rest days
//     EMR = Daily Rate x 313 / 12      (310 if the 3 special days are not paid)
//
//   Daily-paid, not paid on Saturdays and Sundays/rest days
//     EMR = Daily Rate x 261 / 12      (258 if the 3 special days are not paid)
//
// The minimum wage is prescribed "for normal working hours, which shall not exceed eight hours per
// day", so a part-time employee is compared against the floor prorated to their normal hours.
//
// WHAT THE CHECK DOES
//   1. read the employee's basis (monthly / daily / hourly) and schedule from the record — never
//      infer the basis from the salary;
//   2. convert to the amount actually paid for one normal day;
//   3. prorate the floor to the employee's normal hours (floor x hours / 8);
//   4. compare, and report both figures plus the factor used.
//
// SOURCE LIMITS
// Wage orders for NCR only. Establishment-size rules, partial exemptions and the sector definitions
// inside an order are not modelled; a hospital's HR and legal team must apply those. This is not a
// compliance determination.
(function () {
  // VERIFIED ORDERS. Only orders whose category mapping has been read from the order itself are
  // here. NCR splits by industry; Region VII splits by locality, so the two cannot share a shape.
  var ORDERS = [
    {
      id: 'NCR-27', region: 'NCR', split: 'sector', effectiveFrom: '2026-07-25', status: 'suspended',
      rates: { 'non-agriculture': 718, 'agriculture': 718, 'retail-service': 718 },
      note: 'Implementation awaiting final decision from Pasig RTC 152 and Navotas RTC 287.',
      contingent: { effectiveFrom: '2027-01-20', rates: { 'non-agriculture': 743, 'agriculture': 743 } }
    },
    {
      id: 'NCR-28', region: 'NCR', split: 'sector', effectiveFrom: '2026-09-26', status: 'in-force',
      rates: { 'non-agriculture': 755, 'agriculture': 718, 'retail-service': 718 },
      note: 'Non-agriculture 755; agriculture and the other covered categories 718.'
    },
    {
      // Read from Wage Order No. ROVII-27 (NWPC, effective 14 October 2026). Section 2 splits by
      // geographic area, not by industry:
      //   Class A — Cities of Carcar, Cebu, Danao, Lapulapu, Mandaue, Naga, Talisay; Municipalities
      //             of Compostela, Consolacion, Cordova, Liloan, Minglanilla, San Fernando, or
      //             Expanded Metro Cebu: 582.00
      //   Other cities and municipalities not covered under Class A: 542.00
      // The order also keeps Negros Oriental and Siquijor under RTWPB VII until the NIR board sits.
      id: 'ROVII-27', region: 'Region VII', split: 'locality', effectiveFrom: '2026-10-14', status: 'in-force',
      rates: { 'class-a': 582, other: 542 },
      note: 'Class A is Expanded Metro Cebu; every other city and municipality in the region is 542.'
    }
  ];

  // EVERY OTHER REGION, REGISTERED BUT NOT ENABLED. The NWPC publishes a headline range per region;
  // the range endpoints are only meaningful once mapped to the categories inside the order, and that
  // mapping has not been read for these. They are listed so the gap is visible and the expansion plan
  // is concrete, and `floorFor()` refuses them rather than guessing which end applies.
  var REGISTER = [
    { region: 'NCR', order: 'NCR-28', effectiveFrom: '2026-09-26', range: '718.00-755.00', split: 'sector', verified: true },
    { region: 'Region VII', order: 'ROVII-27', effectiveFrom: '2026-10-14', range: '542.00-582.00', split: 'locality', verified: true },
    { region: 'CAR', order: 'CAR-24', effectiveFrom: '2025-12-30', range: '505.00', split: 'single', verified: false },
    { region: 'Region I', order: 'RB1-24', effectiveFrom: '2025-11-19', range: '480.00-505.00', split: 'unverified', verified: false },
    { region: 'Region II', order: 'RTWPB 2-24', effectiveFrom: '2025-11-05', range: '500.00', split: 'single', verified: false },
    { region: 'Region III', order: 'RBIII-26', effectiveFrom: '2025-10-30', range: '475.00-600.00', split: 'unverified', verified: false, note: 'Second tranche 515.00-600.00 from 16 April 2026.' },
    { region: 'Region IV-A', order: 'IVA-23', effectiveFrom: '2026-10-26', range: '550.00-645.00', split: 'unverified', verified: false },
    { region: 'Region IV-B', order: 'MIMAROPA-13', effectiveFrom: '2026-01-01', range: '455.00', split: 'single', verified: false },
    { region: 'Region V', order: 'RBV-23', effectiveFrom: '2026-04-08', range: '455.00-480.00', split: 'unverified', verified: false, note: 'Second tranche 480.00 from 1 December 2026.' },
    { region: 'Region VI', order: 'VI-30', effectiveFrom: '2026-11-20', range: '565.00-590.00', split: 'unverified', verified: false },
    { region: 'Region VIII', order: 'RB VIII-25', effectiveFrom: '2025-12-08', range: '422.00-470.00', split: 'unverified', verified: false, note: 'Second tranche 440.00-470.00 from 1 June 2026.' },
    { region: 'Region IX', order: 'RIX-24', effectiveFrom: '2026-01-01', range: '426.00-464.00', split: 'unverified', verified: false, note: 'Second tranche 451.00-464.00 from 1 June 2026.' },
    { region: 'Region X', order: 'RX-24', effectiveFrom: '2026-01-16', range: '471.00-500.00', split: 'unverified', verified: false, note: 'Second tranche 485.00-500.00 from 1 May 2026.' },
    { region: 'Region XI', order: 'RB XI-24', effectiveFrom: '2026-03-13', range: '515.00-540.00', split: 'unverified', verified: false, note: 'Second tranche 525.00-540.00 from 1 September 2026.' },
    { region: 'Region XII', order: 'XII-26', effectiveFrom: '2026-11-22', range: '459.00-501.00', split: 'unverified', verified: false, note: 'Second tranche 484.00-501.00 from 1 January 2027.' },
    { region: 'Region XIII', order: 'RXIII-20', effectiveFrom: '2026-01-03', range: '455.00-475.00', split: 'unverified', verified: false, note: 'Second tranche 475.00 from 1 May 2026.' },
    { region: 'BARMM', order: 'BARMM-05', effectiveFrom: '2026-08-06', range: '401.00-461.00', split: 'unverified', verified: false, note: 'Second tranche 426.00-461.00 from 1 December 2026.' }
  ];

  // NWPC annual factors. `monthly` is not a schedule; it is the basis of a monthly-paid employee,
  // who is paid for every day of the year.
  var FACTORS = {
    monthly: 365,
    everyDay: 393.50,
    noSunday: 313,
    noSundayNoSpecial: 310,
    noWeekend: 261,
    noWeekendNoSpecial: 258
  };

  var NORMAL_HOURS = 8;

  function iso(d) {
    if (!d) return new Date().toISOString().slice(0, 10);
    if (typeof d === 'string') return d.slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  // The order in force for a region on a date, and the rate for the employee's category.
  // A region whose category mapping has not been verified returns `unverified` — it never borrows
  // another region's rate and never guesses which end of a published range applies.
  function floorFor(opts) {
    opts = opts || {};
    var region = opts.region || 'NCR';
    var asOf = iso(opts.asOf);
    var candidates = ORDERS.filter(function (o) {
      return o.region === region && o.status === 'in-force' && o.effectiveFrom <= asOf;
    }).sort(function (a, b) { return a.effectiveFrom < b.effectiveFrom ? 1 : -1; });

    if (candidates.length) {
      var o = candidates[0];
      if (!o.rates) return { status: 'needs-category', dailyRate: null, region: region, orderId: o.id, categories: [], explanation: o.id + ' has no category rates configured.' };
      var key = o.split === 'sector' ? (opts.sector || 'non-agriculture') : opts.locality;
      var rate = key == null ? undefined : o.rates[key];
      if (rate == null) {
        return {
          status: 'needs-category', dailyRate: null, region: region, sector: opts.sector, locality: opts.locality,
          orderId: o.id, effectiveFrom: o.effectiveFrom, split: o.split,
          categories: Object.keys(o.rates),
          explanation: o.id + ' splits by ' + o.split + '. Choose one of: ' + Object.keys(o.rates).join(', ') + '.'
        };
      }
      return {
        status: 'in-force', dailyRate: rate, orderId: o.id, effectiveFrom: o.effectiveFrom,
        region: region, sector: opts.sector, locality: opts.locality, split: o.split, category: key
      };
    }

    var reg = REGISTER.filter(function (r) { return r.region === region; })[0];
    if (reg && !reg.verified) {
      return {
        status: 'unverified', dailyRate: null, region: region,
        orderId: reg.order, effectiveFrom: reg.effectiveFrom, publishedRange: reg.range,
        explanation: reg.order + ' is published for ' + region + ' at ' + reg.range + ' a day, but the ' +
          'category mapping inside the order has not been verified here, so no floor is applied.'
      };
    }

    var pending = ORDERS.filter(function (x) {
      return x.region === region && x.effectiveFrom > asOf;
    }).sort(function (a, b) { return a.effectiveFrom < b.effectiveFrom ? -1 : 1; })[0];
    var suspended = ORDERS.filter(function (x) {
      return x.region === region && x.status === 'suspended';
    })[0];
    return {
      status: 'unknown', dailyRate: null, region: region, sector: opts.sector, locality: opts.locality,
      nextOrder: pending ? { id: pending.id, effectiveFrom: pending.effectiveFrom } : null,
      suspendedOrder: suspended ? { id: suspended.id, effectiveFrom: suspended.effectiveFrom, note: suspended.note } : null
    };
  }

  // Coverage summary for the expansion plan.
  function coverage() {
    var verified = REGISTER.filter(function (r) { return r.verified; });
    return {
      total: REGISTER.length,
      verified: verified.length,
      unverified: REGISTER.length - verified.length,
      regions: REGISTER.slice(),
      verifiedRegions: verified.map(function (r) { return r.region; })
    };
  }

  // Normalised classification. A missing basis is treated as monthly, which is what every existing
  // record is; it is never inferred from the size of the salary.
  function classification(employee) {
    var e = employee || {};
    var s = e.schedule || {};
    var basis = e.payBasis === 'daily' || e.payBasis === 'hourly' ? e.payBasis : 'monthly';
    var hours = s.hoursPerDay == null ? NORMAL_HOURS : Number(s.hoursPerDay);
    if (!isFinite(hours) || hours <= 0) hours = NORMAL_HOURS;
    var days = s.daysPerWeek == null ? 5 : Number(s.daysPerWeek);
    if (!isFinite(days) || days <= 0) days = 5;
    return {
      basis: basis,
      arrangement: hours < NORMAL_HOURS ? 'part-time' : 'full-time',
      hoursPerDay: hours,
      daysPerWeek: days,
      paidRestDays: s.paidRestDays !== false,
      paidSpecialDays: s.paidSpecialDays !== false,
      wage: e.wage || {}
    };
  }

  // The annual factor for this employee, per the NWPC table.
  function factorFor(employee) {
    var c = classification(employee);
    if (c.basis === 'monthly') return FACTORS.monthly;
    if (c.daysPerWeek >= 7) return FACTORS.everyDay;
    if (c.daysPerWeek >= 6) return c.paidSpecialDays ? FACTORS.noSunday : FACTORS.noSundayNoSpecial;
    return c.paidSpecialDays ? FACTORS.noWeekend : FACTORS.noWeekendNoSpecial;
  }

  function factorLabel(employee) {
    var c = classification(employee);
    if (c.basis === 'monthly') return '365 days (monthly-paid: 298 ordinary + 52 rest + 12 regular holidays + 3 special days)';
    if (c.daysPerWeek >= 7) return '393.50 days (daily-paid, works every day including rest days)';
    if (c.daysPerWeek >= 6) return (c.paidSpecialDays ? '313' : '310') + ' days (daily-paid, rest day is Sunday only' + (c.paidSpecialDays ? '' : ', special days unpaid') + ')';
    return (c.paidSpecialDays ? '261' : '258') + ' days (daily-paid, rest days are Saturday and Sunday' + (c.paidSpecialDays ? '' : ', special days unpaid') + ')';
  }

  // What the employee is paid for one normal day.
  function equivalentDaily(employee) {
    var c = classification(employee);
    if (c.basis === 'daily') return Number(employee.dailyRate) || 0;
    if (c.basis === 'hourly') return (Number(employee.hourlyRate) || 0) * c.hoursPerDay;
    var monthly = Number(employee.monthlyBasic != null ? employee.monthlyBasic : employee.basic) || 0;
    return monthly * 12 / FACTORS.monthly;
  }

  // Equivalent monthly rate, per the NWPC formula for the employee's own classification.
  function equivalentMonthly(employee) {
    var c = classification(employee);
    if (c.basis === 'monthly') return Number(employee.monthlyBasic != null ? employee.monthlyBasic : employee.basic) || 0;
    return equivalentDaily(employee) * factorFor(employee) / 12;
  }

  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  // check(employee, asOf) -> status 'ok' | 'below' | 'exempt' | 'unknown'
  function check(employee, asOf) {
    var c = classification(employee);
    var f = floorFor({ region: c.wage.region, sector: c.wage.sector, locality: c.wage.locality, asOf: asOf });
    var paid = equivalentDaily(employee);
    // The floor is for eight normal hours; a shorter day is compared against its proportionate part.
    var floorForHours = f.status === 'in-force' ? f.dailyRate * c.hoursPerDay / NORMAL_HOURS : null;
    var base = {
      employeeId: employee && employee.id,
      region: c.wage.region || 'NCR',
      sector: c.wage.sector || 'non-agriculture',
      locality: c.wage.locality || null,
      basis: c.basis,
      arrangement: c.arrangement,
      hoursPerDay: c.hoursPerDay,
      daysPerWeek: c.daysPerWeek,
      factor: factorFor(employee),
      factorLabel: factorLabel(employee),
      equivalentDaily: r2(paid),
      equivalentMonthly: r2(equivalentMonthly(employee)),
      floor: f,
      floorForHours: floorForHours == null ? null : r2(floorForHours)
    };

    if (f.status !== 'in-force') {
      base.status = f.status === 'unverified' || f.status === 'needs-category' ? f.status : 'unknown';
      if (f.status === 'unverified') { base.explanation = f.explanation; return base; }
      if (f.status === 'needs-category') { base.explanation = f.explanation; return base; }
      base.status = 'unknown';
      base.explanation = 'No wage order in force for ' + base.region + ' / ' + base.sector + ' on ' + iso(asOf) +
        (f.nextOrder ? '. ' + f.nextOrder.id + ' sets ' + f.nextOrder.dailyRate + ' from ' + f.nextOrder.effectiveFrom + '.' : '.') +
        (f.suspendedOrder ? ' ' + f.suspendedOrder.id + ' is suspended: ' + f.suspendedOrder.note : '');
      return base;
    }

    if (paid + 0.005 >= floorForHours) {
      base.status = 'ok';
      base.explanation = (c.basis === 'monthly' ? 'Monthly-paid equivalent ' : c.basis === 'daily' ? 'Daily rate ' : 'Hourly-paid equivalent ') +
        base.equivalentDaily.toFixed(2) + ' for ' + c.hoursPerDay + ' h is at or above the ' + f.orderId + ' floor of ' +
        floorForHours.toFixed(2) + ' for ' + c.hoursPerDay + ' h (' + f.dailyRate.toFixed(2) + ' for 8 h). Factor ' +
        factorFor(employee) + ' days.';
      return base;
    }

    base.shortfall = r2(floorForHours - paid);
    var exemption = c.wage.exemption;
    if (exemption && exemption.reference) {
      base.status = 'exempt';
      base.explanation = 'Below the ' + f.orderId + ' floor by ' + base.shortfall.toFixed(2) + ' for ' + c.hoursPerDay +
        ' h, covered by exemption ' + exemption.code + ' (' + exemption.reference + ').';
      return base;
    }

    base.status = 'below';
    base.explanation = (c.basis === 'monthly' ? 'Monthly-paid equivalent ' : c.basis === 'daily' ? 'Daily rate ' : 'Hourly-paid equivalent ') +
      base.equivalentDaily.toFixed(2) + ' for ' + c.hoursPerDay + ' h is ' + base.shortfall.toFixed(2) +
      ' below the ' + f.orderId + ' floor of ' + floorForHours.toFixed(2) + ' for ' + c.hoursPerDay +
      ' h (' + f.dailyRate.toFixed(2) + ' for 8 h, factor ' + factorFor(employee) + ' days). Raise the rate or record an exemption with a reference.';
    return base;
  }

  function orders() { return ORDERS.slice(); }

  function addOrder(order) {
    if (!order || !order.id || !order.region || !order.sector || !order.effectiveFrom) {
      return { ok: false, error: 'A wage order needs an id, region, sector and effective date.' };
    }
    if (!(Number(order.dailyRate) > 0)) return { ok: false, error: 'A wage order needs a daily rate.' };
    // A configured order is a single rate for one category, in the same shape as a read order.
    var rates = {};
    rates[order.sector || 'non-agriculture'] = Number(order.dailyRate);
    ORDERS.push({
      id: order.id, region: order.region, split: 'sector',
      effectiveFrom: iso(order.effectiveFrom),
      status: order.status || 'in-force', note: order.note || '', rates: rates,
      contingent: order.contingent || null
    });
    return { ok: true, orders: orders() };
  }

  HIS.wageFloor = {
    ORDERS: ORDERS, FACTORS: FACTORS, NORMAL_HOURS: NORMAL_HOURS,
    orders: orders, addOrder: addOrder, floorFor: floorFor,
    coverage: coverage, REGISTER: REGISTER,
    classification: classification, factorFor: factorFor, factorLabel: factorLabel,
    equivalentDaily: equivalentDaily, equivalentMonthly: equivalentMonthly, check: check
  };
})();
