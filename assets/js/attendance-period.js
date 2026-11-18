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
  var PERIOD = {
    id: '2026-08-16/31',
    label: 'Aug 16\u201331, 2026',
    start: '2026-08-16',
    end: '2026-08-31',
    payDate: '2026-08-31',
    frequency: 'semi-monthly'
  };

  var HOLIDAYS = {
    '2026-08-21': { type: 'special', name: 'Ninoy Aquino Day' },
    '2026-08-31': { type: 'regular', name: 'National Heroes Day' }
  };

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

  var KEY = HIS.store.KEY.attendancePeriod;
  var MIN = 60 * 1000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDay(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }

  function periodDays() {
    var out = [], d = parseDay(PERIOD.start), end = parseDay(PERIOD.end);
    while (d <= end) { out.push(iso(d)); d = addDays(d, 1); }
    return out;
  }

  function toMinutes(hhmm) {
    if (!hhmm) return null;
    var p = String(hhmm).split(':');
    return (+p[0]) * 60 + (+p[1]);
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
    var days = periodDays();
    var records = [];
    HIS.employees.all().forEach(function (emp) {
      var pattern = PATTERNS[emp.id] || '';
      days.forEach(function (date, i) {
        var code = pattern.charAt(i) || 'R';
        records.push(buildRecord(emp, date, code));
      });
    });
    var approvedAt = '2026-08-31T18:20:00+08:00';
    var timesheets = {};
    HIS.employees.all().forEach(function (emp) {
      timesheets[emp.id] = {
        status: 'approved', approvedBy: 'Carmela Dizon', approvedAt: approvedAt,
        submittedBy: 'Carmela Dizon', submittedAt: '2026-08-31T17:05:00+08:00',
        history: [{ at: approvedAt, by: 'Carmela Dizon', action: 'approved', note: 'Period timesheet reviewed against the daily register.' }]
      };
    });
    var state = { period: PERIOD, records: records, timesheets: timesheets, version: 1 };
    HIS.store.set(KEY, state);
    return state;
  }

  function state() {
    var s = HIS.store.get(KEY, null);
    if (!s || !Array.isArray(s.records)) s = seed();
    return s;
  }
  function save(s) { HIS.store.set(KEY, s); return s; }

  // ---- reads ---------------------------------------------------------------------------------
  function all() { return state().records; }
  function recordsFor(empId) {
    return all().filter(function (r) { return r.empId === empId; })
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }
  function timesheet(empId) {
    return state().timesheets[empId] || { status: 'submitted', history: [] };
  }
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
      if (r.dayType !== 'rest') s.scheduledDays++;
      if (r.worked) {
        s.workedDays++;
        var mins = toMinutes(r.timeOut) - toMinutes(r.timeIn);
        if (mins < 0) mins += 1440;              // night shift crossing midnight
        s.totalHours += Math.max(0, (mins - (r.breakMinutes || 0)) / 60);
      }
      if (r.status === 'absent') s.absenceDays++;
      if (r.status === 'leave' && r.leaveApproved) s.paidLeaveDays++;
      // Grace is a company policy, not a statutory rule: only lateness beyond it is docked.
      var chargeable = Math.max(0, (r.lateMinutes || 0) - HIS.payrollCalc.CONFIG.graceMinutes);
      s.lateMinutes += chargeable;
      s.undertimeMinutes += (r.undertimeMinutes || 0);
      s.ndHours += r.ndHours || 0;
      if (r.worked && r.otHours) {
        if (r.dayType === 'rest') s.otHours.rest += r.otHours;
        else if (r.dayType === 'regular-holiday') s.otHours.regularHoliday += r.otHours;
        else if (r.dayType === 'special') s.otHours.special += r.otHours;
        else s.otHours.ordinary += r.otHours;
      }
      if (r.worked) {
        if (r.dayType === 'rest') s.premiumDays.rest++;
        else if (r.dayType === 'regular-holiday') s.premiumDays.regularHoliday++;
        else if (r.dayType === 'special') s.premiumDays.special++;
      }
    });
    s.totalHours = Math.round(s.totalHours * 100) / 100;
    return s;
  }

  // ---- writes --------------------------------------------------------------------------------
  function log(empId, action, note) {
    var s = state();
    var ts = s.timesheets[empId] || { status: 'submitted', history: [] };
    ts.history = ts.history || [];
    var a = HIS.auth && HIS.auth.account ? HIS.auth.account() : null;
    ts.history.push({ at: new Date().toISOString(), by: a ? a.name : 'system', action: action, note: note || '' });
    s.timesheets[empId] = ts;
    save(s);
    return ts;
  }

  function approve(empId, note) {
    var s = state();
    var ts = s.timesheets[empId] || { status: 'submitted', history: [] };
    if (ts.status === 'approved') return { ok: false, error: 'That timesheet is already approved.' };
    var a = HIS.auth && HIS.auth.account ? HIS.auth.account() : null;
    ts.status = 'approved';
    ts.approvedBy = a ? a.name : 'system';
    ts.approvedAt = new Date().toISOString();
    s.timesheets[empId] = ts;
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
    var s = state();
    var ts = s.timesheets[empId] || { status: 'submitted', history: [] };
    if (ts.status !== 'approved') return { ok: false, error: 'That timesheet is not approved.' };
    ts.status = 'submitted';
    ts.reopenedAt = new Date().toISOString();
    s.timesheets[empId] = ts;
    save(s);
    log(empId, 'reopened', reason || '');
    return { ok: true, timesheet: ts };
  }

  // A correction writes the new value and records the old one. It never silently rewrites an
  // approved period: the timesheet drops back to `submitted` and payroll stops until re-approval.
  function correct(empId, date, patch, reason) {
    var s = state();
    var rec = s.records.filter(function (r) { return r.empId === empId && r.date === date; })[0];
    if (!rec) return { ok: false, error: 'No attendance record for that employee and date.' };
    var before = {
      timeIn: rec.timeIn, timeOut: rec.timeOut, status: rec.status,
      otHours: rec.otHours, ndHours: rec.ndHours, dayType: rec.dayType
    };
    Object.keys(patch || {}).forEach(function (k) {
      if (['timeIn', 'timeOut', 'status', 'otHours', 'ndHours', 'dayType', 'note'].indexOf(k) > -1) rec[k] = patch[k];
    });
    rec.worked = !!rec.timeIn && !!rec.timeOut;
    if (rec.worked) {
      var late = Math.max(0, toMinutes(rec.timeIn) - toMinutes(rec.shiftStart));
      var under = Math.max(0, toMinutes(rec.shiftEnd) - toMinutes(rec.timeOut));
      if (toMinutes(rec.timeOut) < toMinutes(rec.timeIn)) under = 0;
      rec.lateMinutes = late; rec.undertimeMinutes = under;
    } else { rec.lateMinutes = 0; rec.undertimeMinutes = 0; }
    rec.history = rec.history || [];
    var a = HIS.auth && HIS.auth.account ? HIS.auth.account() : null;
    rec.history.push({
      at: new Date().toISOString(), by: a ? a.name : 'system',
      before: before, after: { timeIn: rec.timeIn, timeOut: rec.timeOut, status: rec.status, otHours: rec.otHours, ndHours: rec.ndHours, dayType: rec.dayType },
      reason: reason || ''
    });
    var ts = s.timesheets[empId] || { status: 'submitted', history: [] };
    var wasApproved = ts.status === 'approved';
    ts.status = 'submitted';
    ts.history = ts.history || [];
    ts.history.push({ at: new Date().toISOString(), by: a ? a.name : 'system', action: 'corrected', note: reason || '' });
    s.timesheets[empId] = ts;
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
    var recs = all();
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

  HIS.attendancePeriod = {
    PERIOD: PERIOD, HOLIDAYS: HOLIDAYS, KEY: KEY,
    all: all, days: days, recordsFor: recordsFor,
    timesheet: timesheet, approved: approved, unapproved: unapproved, summary: summary,
    approve: approve, approveAll: approveAll, reopen: reopen, correct: correct,
    totals: totals, seed: seed, reset: reset
  };
})();
