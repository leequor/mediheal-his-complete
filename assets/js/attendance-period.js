// Attendance for the pay period (M10).
//
// WHY THIS FILE EXISTS
// The Attendance screen was a single-day register (Aug 31) and Payroll never read it: the payroll
// row carried `days: 11, hours: 92` as literals. Payroll therefore could not react to an absence,
// a late arrival, overtime or a night shift — the numbers on the two screens were unrelated.
//
// This module holds one record per employee per day for the whole pay period, plus a timesheet
// approval state per employee. Payroll reads `summary(empId)` and refuses to pay an employee whose
// timesheet is not approved.
//
// DAY TYPES. Aug 21, 2026 is a special non-working day (Ninoy Aquino Day) and Aug 31, 2026 is a
// regular holiday (National Heroes Day). Both are modelled, because they change the premium: a
// regular holiday worked pays 200% (Art. 94), a special day worked pays 130% (Art. 93).
//
// CORRECTIONS. A correction never edits an approved record in place: it writes the new value, sets
// the timesheet back to `submitted`, and appends the previous value to the record's history. Payroll
// then refuses to run until a supervisor approves again, and the earlier payroll version stays in
// `mh_payroll_runs` untouched.
//
// DEMO DATA. The patterns below are synthetic. Each character is one calendar day from Aug 16 to
// Aug 31, 2026, in order.
//   R rest day (not worked)          P present, on time
//   L late 40 minutes                U undertime 45 minutes
//   A absent, no approved leave      V approved vacation leave (paid)
//   K approved sick leave (paid)     O present + 2 h overtime
//   N night shift 10 PM - 6 AM       W rest day worked
//   H regular holiday, not worked    J regular holiday worked
//   Q regular holiday worked + 2 h overtime
//   X special non-working day worked Y special non-working day, not worked
(function () {
  // Two cut-offs, because payroll has two. Until 2026-11-22 only Aug 16–31 existed, which is why
  // the pay-period control on the Payroll screen could not do anything: there was one period to
  // pick. The earlier cut-off is a normal, closed period: its timesheets are approved and its
  // records differ from the current one, so switching periods changes the numbers.
  var PERIODS = [
    {
      id: '2026-08-01/15',
      label: 'Aug 1\u201315, 2026',
      start: '2026-08-01',
      end: '2026-08-15',
      payDate: '2026-08-15',
      frequency: 'semi-monthly'
    },
    {
      id: '2026-08-16/31',
      label: 'Aug 16\u201331, 2026',
      start: '2026-08-16',
      end: '2026-08-31',
      payDate: '2026-08-31',
      frequency: 'semi-monthly'
    }
  ];
  // The period the demo opens on. Kept as `PERIOD` because payroll-runs and the harnesses read it.
  var PERIOD = PERIODS[PERIODS.length - 1];

  var HOLIDAYS = {
    '2026-08-21': { type: 'special', name: 'Ninoy Aquino Day' },
    '2026-08-31': { type: 'regular', name: 'National Heroes Day' }
  };

  // One character per calendar day of the period, in order.
  var PATTERNS = {
    'EMP-001': 'RPPPPXRRPPPPPRRJ',
    'EMP-002': 'RPPPPYRRPPPPPRRH',
    'EMP-003': 'RPPPPPWRPPPPPRRQ',
    'EMP-004': 'RPPPLRRPPPPPARH',
    'EMP-005': 'RPPPPPRRPNPPPRRH',
    'EMP-006': 'RPLPPPRRPPPOPRRH',
    'EMP-007': 'RPPPPPRRPKPPPRRH',
    'EMP-008': 'RPAPPPRRPPPUPRRH'
  };
  // Aug 1–15 (15 days). Deliberately different from the second cut-off: fewer holiday premiums,
  // one more absence, and a rest-day shift that the first half did not have.
  var PATTERNS_PREV = {
    'EMP-001': 'RPPPPRRPPPPRRPH',
    'EMP-002': 'RPPPPRRPPPPPRRP',
    'EMP-003': 'RPPPLRRPPPPWRRP',
    'EMP-004': 'RPPPPRRPAPPPRRP',
    'EMP-005': 'RPPPPRRPPNPPRRP',
    'EMP-006': 'RPPPPRRPPOPPRRP',
    'EMP-007': 'RPPPPRRPKPPPRRP',
    'EMP-008': 'RPAPPRRPPUPPRRP'
  };

  var KEY = HIS.store.KEY.attendancePeriod;
  var MIN = 60 * 1000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDay(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }

  function periodDays(p) {
    p = p || active();
    var out = [], d = parseDay(p.start), end = parseDay(p.end);
    while (d <= end) { out.push(iso(d)); d = addDays(d, 1); }
    return out;
  }

  function toMinutes(hhmm) {
    if (!hhmm) return null;
    var p = String(hhmm).split(':');
    return (+p[0]) * 60 + (+p[1]);
  }
  // Hours between two HH:MM times, crossing midnight if needed, less the unpaid break.
  function hoursBetween(a, b, breakMinutes) {
    var m = toMinutes(b) - toMinutes(a);
    if (m < 0) m += 1440;
    return Math.max(0, (m - (breakMinutes || 0)) / 60);
  }

  // CLASSIFY BEFORE PRICING. Given one attendance record, split the hours worked into the buckets
  // the payroll engine prices differently. Article 87 puts statutory overtime at work beyond eight
  // hours in the day — not beyond the end of the schedule — so a part-timer who works two extra
  // hours has two ADDITIONAL hours, not two overtime hours.
  //
  //   ordinary    scheduled hours actually worked, covered by the period basic
  //   additional  beyond the schedule but inside eight
  //   ot          beyond eight
  //   rest        first eight hours on a rest day (premium), restOt beyond eight
  //   holiday     first eight hours on a holiday, holidayOt beyond eight
  function classify(r) {
    var scheduled = hoursBetween(r.shiftStart, r.shiftEnd, r.breakMinutes);
    var worked = r.worked ? hoursBetween(r.timeIn, r.timeOut, r.breakMinutes) : 0;
    var out = {
      scheduled: scheduled, worked: worked,
      ordinary: 0, additional: 0, ot: 0,
      rest: 0, restOt: 0, holiday: 0, holidayOt: 0,
      dayType: r.dayType
    };
    if (!r.worked) return out;
    if (r.dayType === 'rest') {
      out.rest = Math.min(worked, 8);
      out.restOt = Math.max(0, worked - 8);
    } else if (r.dayType === 'regular-holiday' || r.dayType === 'special') {
      out.holiday = Math.min(worked, 8);
      out.holidayOt = Math.max(0, worked - 8);
    } else {
      out.ordinary = Math.min(worked, scheduled);
      out.additional = Math.max(0, Math.min(worked, 8) - scheduled);
      out.ot = Math.max(0, worked - 8);
    }
    return out;
  }

  function fromMinutes(m) {
    m = ((Math.round(m) % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }

  // ---- expansion ------------------------------------------------------------------------------
  function buildRecord(emp, date, code) {
    var dow = parseDay(date).getDay();
    var holiday = HOLIDAYS[date] || null;
    var onRestDay = (emp.restDays || [0, 6]).indexOf(dow) > -1;
    var dayType = holiday ? (holiday.type === 'regular' ? 'regular-holiday' : 'special')
      : (onRestDay ? 'rest' : 'regular');

    var start = emp.shift.start, end = emp.shift.end, breakMinutes = emp.shift.breakMinutes;
    var timeIn = start, timeOut = end, otHours = 0, ndHours = 0;
    var status = 'present', leaveType = null;

    if (code === 'R' || code === 'H' || code === 'Y') {
      status = code === 'R' ? 'rest' : 'holiday';
      timeIn = null; timeOut = null;
    } else if (code === 'A') {
      status = 'absent'; timeIn = null; timeOut = null;
    } else if (code === 'V' || code === 'K') {
      status = 'leave'; leaveType = code === 'V' ? 'Vacation leave' : 'Sick leave';
      timeIn = null; timeOut = null;
    } else if (code === 'N') {
      // Night shift: the whole 8-hour tour falls inside the 10 PM - 6 AM differential window.
      start = '22:00'; end = '06:00'; breakMinutes = 0;
      timeIn = start; timeOut = end; ndHours = 8;
    } else if (code === 'L') {
      timeIn = fromMinutes(toMinutes(start) + 40);
    } else if (code === 'U') {
      timeOut = fromMinutes(toMinutes(end) - 45);
    } else if (code === 'O') {
      otHours = 2; timeOut = fromMinutes(toMinutes(end) + 120);
    } else if (code === 'Q') {
      otHours = 2; timeOut = fromMinutes(toMinutes(end) + 120);
    }

    if (code === 'W') dayType = 'rest';
    if (code === 'J' || code === 'Q') dayType = 'regular-holiday';
    if (code === 'X') dayType = 'special';

    var worked = !!timeIn && !!timeOut;
    var lateMinutes = 0, undertimeMinutes = 0;
    if (worked) {
      var scheduledIn = toMinutes(start);
      var scheduledOut = toMinutes(end);
      lateMinutes = Math.max(0, toMinutes(timeIn) - scheduledIn);
      undertimeMinutes = Math.max(0, scheduledOut - toMinutes(timeOut));
      // A night shift ends on the next calendar day.
      if (toMinutes(timeOut) < toMinutes(timeIn)) undertimeMinutes = 0;
      if (lateMinutes > 0 && lateMinutes <= 15) status = 'present';
      else if (lateMinutes > 15) status = 'late';
      if (undertimeMinutes > 0 && status !== 'late') status = 'undertime';
    }

    return {
      id: emp.id + ':' + date,
      empId: emp.id,
      date: date,
      dayType: dayType,
      holiday: holiday ? holiday.name : null,
      shiftStart: start,
      shiftEnd: end,
      breakMinutes: breakMinutes,
      timeIn: timeIn,
      timeOut: timeOut,
      status: status,
      leaveType: leaveType,
      leaveApproved: !!leaveType,
      otHours: otHours,
      ndHours: ndHours,
      lateMinutes: lateMinutes,
      undertimeMinutes: undertimeMinutes,
      worked: worked,
      note: '',
      history: []
    };
  }

  function seed() {
    var records = [], timesheets = {};
    PERIODS.forEach(function (p) {
      var days = periodDays(p);
      var bank = p.id === PERIOD.id ? PATTERNS : PATTERNS_PREV;
      HIS.employees.all().forEach(function (emp) {
        var pattern = bank[emp.id] || '';
        days.forEach(function (date, i) {
          records.push(buildRecord(emp, date, pattern.charAt(i) || 'R'));
        });
      });
      var approvedAt = p.payDate + 'T18:20:00+08:00';
      timesheets[p.id] = {};
      HIS.employees.all().forEach(function (emp) {
        timesheets[p.id][emp.id] = {
          status: 'approved', approvedBy: 'Carmela Dizon', approvedAt: approvedAt,
          submittedBy: 'Carmela Dizon', submittedAt: p.payDate + 'T17:05:00+08:00',
          history: [{ at: approvedAt, by: 'Carmela Dizon', action: 'approved', note: 'Period timesheet reviewed against the daily register.' }]
        };
      });
    });
    var state = { period: PERIOD, activePeriodId: PERIOD.id, periods: PERIODS, records: records, timesheets: timesheets, version: 2 };
    HIS.store.set(KEY, state);
    return state;
  }

  function state() {
    var s = HIS.store.get(KEY, null);
    if (!s || !Array.isArray(s.records)) s = seed();
    // A store written before the second cut-off existed has `timesheets` keyed by employee and no
    // active period. Re-key it under the period it belonged to instead of dropping it.
    if (!s.activePeriodId || !s.periods) {
      var oldId = (s.period && s.period.id) || PERIOD.id;
      var wrapped = {};
      wrapped[oldId] = s.timesheets || {};
      s = { period: s.period || PERIOD, activePeriodId: oldId, periods: PERIODS, records: s.records, timesheets: wrapped, version: 2 };
      HIS.store.set(KEY, s);
    }
    var added = false;
    HIS.employees.all().forEach(function (emp) {
      s.periods.forEach(function (p) {
        if (s.records.some(function (r) { return r.empId === emp.id && r.date >= p.start && r.date <= p.end; })) return;
        periodDays(p).forEach(function (day) { s.records.push(buildRecord(emp, day, 'A')); });
        s.timesheets[p.id] = s.timesheets[p.id] || {};
        s.timesheets[p.id][emp.id] = { status: 'submitted', history: [] };
        p.verified = false; added = true;
      });
    });
    if (added) HIS.store.set(KEY, s);
    var legacy = HIS.store.get('mh_attendance_state', null);
    if (!s.legacyDailyImported && legacy && !legacy.periodLinked && legacy.dirty && Array.isArray(legacy.emps)) {
      legacy.emps.forEach(function (e) {
        var r = s.records.filter(function (r) { return r.empId === e.id && r.date === '2026-08-31'; })[0];
        if (!r) return;
        var parse = function (t) { var m = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(t || ''); return m ? String(Number(m[1]) % 12 + (m[3] === 'PM' ? 12 : 0)).padStart(2, '0') + ':' + m[2] : null; };
        r.timeIn = parse(e.tin); r.timeOut = parse(e.tout); r.worked = !!r.timeIn && !!r.timeOut;
        r.status = e.status === 'On leave' ? 'leave' : e.status === 'Late' ? 'late' : r.worked ? 'present' : 'absent';
        r.leaveApproved = r.status === 'leave'; r.leaveType = r.leaveApproved ? 'Approved leave (legacy register)' : null;
        r.history = r.history || []; r.history.push({ at: new Date().toISOString(), by: 'migration', reason: 'Preserved saved daily register; HR must reverify.' });
        var p = s.periods.filter(function (p) { return inPeriod(r, p); })[0];
        p.verified = false; s.timesheets[p.id][e.id].status = 'submitted';
      });
      s.legacyDailyImported = true; HIS.store.set(KEY, s);
    }
    return s;
  }
  function active() {
    var s = state();
    return s.periods.filter(function (p) { return p.id === s.activePeriodId; })[0] || PERIOD;
  }
  function periods() { return state().periods.slice(); }
  // Switch the cut-off every attendance and payroll read resolves against. Returns the period.
  function setPeriod(id) {
    var s = state();
    if (!s.periods.some(function (p) { return p.id === id; })) return active();
    s.activePeriodId = id;
    s.period = s.periods.filter(function (p) { return p.id === id; })[0];
    HIS.store.set(KEY, s);
    return s.period;
  }
  function save(s) { HIS.store.set(KEY, s); return s; }

  // ---- reads ---------------------------------------------------------------------------------
  function all() { return state().records; }
  // Records of the ACTIVE cut-off only. Both periods are stored in one list keyed by date, so a
  // read that forgot this filter would pay a half-month twice.
  function inPeriod(r, p) { p = p || active(); return r.date >= p.start && r.date <= p.end; }
  function recordsFor(empId) {
    return all().filter(function (r) { return r.empId === empId && inPeriod(r); })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  function sheet(empId, p) {
    var s = state();
    p = p || active();
    var bank = s.timesheets[p.id] || (s.timesheets[p.id] = {});
    return bank[empId] || { status: 'submitted', history: [] };
  }
  function timesheet(empId) { return sheet(empId); }
  function approved(empId) { return timesheet(empId).status === 'approved'; }
  function unapproved() {
    return HIS.employees.all().filter(function (e) { return !approved(e.id); });
  }
  function days() { return periodDays(); }

  // The shape HIS.payrollCalc.compute() expects. Returns null when the timesheet is not approved,
  // so a caller cannot accidentally pay an unapproved period.
  function summary(empId) {
    if (!approved(empId)) return null;
    var emp = HIS.employees.byId(empId);
    var recs = recordsFor(empId);
    var s = HIS.payrollCalc.emptySummary(0);
    s.scheduledDays = 0; s.workedDays = 0; s.totalHours = 0;

    recs.forEach(function (r) {
      var scheduledH = hoursBetween(r.shiftStart, r.shiftEnd, r.breakMinutes);
      var workedH = r.worked ? hoursBetween(r.timeIn, r.timeOut, r.breakMinutes) : 0;

      if (r.dayType !== 'rest') { s.scheduledDays++; s.scheduledHours += scheduledH; }
      if (r.worked) { s.workedDays++; s.workedHours += workedH; s.totalHours += workedH; }
      if (r.status === 'absent') s.absenceDays++;
      if (r.status === 'leave' && r.leaveApproved) s.paidLeaveDays++;
      // Grace is a company policy, not a statutory rule: only lateness beyond it is docked.
      s.lateMinutes += Math.max(0, (r.lateMinutes || 0) - HIS.payrollCalc.CONFIG.graceMinutes);
      s.undertimeMinutes += (r.undertimeMinutes || 0);
      s.ndHours += r.ndHours || 0;
      if (!r.worked) return;

      var c = classify(r);
      if (r.dayType === 'rest') {
        s.restDayHours += c.rest;
        s.otHours.rest += c.restOt;
        s.premiumDays.rest++;
      } else if (r.dayType === 'regular-holiday') {
        s.regularHolidayHours += c.holiday;
        s.otHours.regularHoliday += c.holidayOt;
        s.premiumDays.regularHoliday++;
      } else if (r.dayType === 'special') {
        s.specialHours += c.holiday;
        s.otHours.special += c.holidayOt;
        s.premiumDays.special++;
      } else {
        s.ordinaryHours += c.ordinary;
        s.additionalHours += c.additional;
        s.otHours.ordinary += c.ot;
      }
    });
    ['totalHours', 'scheduledHours', 'workedHours', 'ordinaryHours', 'additionalHours',
      'restDayHours', 'regularHolidayHours', 'specialHours'].forEach(function (k) {
      s[k] = Math.round(s[k] * 100) / 100;
    });
    ['ordinary', 'rest', 'regularHoliday', 'special'].forEach(function (k) {
      s.otHours[k] = Math.round(s.otHours[k] * 100) / 100;
    });
    return s;
  }

  // ---- writes --------------------------------------------------------------------------------
  function log(empId, action, note) {
    var s = state();
    var p = active();
    var bank = s.timesheets[p.id] || (s.timesheets[p.id] = {});
    var ts = bank[empId] || { status: 'submitted', history: [] };
    ts.history = ts.history || [];
    var a = HIS.auth && HIS.auth.account ? HIS.auth.account() : null;
    ts.history.push({ at: new Date().toISOString(), by: a ? a.name : 'system', action: action, note: note || '' });
    bank[empId] = ts;
    save(s);
    return ts;
  }

  function approve(empId, note) {
    if (!HIS.rbac.can('verifyAttendance')) return { ok: false, error: 'Only HR can approve attendance.' };
    var s = state();
    var p = active();
    var bank = s.timesheets[p.id] || (s.timesheets[p.id] = {});
    var ts = bank[empId] || { status: 'submitted', history: [] };
    if (ts.status === 'approved') return { ok: false, error: 'That timesheet is already approved.' };
    var a = HIS.auth && HIS.auth.account ? HIS.auth.account() : null;
    ts.status = 'approved';
    ts.approvedBy = a ? a.name : 'system';
    ts.approvedAt = new Date().toISOString();
    bank[empId] = ts;
    save(s);
    log(empId, 'approved', note);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: ts.approvedBy, role: roleLabel(),
        what: 'Timesheet approved \u2014 ' + empId + ' for ' + PERIOD.label,
        entity: 'timesheet:' + empId, before: 'submitted', after: 'approved'
      });
    }
    return { ok: true, timesheet: ts };
  }

  function approveAll(note) {
    var pending = unapproved();
    var n = 0;
    pending.forEach(function (e) { if (approve(e.id, note).ok) n++; });
    return { ok: true, approved: n, remaining: unapproved().length };
  }

  function reopen(empId, reason) {
    if (!HIS.rbac.can('verifyAttendance')) return { ok: false, error: 'Only HR can reopen attendance.' };
    var s = state();
    var p = s.periods.filter(function (p) { return p.id === s.activePeriodId; })[0];
    p.verified = false; p.verifiedAt = null; p.verifiedBy = null;
    var bank = s.timesheets[p.id] || (s.timesheets[p.id] = {});
    var ts = bank[empId] || { status: 'submitted', history: [] };
    if (ts.status !== 'approved') return { ok: false, error: 'That timesheet is not approved.' };
    ts.status = 'submitted';
    ts.reopenedAt = new Date().toISOString();
    bank[empId] = ts;
    save(s);
    log(empId, 'reopened', reason || '');
    return { ok: true, timesheet: ts };
  }

  // A correction writes the new value and records the old one. It never silently rewrites an
  // approved period: the timesheet drops back to `submitted` and payroll stops until re-approval.
  function correct(empId, date, patch, reason) {
    if (!HIS.rbac.can('attendance')) return { ok: false, error: 'Only HR can correct attendance.' };
    patch = patch || {};
    if (['timeIn', 'timeOut'].some(function (k) { return patch[k] != null && patch[k] !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch[k]); }) || ['otHours', 'ndHours'].some(function (k) { return patch[k] != null && (!isFinite(Number(patch[k])) || Number(patch[k]) < 0 || Number(patch[k]) > 24); })) return { ok: false, error: 'Enter valid clock times and hours between zero and 24.' };
    var periodForDate = periods().filter(function (p) { return date >= p.start && date <= p.end; })[0];
    if (periodForDate && isVerified(periodForDate.id)) return { ok: false, error: 'This cut-off is verified and locked. HR must reopen it before making corrections.' };
    var s = state();
    var rec = s.records.filter(function (r) { return r.empId === empId && r.date === date; })[0];
    if (!rec) return { ok: false, error: 'No attendance record for that employee and date.' };
    var before = {
      timeIn: rec.timeIn, timeOut: rec.timeOut, status: rec.status,
      otHours: rec.otHours, ndHours: rec.ndHours, dayType: rec.dayType
    };
    Object.keys(patch || {}).forEach(function (k) {
      if (['timeIn', 'timeOut', 'status', 'otHours', 'ndHours', 'dayType', 'note', 'leaveType', 'leaveApproved'].indexOf(k) > -1) rec[k] = patch[k];
    });
    rec.worked = !!rec.timeIn && !!rec.timeOut;
    if (rec.worked) {
      var late = Math.max(0, toMinutes(rec.timeIn) - toMinutes(rec.shiftStart));
      var under = Math.max(0, toMinutes(rec.shiftEnd) - toMinutes(rec.timeOut));
      if (toMinutes(rec.timeOut) < toMinutes(rec.timeIn)) under = 0;
      rec.lateMinutes = late; rec.undertimeMinutes = under;
      if (rec.status === 'present' || rec.status === 'late' || rec.status === 'undertime') rec.status = late > HIS.payrollCalc.CONFIG.graceMinutes ? 'late' : under > 0 ? 'undertime' : 'present';
    } else { rec.lateMinutes = 0; rec.undertimeMinutes = 0; }
    rec.history = rec.history || [];
    var a = HIS.auth && HIS.auth.account ? HIS.auth.account() : null;
    rec.history.push({
      at: new Date().toISOString(), by: a ? a.name : 'system',
      before: before, after: { timeIn: rec.timeIn, timeOut: rec.timeOut, status: rec.status, otHours: rec.otHours, ndHours: rec.ndHours, dayType: rec.dayType },
      reason: reason || ''
    });
    var p = s.periods.filter(function (p) { return date >= p.start && date <= p.end; })[0];
    if (!p) return { ok: false, error: 'The attendance date is outside a configured cut-off.' };
    var bank = s.timesheets[p.id] || (s.timesheets[p.id] = {});
    var ts = bank[empId] || { status: 'submitted', history: [] };
    var wasApproved = ts.status === 'approved';
    ts.status = 'submitted';
    ts.history = ts.history || [];
    ts.history.push({ at: new Date().toISOString(), by: a ? a.name : 'system', action: 'corrected', note: reason || '' });
    bank[empId] = ts;
    save(s);
    if (wasApproved && window.HIS.audit) {
      HIS.audit.append({
        who: a ? a.name : 'system', role: roleLabel(),
        what: 'Attendance corrected \u2014 ' + empId + ' on ' + date + (reason ? ' \u00b7 ' + reason : '') + '; timesheet reopened for approval',
        entity: 'timesheet:' + empId, before: before.status, after: rec.status
      });
    }
    return { ok: true, record: rec, reopened: wasApproved };
  }

  function roleLabel() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    if (!a || !window.HIS.rbac) return '\u2014';
    return (HIS.rbac.ROLES[a.role] || {}).label || a.role;
  }

  function totals() {
    var recs = all().filter(function (r) { return inPeriod(r); });
    return {
      records: recs.length,
      scheduledDays: recs.filter(function (r) { return r.dayType !== 'rest'; }).length,
      worked: recs.filter(function (r) { return r.worked; }).length,
      absent: recs.filter(function (r) { return r.status === 'absent'; }).length,
      leave: recs.filter(function (r) { return r.status === 'leave'; }).length,
      otHours: recs.reduce(function (t, r) { return t + (r.otHours || 0); }, 0),
      ndHours: recs.reduce(function (t, r) { return t + (r.ndHours || 0); }, 0),
      lateMinutes: recs.reduce(function (t, r) { return t + (r.lateMinutes || 0); }, 0),
      undertimeMinutes: recs.reduce(function (t, r) { return t + (r.undertimeMinutes || 0); }, 0)
    };
  }

  function reset() { HIS.store.remove(KEY); return state(); }

  // Step 1 -> 2 of the HR/Accounting hand-off. Verifying the cut-off is what locks the attendance
  // records and publishes the hours to payroll. Accounting cannot compute a period that has not been
  // verified, so nobody can pay hours that HR has not signed off.
  function verify(periodId, who) {
    if (!HIS.rbac.can('verifyAttendance')) return { ok: false, error: 'Only HR can verify and submit attendance.' };
    var s = state();
    var p = s.periods.filter(function (x) { return x.id === (periodId || s.activePeriodId); })[0];
    if (!p) return { ok: false, error: 'Pay period not found.' };
    if (p.verified) return { ok: true, already: true, period: p };
    var bank = s.timesheets[p.id] || {};
    if (HIS.employees.all().some(function (e) { return !bank[e.id] || bank[e.id].status !== 'approved'; })) return { ok: false, error: 'Approve all timesheets before verification.' };
    p.verified = true;
    p.verifiedAt = new Date().toISOString();
    p.verifiedBy = HIS.auth.account().name;
    HIS.store.set(KEY, s);
    return { ok: true, period: p };
  }
  function isVerified(periodId) {
    var s = state();
    var p = s.periods.filter(function (x) { return x.id === periodId; })[0];
    return !!(p && p.verified);
  }

  function reopenAll(reason) {
    if (!HIS.rbac.can('verifyAttendance')) return { ok: false, error: 'Only HR can reopen a cut-off.' };
    if (!String(reason || '').trim()) return { ok: false, error: 'Give a reason for reopening the cut-off.' };
    HIS.employees.all().forEach(function (e) { if (approved(e.id)) reopen(e.id, reason); });
    return { ok: true };
  }
  function applyLeave(empId, start, end, type, reason) {
    if (!HIS.rbac.can('attendance')) return { ok: false, error: 'Only HR can approve leave.' };
    var dates = all().filter(function (r) { return r.empId === empId && r.date >= start && r.date <= end; });
    if (dates.some(function (r) { var p = periods().filter(function (p) { return inPeriod(r, p); })[0]; return p && p.verified; })) return { ok: false, error: 'Reopen the affected cut-off before changing leave.' };
    for (var i = 0; i < dates.length; i++) {
      var res = correct(empId, dates[i].date, { timeIn: null, timeOut: null, status: 'leave', leaveType: type, leaveApproved: true, otHours: 0, ndHours: 0 }, reason);
      if (!res.ok) return res;
    }
    return { ok: true, days: dates.length };
  }

  HIS.attendancePeriod = {
    PERIOD: PERIOD, PERIODS: PERIODS, HOLIDAYS: HOLIDAYS, KEY: KEY,
    active: active, periods: periods, setPeriod: setPeriod,
    all: all, days: days, recordsFor: recordsFor, classify: classify,
    timesheet: timesheet, approved: approved, unapproved: unapproved, summary: summary,
    approve: approve, approveAll: approveAll, reopen: reopen, correct: correct,
    verify: verify, isVerified: isVerified, reopenAll: reopenAll, applyLeave: applyLeave,
    totals: totals, seed: seed, reset: reset
  };
  ["correct","approve","approveAll","reopen","verify","reopenAll","applyLeave"].forEach(function (name) {
    if (HIS.attendancePeriod[name]) HIS.attendancePeriod[name] = HIS.store.atomic(HIS.attendancePeriod[name]);
  });

})();
