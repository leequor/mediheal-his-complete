// Philippine minimum-wage validation (M10.1).
//
// WHAT THIS DOES
// Checks an employee's rate against the wage order in force for their region and sector on a given
// date, and reports the comparison in a form a payroll officer can act on. It does not set pay: it
// refuses to let a payroll run be approved while an employee is below the floor without a recorded
// exemption.
//
// SOURCE
//   NWPC daily minimum wage rates, https://nwpc.dole.gov.ph/ — National Capital Region.
//     WO No. NCR-28, effective 26 September 2026: P718.00-P755.00.
//     WO No. NCR-27, effective 25 July 2026, implementation awaiting final decision from
//     Pasig RTC 152 and Navotas RTC 287 — modelled as `suspended`, never applied.
//   The second tranche announced under NCR-27 (P743.00-P780.00 on 20 January 2027) belongs to a
//   suspended order. It is recorded as `contingent` and is never applied before its date, and not
//   at all unless the suspension is lifted.
//
// NO NATIONAL RATE. A floor is only returned when an order matches the region AND the sector AND
// is in force on the date asked for. Before 26 September 2026 this file has no NCR order in force,
// so it reports `unknown` rather than inventing a rate.
//
// CONVERSION. A monthly salary is converted to a daily equivalent with the same 261-day factor the
// payroll engine uses (12 months x 261 working days), never by dividing by 30:
//     daily equivalent = monthly x 12 / 261 / FTE
// FTE is paid hours a day over eight. A part-timer on four hours a day must still clear the floor
// on a full-time-equivalent basis, which is what dividing by FTE tests.
//
// WHAT IT DOES NOT DO
// It is not a compliance determination. Wage orders carry sector definitions, establishment-size
// rules, exemptions and partial exemptions that a hospital's HR and legal team must apply. This
// module models region, sector and establishment category only.
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

  var HOURS_PER_DAY = 8;
  var WORKING_DAYS_PER_YEAR = 261;

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

    // Explain what exists but cannot be applied, so the caller can say why rather than guess.
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

  function fteOf(employee) {
    var w = (employee && employee.wage) || {};
    var hours = w.hoursPerDay == null ? HOURS_PER_DAY : Number(w.hoursPerDay);
    if (!isFinite(hours) || hours <= 0) hours = HOURS_PER_DAY;
    return hours / HOURS_PER_DAY;
  }

  // Daily equivalent of the employee's rate, on a full-time-equivalent basis.
  function dailyEquivalent(employee) {
    var w = (employee && employee.wage) || {};
    if (employee && employee.dailyRate != null) return Number(employee.dailyRate) / fteOf(employee);
    var monthly = Number(employee && (employee.monthlyBasic != null ? employee.monthlyBasic : employee.basic)) || 0;
    return (monthly * 12 / WORKING_DAYS_PER_YEAR) / fteOf(employee);
  }

  // check(employee, asOf) -> { status, floor, dailyEquivalent, shortfall, explanation }
  //   status 'ok'      at or above the floor
  //   status 'below'   below the floor and not exempt
  //   status 'exempt'  below the floor but an exemption is recorded
  //   status 'unknown' no order in force for that region, sector and date
  function check(employee, asOf) {
    var w = (employee && employee.wage) || {};
    var f = floorFor({ region: w.region, sector: w.sector, asOf: asOf });
    var eq = dailyEquivalent(employee);
    var base = {
      employeeId: employee && employee.id, region: w.region || 'NCR', sector: w.sector || 'non-agriculture',
      dailyEquivalent: Math.round(eq * 100) / 100, floor: f, fte: Math.round(fteOf(employee) * 100) / 100
    };

    if (f.status !== 'in-force') {
      base.status = 'unknown';
      base.explanation = 'No wage order in force for ' + base.region + ' / ' + base.sector + ' on ' + iso(asOf) +
        (f.nextOrder ? '. ' + f.nextOrder.id + ' sets ' + f.nextOrder.dailyRate + ' from ' + f.nextOrder.effectiveFrom + '.' : '.') +
        (f.suspendedOrder ? ' ' + f.suspendedOrder.id + ' is suspended: ' + f.suspendedOrder.note : '');
      return base;
    }

    if (eq + 0.005 >= f.dailyRate) {
      base.status = 'ok';
      base.explanation = 'Daily equivalent ' + base.dailyEquivalent.toFixed(2) + ' is at or above the ' +
        f.orderId + ' floor of ' + f.dailyRate.toFixed(2) + ' for ' + base.sector + '.';
      return base;
    }

    var exemption = w.exemption;
    if (exemption && exemption.reference) {
      base.status = 'exempt';
      base.shortfall = Math.round((f.dailyRate - eq) * 100) / 100;
      base.explanation = 'Below the ' + f.orderId + ' floor by ' + base.shortfall.toFixed(2) + ' a day, covered by exemption ' +
        exemption.code + ' (' + exemption.reference + ').';
      return base;
    }

    base.status = 'below';
    base.shortfall = Math.round((f.dailyRate - eq) * 100) / 100;
    base.explanation = 'Daily equivalent ' + base.dailyEquivalent.toFixed(2) + ' is ' + base.shortfall.toFixed(2) +
      ' below the ' + f.orderId + ' floor of ' + f.dailyRate.toFixed(2) + ' for ' + base.sector +
      '. Raise the rate or record an exemption with a reference.';
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
    ORDERS: ORDERS, HOURS_PER_DAY: HOURS_PER_DAY, WORKING_DAYS_PER_YEAR: WORKING_DAYS_PER_YEAR,
    orders: orders, addOrder: addOrder, floorFor: floorFor,
    dailyEquivalent: dailyEquivalent, fteOf: fteOf, check: check
  };
})();
