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
  var ORDERS = [
    {
      id: 'NCR-27', region: 'NCR', sector: 'non-agriculture', dailyRate: 718, effectiveFrom: '2026-07-25',
      status: 'suspended',
      note: 'Implementation awaiting final decision from Pasig RTC 152 and Navotas RTC 287.',
      contingent: { effectiveFrom: '2027-01-20', dailyRate: 743 }
    },
    {
      id: 'NCR-27', region: 'NCR', sector: 'agriculture', dailyRate: 718, effectiveFrom: '2026-07-25',
      status: 'suspended',
      note: 'Implementation awaiting final decision from Pasig RTC 152 and Navotas RTC 287.',
      contingent: { effectiveFrom: '2027-01-20', dailyRate: 743 }
    },
    {
      id: 'NCR-28', region: 'NCR', sector: 'non-agriculture', dailyRate: 755, effectiveFrom: '2026-09-26',
      status: 'in-force', note: 'Non-agriculture.'
    },
    {
      id: 'NCR-28', region: 'NCR', sector: 'agriculture', dailyRate: 718, effectiveFrom: '2026-09-26',
      status: 'in-force', note: 'Agriculture and the other categories covered by the lower rate.'
    },
    {
      id: 'NCR-28', region: 'NCR', sector: 'retail-service', dailyRate: 718, effectiveFrom: '2026-09-26',
      status: 'in-force', note: 'Retail and service establishments covered by the lower rate.'
    }
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

  // The order in force for a region and sector on a date. Suspended and future orders are skipped.
  function floorFor(opts) {
    opts = opts || {};
    var region = opts.region || 'NCR';
    var sector = opts.sector || 'non-agriculture';
    var asOf = iso(opts.asOf);
    var candidates = ORDERS.filter(function (o) {
      return o.region === region && o.sector === sector &&
        o.status === 'in-force' && o.effectiveFrom <= asOf;
    }).sort(function (a, b) { return a.effectiveFrom < b.effectiveFrom ? 1 : -1; });

    if (candidates.length) {
      var o = candidates[0];
      return { status: 'in-force', dailyRate: o.dailyRate, orderId: o.id, effectiveFrom: o.effectiveFrom, sector: sector, region: region };
    }

    var pending = ORDERS.filter(function (x) {
      return x.region === region && x.sector === sector && x.effectiveFrom > asOf;
    }).sort(function (a, b) { return a.effectiveFrom < b.effectiveFrom ? -1 : 1; })[0];
    var suspended = ORDERS.filter(function (x) {
      return x.region === region && x.sector === sector && x.status === 'suspended';
    })[0];
    return {
      status: 'unknown', dailyRate: null, region: region, sector: sector,
      nextOrder: pending ? { id: pending.id, effectiveFrom: pending.effectiveFrom, dailyRate: pending.dailyRate } : null,
      suspendedOrder: suspended ? { id: suspended.id, effectiveFrom: suspended.effectiveFrom, dailyRate: suspended.dailyRate, note: suspended.note } : null
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
    var f = floorFor({ region: c.wage.region, sector: c.wage.sector, asOf: asOf });
    var paid = equivalentDaily(employee);
    // The floor is for eight normal hours; a shorter day is compared against its proportionate part.
    var floorForHours = f.status === 'in-force' ? f.dailyRate * c.hoursPerDay / NORMAL_HOURS : null;
    var base = {
      employeeId: employee && employee.id,
      region: c.wage.region || 'NCR',
      sector: c.wage.sector || 'non-agriculture',
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
    ORDERS.push({
      id: order.id, region: order.region, sector: order.sector,
      dailyRate: Number(order.dailyRate), effectiveFrom: iso(order.effectiveFrom),
      status: order.status || 'in-force', note: order.note || '', contingent: order.contingent || null
    });
    return { ok: true, orders: orders() };
  }

  HIS.wageFloor = {
    ORDERS: ORDERS, FACTORS: FACTORS, NORMAL_HOURS: NORMAL_HOURS,
    orders: orders, addOrder: addOrder, floorFor: floorFor,
    classification: classification, factorFor: factorFor, factorLabel: factorLabel,
    equivalentDaily: equivalentDaily, equivalentMonthly: equivalentMonthly, check: check
  };
})();
