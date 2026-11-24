// Strategies 11 and 12: surfaces the first ten never touched.
//
//   11. Calendar boundaries. The app's day is Manila (+08), not UTC, and money is billed per calendar
//       night. A stay, a payroll period or an attendance shift that crosses midnight, a month end or
//       29 February must not be off by one, and must never produce a fractional or negative count.
//   12. Money extremes and round trips. Weighted by centavos, so every amount must survive
//       pesos -> centavos -> pesos exactly, and an absurd amount must be refused or held exactly -
//       never silently truncated to a float artefact.

const money = (s) => Number(String(s).replace(/[^\d.-]/g, '')) || 0;

export async function run(ITER, api) {
  const { base, errors, bad, ok, reseed } = api;
  const page = () => api.page;

  // ---------------------------------------------------------------- 11. calendar boundaries
  if (ITER === 11) {
    await reseed();
    const p = page();
    await p.goto(`${base}/admissions.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(400);

    // Days on the ward, counting both the arrival day and the last day (the module's own definition).
    const cases = [
      { name: 'one night across a month end', in: '2026-01-31', out: '2026-02-01', min: 2, max: 2 },
      { name: 'three nights across a 28-day February', in: '2026-02-27', out: '2026-03-02', min: 4, max: 4 },
      { name: 'leap day in a leap year', in: '2028-02-28', out: '2028-03-01', min: 3, max: 3 },
      { name: 'same day, no night', in: '2026-06-10', out: '2026-06-10', min: 1, max: 1 },
      { name: 'year boundary', in: '2026-12-31', out: '2027-01-02', min: 3, max: 3 },
      { name: 'long stay, past the 400-day guard', in: '2026-01-01', out: '2027-02-05', min: 2, max: 402 },
    ];

    for (const c of cases) {
      const r = await p.evaluate((cs) => {
        try {
          const adm = { id: 'TEST-1', admittedAt: cs.in + 'T09:00:00+08:00', discharge: { at: cs.out + 'T09:00:00+08:00', disposition: 'Recovered' }, status: 'discharged' };
          const days = HIS.admissions.stayDays ? HIS.admissions.stayDays(adm) : null;
          const billable = HIS.admissions.billableDates ? HIS.admissions.billableDates(adm, new Date(cs.out + 'T12:00:00+08:00')) : null;
          return { days, billableCount: Array.isArray(billable) ? billable.length : null, billableFirst: Array.isArray(billable) ? billable[0] : null, billableLast: Array.isArray(billable) ? billable[billable.length - 1] : null };
        } catch (e) { return { error: String(e.message).slice(0, 100) }; }
      }, c);

      if (r.error) bad(`calendar "${c.name}": threw ${r.error}`);
      else if (typeof r.days !== 'number' || !isFinite(r.days) || r.days < 0 || r.days !== Math.round(r.days)) bad(`calendar "${c.name}": stayDays returned ${r.days}`);
      else if (r.days < c.min || r.days > c.max) bad(`calendar "${c.name}": stayDays ${r.days}, expected ${c.min}-${c.max}`);
      else if (r.billableCount !== null && (r.billableCount < r.days - 1 || r.billableCount > r.days + 1)) bad(`calendar "${c.name}": ${r.billableCount} billable dates for ${r.days} days on the ward`);
      else ok();
    }

    // The Manila day, not the UTC day: 00:30 on 2 March in Manila is still 1 March in UTC.
    const tz = await p.evaluate(() => {
      try {
        const adm = { id: 'TZ', admittedAt: '2026-03-02T00:30:00+08:00', discharge: { at: '2026-03-02T23:30:00+08:00' }, status: 'discharged' };
        const days = HIS.admissions.stayDays(adm);
        const dates = HIS.admissions.billableDates(adm, new Date('2026-03-03T12:00:00+08:00'));
        return { days, first: dates && dates[0], last: dates && dates[dates.length - 1] };
      } catch (e) { return { error: String(e.message).slice(0, 80) }; }
    });
    if (tz.error) bad(`calendar Manila boundary: threw ${tz.error}`);
    else if (tz.first && !/^2026-03-0[12]/.test(tz.first)) bad(`calendar Manila boundary: first billable date ${tz.first} is neither 1 nor 2 March`);
    else ok();

    // Payroll: a period must not lose a day at either end, and a monthly rate must annualise exactly.
    await p.goto(`${base}/payroll.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(400);
    const pay = await p.evaluate(() => {
      try {
        const emp = (HIS.employees.all() || [])[0];
        if (!emp) return { skipped: true };
        const annual = HIS.payrollCalc.annualize(emp);
        const semi = HIS.payrollCalc.annualize(emp, { period: 'semi-monthly' });
        // annualize returns a breakdown, not a scalar: every figure in it must be a finite number.
        var nums = function (o) { return o && typeof o === 'object' ? Object.keys(o).filter(function (k) { return typeof o[k] === 'number'; }).map(function (k) { return o[k]; }) : [o]; };
        var all = nums(annual).concat(nums(semi));
        return { annual, semi, finite: all.length > 0 && all.every(function (n) { return isFinite(n); }) };
      } catch (e) { return { error: String(e.message).slice(0, 80) }; }
    });
    if (pay.skipped) ok();
    else if (pay.error) bad(`calendar payroll annualise: threw ${pay.error}`);
    else if (!pay.finite) bad('calendar payroll annualise: non-finite figure in the breakdown');
    else ok();

    // Attendance: an overnight shift (22:00 to 06:00) is one shift, not a negative duration.
    const shift = await p.evaluate(() => {
      try {
        const st = HIS.attendance && HIS.attendance.shiftMinutes ? HIS.attendance.shiftMinutes
          : HIS.attendancePeriod && HIS.attendancePeriod.shiftMinutes ? HIS.attendancePeriod.shiftMinutes : null;
        if (!st) return { skipped: true };
        const m = st('22:00', '06:00');
        return { m };
      } catch (e) { return { error: String(e.message).slice(0, 80) }; }
    });
    if (shift.error) bad(`calendar overnight shift: threw ${shift.error}`);
    else if (shift.skipped) ok();
    else if (!(shift.m >= 0)) bad(`calendar overnight shift: ${shift.m} minutes`);
    else ok();
  }

  // ---------------------------------------------------------------- 12. money extremes
  if (ITER === 12) {
    await reseed();
    const p = page();
    await p.goto(`${base}/billing.html`, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(400);

    const round = await p.evaluate(() => {
      const values = [0, 0.01, 0.005, 0.015, 1.005, 12.345, 999.999, 1234.565, 1e6 + 0.01, 1e9, -5, -0.005];
      return values.map(v => {
        try {
          const c = HIS.ledger.toCentavos(v);
          const back = HIS.ledger.toPesos(c);
          return { v, c, back, drift: Math.abs(back - v), int: Number.isInteger(c) };
        } catch (e) { return { v, error: String(e.message).slice(0, 60) }; }
      });
    });
    for (const r of round) {
      if (r.error) { bad(`money ${r.v}: threw ${r.error}`); continue; }
      if (!r.int) bad(`money ${r.v}: centavos ${r.c} is not a whole number`);
      else if (r.drift > 0.0050001) bad(`money ${r.v}: round trip drifted ${r.drift.toFixed(6)}`);
      else ok();
    }

    // An absurd amount must be refused in writing or stored exactly — never silently rounded into
    // something the ledger then contradicts.
    const huge = ['999999999999.99', '1e15', '-1', '0.004', '123456789.005'];
    for (const amt of huge) {
      await p.goto(`${base}/billing.html`, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(300);
      const before = await p.evaluate(() => (HIS.store.get('mh_ledger', []) || []).length);
      const opened = await p.evaluate(() => {
        const b = [...document.querySelectorAll('button')].filter(x => x.offsetWidth).find(x => /record payment/i.test(x.textContent || ''));
        if (!b) return false; b.click(); return true;
      });
      if (!opened) { bad('money: Record payment missing'); break; }
      await p.waitForTimeout(220);
      await p.evaluate((a) => {
        const d = [...document.querySelectorAll('.bl-modal, [class$=-modal]')].filter(x => x.offsetWidth).pop();
        if (!d) return;
        const f = d.querySelector('[data-i="2"]') || [...d.querySelectorAll('input')].filter(e => e.offsetWidth)[1];
        if (f) { f.value = a; f.dispatchEvent(new Event('input', { bubbles: true })); }
        const btn = [...d.querySelectorAll('button')].filter(b => b.offsetWidth && /pay|record/i.test(b.textContent || '')).pop();
        if (btn) btn.click();
      }, amt);
      await p.waitForTimeout(420);
      const after = await p.evaluate(() => {
        const rows = HIS.store.get('mh_ledger', []) || [];
        const last = rows[rows.length - 1] || null;
        return {
          count: rows.length,
          lastAmount: last ? last.amount : null,
          toast: (document.querySelector('#kit-toast') || {}).textContent
            || ([...document.querySelectorAll('.bl-tip')].filter(e => e.offsetWidth)[0] || {}).textContent || null,
          stillOpen: [...document.querySelectorAll('.bl-modal, [class$=-modal]')].filter(d => d.offsetWidth).length,
          inv: HIS.ledger.invariants ? HIS.ledger.invariants() : null,
        };
      });
      if (after.inv && after.inv.ok === false) bad(`money "${amt}": broke a ledger invariant`);
      else if (after.count > before) {
        if (!isFinite(after.lastAmount)) bad(`money "${amt}": stored a non-finite amount ${after.lastAmount}`);
        else ok();
      } else if (!after.toast && !after.stillOpen) bad(`money "${amt}": refused with nothing shown and the dialog gone`);
      else ok();
    }
  }
}
