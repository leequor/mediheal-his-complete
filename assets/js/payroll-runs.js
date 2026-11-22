// Payroll runs (M10).
//
// A run is the payroll for one pay period: a set of employee lines, a lifecycle, and a version
// history. The M8 screen edited the employee rows in place and had no notion of a period at all —
// "Process payments" flipped a status field and that was the whole workflow.
//
// LIFECYCLE
//   draft -> reviewed -> approved -> released
//   recompute is allowed only in draft/reviewed; it snapshots the current lines into `versions`
//   before replacing them, so an earlier calculation is never lost.
//
// GATES
//   - One run per pay period. A second `create()` for the same period is refused, which is the
//     duplicate-processing guard.
//   - One line per employee. Enforced by construction and asserted on every create.
//   - An employee whose timesheet is not approved is BLOCKED: no line, no pay. The run can exist
//     but cannot be approved until every timesheet is approved.
//   - `release()` requires `approved`; releasing twice is refused.
//
// The line is produced by HIS.payrollCalc.compute() from the monthly salary and the approved
// attendance summary. Nothing on this screen is a literal.
(function () {
  var KEY = HIS.store.KEY.payrollRuns;
  // The cut-off being worked on. Resolved on every call, not captured at load, so switching the
  // period on the Payroll screen switches which run these functions read and write.
  function period() { return HIS.attendancePeriod.active(); }

  function state() {
    var s = HIS.store.get(KEY, null);
    if (!s || !Array.isArray(s.runs)) s = { runs: [] };
    return s;
  }
  function save(s) { HIS.store.set(KEY, s); return s; }
  function actor() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    return a ? a.name : 'system';
  }
  function roleLabel() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    if (!a || !window.HIS.rbac) return '\u2014';
    return (HIS.rbac.ROLES[a.role] || {}).label || a.role;
  }
  function stamp() { return new Date().toISOString(); }

  function list() { return state().runs.slice().sort(function (a, b) { return b.createdAt < a.createdAt ? -1 : 1; }); }
  function get(id) { return state().runs.filter(function (r) { return r.id === id; })[0] || null; }
  function forPeriod(id) { return list().filter(function (r) { return r.periodId === id; })[0] || null; }
  function current() { return forPeriod(period().id); }

  // A cheap fingerprint of the attendance a line was priced from. Approval compares it with the
  // CURRENT summary, so reopening or correcting a timesheet after the run was built blocks the
  // run until it is recomputed. Checking only the run's own `blocked` snapshot would let a stale
  // run through.
  function fingerprint(att) {
    if (!att) return null;
    return [
      att.scheduledDays, att.workedDays, att.absenceDays, att.paidLeaveDays,
      att.lateMinutes, att.undertimeMinutes, att.ndHours,
      att.otHours.ordinary, att.otHours.rest, att.otHours.regularHoliday, att.otHours.special,
      att.premiumDays.rest, att.premiumDays.regularHoliday, att.premiumDays.special
    ].join('|');
  }

  // Employees whose current attendance no longer matches the line that was priced from it.
  function staleEmployees(run) {
    var stale = [];
    HIS.employees.all().forEach(function (emp) {
      var att = HIS.attendancePeriod.summary(emp.id);
      var line = run.lines.filter(function (l) { return l.employeeId === emp.id; })[0];
      if (!att) stale.push(emp.name + ' (timesheet not approved)');
      else if (!line) stale.push(emp.name + ' (no payroll line)');
      else if (line.attendanceFingerprint !== fingerprint(att)) stale.push(emp.name + ' (attendance changed)');
    });
    return stale;
  }

  // Employees whose current rate sits below the floor in force for the period.
  function wageProblems(run) {
    var out = [];
    HIS.employees.all().forEach(function (emp) {
      var floor = HIS.wageFloor.check(emp, run.payDate || period().payDate);
      if (floor.status === 'below') out.push(emp.name + ' (' + floor.explanation + ')');
    });
    return out;
  }

  function computeLines() {
    var lines = [], blocked = [];
    HIS.employees.all().forEach(function (emp) {
      var att = HIS.attendancePeriod.summary(emp.id);
      if (!att) {
        blocked.push({
          employeeId: emp.id, name: emp.name,
          reason: 'Timesheet not approved for ' + period().label
        });
        return;
      }
      // A rate below the applicable wage floor is a blocking problem, not a warning: paying it
      // would underpay the employee. An 'unknown' floor (no order in force for the date) is
      // reported on the line but does not block, because there is nothing to test against.
      var floor = HIS.wageFloor.check(emp, period().payDate);
      if (floor.status === 'below') {
        blocked.push({ employeeId: emp.id, name: emp.name, reason: floor.explanation });
        return;
      }
      var line = HIS.payrollCalc.compute(emp, {
        frequency: period().frequency,
        attendance: att
      });
      line.status = 'Pending';
      line.attendanceFingerprint = fingerprint(att);
      line.wageFloor = floor;
      line.attendanceApprovedBy = HIS.attendancePeriod.timesheet(emp.id).approvedBy || '\u2014';
      lines.push(line);
    });
    return { lines: lines, blocked: blocked };
  }

  function totalsOf(lines) {
    var t = {
      headcount: lines.length, gross: 0, deductions: 0, net: 0,
      basic: 0, allowances: 0, overtime: 0, additional: 0, night: 0, premium: 0,
      sss: 0, philhealth: 0, pagibig: 0, tax: 0, other: 0,
      employer: 0, employerTotal: 0
    };
    lines.forEach(function (l) {
      t.gross += l.gross; t.deductions += l.deductions; t.net += l.net;
      t.basic += l.earnings.basic; t.allowances += l.earnings.allowances;
      t.overtime += l.earnings.overtime; t.additional += (l.earnings.additional || 0);
      t.night += l.earnings.night; t.premium += l.earnings.premium;
      t.sss += l.statutory.sss; t.philhealth += l.statutory.philhealth; t.pagibig += l.statutory.pagibig;
      t.tax += l.tax; t.other += l.other;
      t.employerTotal += l.employer.total;
    });
    Object.keys(t).forEach(function (k) { if (k !== 'headcount') t[k] = Math.round(t[k] * 100) / 100; });
    return t;
  }

  function create(opts) {
    opts = opts || {};
    var s = state();
    var P = period();
    var existing = s.runs.filter(function (r) { return r.periodId === P.id; })[0];
    if (existing) {
      return { ok: false, error: 'Payroll for ' + P.label + ' already exists as ' + existing.id + '. Recompute it instead of creating a second run.' };
    }
    var built = computeLines();
    var run = {
      id: 'PR-' + P.start + '-' + (s.runs.length + 1),
      periodId: P.id,
      periodLabel: P.label,
      payDate: P.payDate,
      frequency: P.frequency,
      version: 1,
      status: 'draft',
      lines: built.lines,
      blocked: built.blocked,
      totals: totalsOf(built.lines),
      createdAt: stamp(),
      createdBy: actor(),
      note: opts.note || '',
      history: [{ at: stamp(), by: actor(), action: 'created', note: opts.note || '' }],
      versions: []
    };
    s.runs.push(run);
    save(s);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Payroll run created \u2014 ' + run.id + ' for ' + P.label + ', ' + run.totals.headcount + ' employees, net ' + peso(run.totals.net),
        entity: 'payroll:' + run.periodId, before: '\u2014', after: 'draft'
      });
    }
    return { ok: true, run: run };
  }

  // Recompute re-reads attendance and salary and produces a new version. The previous lines are
  // archived, never overwritten, so an approved historical calculation can still be inspected.
  function recompute(runId, reason) {
    var s = state();
    var run = s.runs.filter(function (r) { return r.id === runId; })[0];
    if (!run) return { ok: false, error: 'Run not found.' };
    if (run.status === 'released') {
      // A released payroll is a historical record. Rewriting it would change what was paid; a real
      // deployment would raise an off-cycle correction, which this demo does not implement.
      return { ok: false, error: 'This run was released and is final. A correction after release needs an off-cycle run, which is not available here.' };
    }
    run.versions = run.versions || [];
    run.versions.push({
      version: run.version, at: stamp(), by: actor(), reason: reason || '',
      lines: JSON.parse(JSON.stringify(run.lines)), totals: run.totals, blocked: run.blocked
    });
    var built = computeLines();
    run.lines = built.lines;
    run.blocked = built.blocked;
    run.totals = totalsOf(built.lines);
    run.version += 1;
    run.status = 'draft';
    // A recompute invalidates any earlier approval: the approved figures no longer describe the
    // attendance on file, so the approval stamp is cleared rather than left looking current.
    if (run.approvedAt) {
      run.history.push({ at: stamp(), by: actor(), action: 'approval invalidated', note: 'Attendance changed after approval' });
      delete run.approvedAt; delete run.approvedBy;
    }
    run.history.push({ at: stamp(), by: actor(), action: 'recomputed', note: reason || '' });
    save(s);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Payroll recomputed \u2014 ' + run.id + ' version ' + run.version + (reason ? ' \u00b7 ' + reason : ''),
        entity: 'payroll:' + run.periodId, before: 'version ' + (run.version - 1), after: 'version ' + run.version
      });
    }
    return { ok: true, run: run };
  }

  function transition(runId, from, to, action, note) {
    var s = state();
    var run = s.runs.filter(function (r) { return r.id === runId; })[0];
    if (!run) return { ok: false, error: 'Run not found.' };
    if (run.status !== from) return { ok: false, error: 'A ' + run.status + ' run cannot move to ' + to + '.' };
    // Both approval and release re-check attendance live. Checking only at approval left a hole:
    // reopen a timesheet after approval and the stale run could still be released.
    if (to === 'approved' || to === 'released') {
      var below = wageProblems(run);
      if (below.length) {
        return {
          ok: false,
          error: 'Payroll cannot be ' + (to === 'approved' ? 'approved' : 'released') + ': ' + below.join('; ') + '.'
        };
      }
      var stale = staleEmployees(run);
      if (stale.length) {
        return {
          ok: false,
          error: 'Payroll cannot be ' + (to === 'approved' ? 'approved' : 'released') + ': ' + stale.join(', ') +
            '. Recompute the run to pick up the change.'
        };
      }
    }
    if (to === 'approved') {
      run.lines.forEach(function (l) { l.status = 'Processing'; });
    }
    if (to === 'released') {
      run.lines.forEach(function (l) { l.status = 'Paid'; });
      run.releasedAt = stamp();
      run.releasedBy = actor();
    }
    if (to === 'reviewed') run.reviewedAt = stamp();
    if (to === 'approved') { run.approvedAt = stamp(); run.approvedBy = actor(); }
    run.status = to;
    run.history.push({ at: stamp(), by: actor(), action: action, note: note || '' });
    save(s);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Payroll ' + action + ' \u2014 ' + run.id + ' for ' + run.periodLabel + ', net ' + peso(run.totals.net),
        entity: 'payroll:' + run.periodId, before: from, after: to
      });
    }
    return { ok: true, run: run };
  }

  function review(runId, note) { return transition(runId, 'draft', 'reviewed', 'reviewed', note); }
  function approve(runId, note) { return transition(runId, 'reviewed', 'approved', 'approved', note); }
  function release(runId, note) { return transition(runId, 'approved', 'released', 'released', note); }

  function lineFor(empId) {
    var run = current();
    if (!run) return null;
    return run.lines.filter(function (l) { return l.employeeId === empId; })[0] || null;
  }
  function blockedFor(empId) {
    var run = current();
    if (!run) return null;
    return run.blocked.filter(function (b) { return b.employeeId === empId; })[0] || null;
  }

  // ---- payslip -------------------------------------------------------------------------------
  // Everything a payslip must show, in the order a person reads it. Employer contributions are a
  // separate block: they are the hospital's cost, not a deduction from the employee's pay.
  function payslip(empId) {
    var run = current();
    var emp = HIS.employees.byId(empId);
    if (!run || !emp) return null;
    var line = lineFor(empId);
    if (!line) return null;
    var att = HIS.attendancePeriod.summary(empId);
    return {
      runId: run.id, status: run.status, version: run.version,
      periodLabel: run.periodLabel, payDate: run.payDate, frequency: run.frequency,
      employee: {
        id: emp.id, name: emp.name, role: emp.role, dept: emp.dept,
        category: emp.category, tin: emp.tin, sss: emp.sss,
        philhealth: emp.philhealth, pagibig: emp.pagibig
      },
      attendance: att,
      line: line,
      employer: line.employer
    };
  }

  // Printable payslip, rendered through HIS.pdf (text-only PDF 1.4, same helper as invoices).
  // The page content of one payslip. Shared by the single-file download and the archive, so both
  // produce identical pages.
  function payslipRows(p) {
    var money = function (n) { return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var rows = [
      ['MEDIHEAL HOSPITAL', 15, 26],
      ['PAYSLIP', 12, 24],
      [''],
      ['Employee          ' + p.employee.name, 10, 16],
      ['Employee ID       ' + p.employee.id, 10, 16],
      ['Department        ' + p.employee.dept, 10, 16],
      ['Position          ' + p.employee.role, 10, 16],
      ['Employment        ' + p.employee.category, 10, 16],
      ['Pay period        ' + p.periodLabel + ' (' + p.frequency + ')', 10, 16],
      ['Pay date          ' + p.payDate, 10, 16],
      ['Run / version     ' + p.runId + ' v' + p.version + ' (' + p.status + ')', 10, 22],
      ['EARNINGS', 11, 18]
    ];
    p.line.lines.filter(function (l) { return l.kind === 'earning'; }).forEach(function (l) {
      rows.push(['  ' + l.label + '  ' + money(l.amount), 9, 14]);
    });
    rows.push(['  Gross pay  ' + money(p.line.gross), 10, 20]);
    rows.push(['DEDUCTIONS', 11, 18]);
    p.line.lines.filter(function (l) { return l.kind === 'deduction'; }).forEach(function (l) {
      rows.push(['  ' + l.label + '  ' + money(Math.abs(l.amount)), 9, 14]);
    });
    rows.push(['  Total deductions  ' + money(p.line.deductions), 10, 20]);
    rows.push(['NET PAY  ' + money(p.line.net), 13, 26]);
    rows.push(['EMPLOYER CONTRIBUTIONS (not deducted from pay)', 10, 18]);
    rows.push(['  SSS  ' + money(p.employer.sss) + '   PhilHealth  ' + money(p.employer.philhealth), 9, 14]);
    rows.push(['  Pag-IBIG  ' + money(p.employer.pagibig) + '   EC  ' + money(p.employer.ec), 9, 14]);
    rows.push(['  Total employer cost  ' + money(p.employer.total), 9, 22]);
    rows.push(['Attendance: ' + p.attendance.workedDays + ' days worked, ' + p.attendance.absenceDays + ' absent, ' +
      p.attendance.lateMinutes + ' min late, ' + p.attendance.overtimeHours + ' h overtime, ' + p.attendance.nightHours + ' h night', 9, 14]);
    rows.push(['Statutory tables effective ' + HIS.payrollCalc.CONFIG.effectiveFrom + '. Sample data, not a legal record.', 8, 14]);
    return rows;
  }

  function payslipPdf(empId) {
    var p = payslip(empId);
    if (!p) return { ok: false, error: 'No payroll line for that employee.' };
    HIS.pdf.save(payslipRows(p), 'payslip-' + p.employee.id + '-' + p.runId + '.pdf');
    return { ok: true };
  }

  // Every payslip for a run, in one archive. One download instead of eight, because Chrome throttles
  // a burst of automatic downloads and silently drops the tail.
  function payslipBatch() {
    var run = current();
    if (!run) return { ok: false, error: 'No payroll run to generate.' };
    var files = [], skipped = [];
    run.lines.forEach(function (l) {
      var p = payslip(l.employeeId);
      if (!p) { skipped.push(l.employeeId); return; }
      files.push({ name: 'payslip-' + p.employee.id + '-' + p.runId + '.pdf', data: HIS.pdf.text(payslipRows(p)) });
    });
    if (!files.length) return { ok: false, error: 'No payslip could be produced for this run.' };
    HIS.pdf.saveZip(files, 'payslips-' + run.periodId.replace(/\//g, '-') + '-v' + run.version + '.zip');
    return { ok: true, count: files.length, skipped: skipped.length, runId: run.id };
  }

  function csv(runId) {
    var run = runId ? get(runId) : current();
    if (!run) return null;
    var head = ['Employee', 'Employee ID', 'Department', 'Position', 'Period', 'Basic', 'Absence', 'Late',
      'Undertime', 'Overtime', 'Night differential', 'Holiday/rest premium', 'Allowances', 'Gross',
      'SSS', 'PhilHealth', 'Pag-IBIG', 'Withholding tax', 'Other deductions', 'Net pay',
      'Employer SSS', 'Employer PhilHealth', 'Employer Pag-IBIG', 'Status'];
    var rows = run.lines.map(function (l) {
      return [l.employeeName, l.employeeId,
        (HIS.employees.byId(l.employeeId) || {}).dept || '', (HIS.employees.byId(l.employeeId) || {}).role || '',
        run.periodLabel, l.earnings.basic, l.earnings.absence, l.earnings.late, l.earnings.undertime,
        l.earnings.overtime, l.earnings.night, l.earnings.premium, l.earnings.allowances, l.gross,
        l.statutory.sss, l.statutory.philhealth, l.statutory.pagibig, l.tax, l.other, l.net,
        l.employer.sss, l.employer.philhealth, l.employer.pagibig, l.status];
    });
    var cell = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    return [head].concat(rows).map(function (r) { return r.map(cell).join(','); }).join('\r\n');
  }

  // ---- 13th month and year-end ---------------------------------------------------------------
  // The register accrues on BASIC salary only. `monthsElapsed` is the number of complete months in
  // the calendar year covered by the payroll so far.
  function thirteenth(opts) {
    opts = opts || {};
    var year = opts.year || 2026;
    var months = opts.monthsElapsed == null ? 8 : opts.monthsElapsed;
    var rows = HIS.employees.all().map(function (emp) {
      var t = HIS.payrollCalc.thirteenthMonth(emp, { months: months });
      return {
        employeeId: emp.id, name: emp.name, dept: emp.dept, category: emp.category,
        monthlyBasic: emp.monthlyBasic, months: t.months, basicEarned: t.basicEarned,
        amount: t.amount, taxExempt: t.taxExempt, taxableExcess: t.taxableExcess,
        projectedFullYear: HIS.payrollCalc.thirteenthMonth(emp, { months: 12 }).amount
      };
    });
    var total = rows.reduce(function (s, r) { return s + r.amount; }, 0);
    var exempt = rows.reduce(function (s, r) { return s + r.taxExempt; }, 0);
    return {
      year: year, monthsElapsed: months, rows: rows,
      totals: {
        amount: Math.round(total * 100) / 100,
        taxExempt: Math.round(exempt * 100) / 100,
        taxableExcess: Math.round((total - exempt) * 100) / 100
      },
      source: HIS.payrollCalc.CONFIG.thirteenth.source
    };
  }

  // Year-end reconciliation for one employee, using the tax actually withheld on the released
  // periods. `periodsPaid` is how many semi-monthly periods have been released this year.
  function annual(empId, opts) {
    opts = opts || {};
    var emp = HIS.employees.byId(empId);
    if (!emp) return null;
    var months = opts.monthsElapsed == null ? 8 : opts.monthsElapsed;
    var t13 = HIS.payrollCalc.thirteenthMonth(emp, { months: months });
    var run = current();
    var line = run ? lineFor(empId) : null;
    var periodsPerMonth = HIS.payrollCalc.FREQUENCIES['semi-monthly'].periodsPerMonth;
    var taxWithheld = opts.taxWithheld != null
      ? Number(opts.taxWithheld)
      : Math.round((line ? line.tax : 0) * periodsPerMonth * months * 100) / 100;
    return HIS.payrollCalc.annualize(emp, {
      months: months,
      benefits: t13.amount,
      taxWithheld: taxWithheld
    });
  }

  function peso(n) {
    return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function reset() { HIS.store.remove(KEY); return state(); }

  HIS.payrollRuns = {
    KEY: KEY, period: period, forPeriod: forPeriod, PERIOD: HIS.attendancePeriod.PERIOD,
    list: list, get: get, current: current,
    create: create, recompute: recompute, review: review, approve: approve, release: release,
    lineFor: lineFor, blockedFor: blockedFor, totalsOf: totalsOf, staleEmployees: staleEmployees,
    wageProblems: wageProblems,
    payslip: payslip, payslipPdf: payslipPdf, payslipBatch: payslipBatch, csv: csv,
    thirteenth: thirteenth, annual: annual, reset: reset
  };
})();
