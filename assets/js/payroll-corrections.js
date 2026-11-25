// Off-cycle payroll corrections (M10.1).
//
// WHY THIS EXISTS
// A released payroll is a historical record: it says what was paid, and rewriting it would make the
// record lie. M10 had no way to correct one at all — `recompute()` refused a released run and the
// error pointed at a "correction run" that did not exist.
//
// THE MODEL
//   1. pick the released run
//   2. give a reason
//   3. choose the affected employees (default: everyone in the run)
//   4. recompute each from the CURRENT approved attendance and salary
//   5. difference = corrected entitlement - original net - corrections already released for the
//      same employee and run
//   6. a new run linked to the original by `originalRunId`; the original is never touched
//   7. review -> approve -> release, each audited
//   8. an adjustment statement per employee
//
// UNDERPAYMENT is payable: the difference is owed to the employee and is recorded as such.
// OVERPAYMENT is a receivable. It is NOT deducted automatically: `release()` records the amount
// owed and leaves `recovery.status = 'unrecorded'`. Converting it into a deduction requires
// `authorizeRecovery()` with a written reference, and even then this demo only marks it
// `authorized-pending-deduction` — there is no future run to deduct from.
//
// DUPLICATES. A correction is fingerprinted from the original run, the per-employee differences and
// the reason. Releasing the same correction twice, or creating it twice from the same state, is
// refused.
(function () {
  var KEY = HIS.store.KEY.payrollCorrections;

  function state() {
    var s = HIS.store.get(KEY, null);
    if (!s || !Array.isArray(s.corrections)) s = { corrections: [], version: 1 };
    return s;
  }
  function save(s) { HIS.store.set(KEY, s); return s; }
  function all() { return state().corrections.slice(); }
  function get(id) { return state().corrections.filter(function (c) { return c.id === id; })[0] || null; }
  function list() { return all().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; }); }

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
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  function nextId() {
    var max = all().reduce(function (m, c) {
      var v = parseInt(String(c.id).split('-').pop(), 10);
      return isNaN(v) ? m : Math.max(m, v);
    }, 0);
    return 'CR-' + String(max + 1).padStart(4, '0');
  }

  // What has already been corrected for this employee on this run, so a second correction pays the
  // increment only rather than the whole difference again.
  function alreadyCorrected(originalRunId, employeeId) {
    return all().filter(function (c) {
      return c.originalRunId === originalRunId && c.status === 'released';
    }).reduce(function (total, c) {
      var line = c.lines.filter(function (l) { return l.employeeId === employeeId; })[0];
      return total + (line ? line.difference : 0);
    }, 0);
  }

  function fingerprint(originalRunId, lines, reason) {
    var body = lines.map(function (l) { return l.employeeId + ':' + l.difference.toFixed(2); })
      .sort().join('|');
    return [originalRunId, body, String(reason || '').trim().toLowerCase()].join('#');
  }

  function create(input) {
    input = input || {};
    var role = HIS.rbac ? HIS.rbac.key() : null;
    if (['accounting', 'superadmin'].indexOf(role) < 0) {
      return { ok: false, error: 'Your role cannot raise a payroll correction.' };
    }
    var original = HIS.payrollRuns.get(input.originalRunId);
    if (!original) return { ok: false, error: 'Choose the released payroll to correct.' };
    if (original.status !== 'released') {
      return { ok: false, error: 'Only a released payroll can be corrected. This run is ' + original.status + '.' };
    }
    var reason = String(input.reason || '').trim();
    if (reason.length < 8) return { ok: false, error: 'Record why the correction is needed (at least 8 characters).' };

    var wanted = Array.isArray(input.employeeIds) && input.employeeIds.length
      ? input.employeeIds
      : original.lines.map(function (l) { return l.employeeId; });

    var lines = [], skipped = [];
    wanted.forEach(function (id) {
      var originalLine = original.lines.filter(function (l) { return l.employeeId === id; })[0];
      var emp = HIS.employees.byId(id);
      if (!originalLine || !emp) { skipped.push({ employeeId: id, reason: 'Not in the original run.' }); return; }
      var att = HIS.attendancePeriod.summary(id);
      if (!att) { skipped.push({ employeeId: id, reason: 'Timesheet not approved.' }); return; }

      var corrected = HIS.payrollCalc.compute(emp, {
        frequency: original.frequency,
        attendance: att
      });
      var prior = alreadyCorrected(original.id, id);
      var difference = r2(corrected.net - originalLine.net - prior);
      if (Math.abs(difference) < 0.005) { skipped.push({ employeeId: id, reason: 'No difference.' }); return; }

      lines.push({
        employeeId: id, employeeName: emp.name, dept: emp.dept,
        originalNet: originalLine.net,
        correctedNet: corrected.net,
        alreadyCorrected: r2(prior),
        difference: difference,
        kind: difference > 0 ? 'underpayment' : 'overpayment',
        payable: difference > 0 ? difference : 0,
        receivable: difference < 0 ? r2(-difference) : 0,
        recovery: difference < 0
          ? { status: 'unrecorded', authorized: false, reference: '', method: '', at: null, by: '' }
          : null,
        components: {
          basic: r2(corrected.earnings.basic - originalLine.earnings.basic),
          overtime: r2(corrected.earnings.overtime - originalLine.earnings.overtime),
          night: r2(corrected.earnings.night - originalLine.earnings.night),
          premium: r2(corrected.earnings.premium - originalLine.earnings.premium),
          allowances: r2(corrected.earnings.allowances - originalLine.earnings.allowances),
          sss: r2(corrected.statutory.sss - originalLine.statutory.sss),
          philhealth: r2(corrected.statutory.philhealth - originalLine.statutory.philhealth),
          pagibig: r2(corrected.statutory.pagibig - originalLine.statutory.pagibig),
          tax: r2(corrected.tax - originalLine.tax)
        },
        attendance: {
          absenceDays: att.absenceDays, lateMinutes: att.lateMinutes,
          overtimeHours: r2(att.otHours.ordinary + att.otHours.rest + att.otHours.regularHoliday + att.otHours.special),
          nightHours: att.ndHours
        }
      });
    });

    if (!lines.length) {
      return { ok: false, error: 'Nothing to correct: no affected employee has a difference.' + (skipped.length ? ' ' + skipped.map(function (s) { return s.employeeId + ' (' + s.reason + ')'; }).join(', ') : '') };
    }

    var fp = fingerprint(original.id, lines, reason);
    var dup = all().filter(function (c) { return c.fingerprint === fp && c.status !== 'cancelled'; })[0];
    if (dup) {
      return { ok: false, error: 'An identical correction already exists (' + dup.id + ', ' + dup.status + '). Change the reason or the affected employees.' };
    }

    var payable = lines.reduce(function (t, l) { return t + l.payable; }, 0);
    var receivable = lines.reduce(function (t, l) { return t + l.receivable; }, 0);
    var correction = {
      id: nextId(),
      originalRunId: original.id,
      originalVersion: original.version,
      periodId: original.periodId,
      periodLabel: original.periodLabel,
      frequency: original.frequency,
      reason: reason,
      status: 'draft',
      lines: lines,
      skipped: skipped,
      totals: {
        employees: lines.length,
        underpayment: r2(payable),
        overpayment: r2(receivable),
        net: r2(payable - receivable)
      },
      fingerprint: fp,
      createdAt: stamp(),
      createdBy: actor(),
      history: [{ at: stamp(), by: actor(), role: roleLabel(), action: 'created', note: reason }]
    };
    var s = state();
    s.corrections.push(correction);
    save(s);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Correction run created \u2014 ' + correction.id + ' against ' + original.id +
          ', ' + lines.length + ' employee(s), net ' + peso(correction.totals.net) + ' \u00b7 ' + reason,
        entity: 'payroll:' + original.periodId, before: '\u2014', after: 'draft'
      });
    }
    return { ok: true, correction: correction };
  }

  function transition(id, from, to, action, note) {
    var s = state();
    var c = s.corrections.filter(function (x) { return x.id === id; })[0];
    if (!c) return { ok: false, error: 'Correction not found.' };
    if (c.status !== from) return { ok: false, error: 'A ' + c.status + ' correction cannot move to ' + to + '.' };
    var role = HIS.rbac ? HIS.rbac.key() : null;
    if (['accounting', 'superadmin'].indexOf(role) < 0) {
      return { ok: false, error: 'Your role cannot ' + action + ' a correction.' };
    }
    if (to === 'released') {
      // An overpayment is never recovered automatically: it is recorded as a receivable until a
      // recovery is authorised with a reference.
      c.lines.forEach(function (l) {
        if (l.kind === 'overpayment' && !l.recovery.authorized) {
          l.recovery.status = 'unrecorded';
        }
      });
      c.releasedAt = stamp();
      c.releasedBy = actor();
    }
    c.status = to;
    c.history.push({ at: stamp(), by: actor(), role: roleLabel(), action: action, note: note || '' });
    save(s);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Correction ' + c.id + ' ' + action + ' \u2014 against ' + c.originalRunId + ', net ' + peso(c.totals.net),
        entity: 'payroll:' + c.periodId, before: from, after: to
      });
    }
    return { ok: true, correction: c };
  }

  function review(id, note) { return transition(id, 'draft', 'reviewed', 'reviewed', note); }
  function approve(id, note) { return transition(id, 'reviewed', 'approved', 'approved', note); }
  function release(id, note) { return transition(id, 'approved', 'released', 'released', note); }

  // Authorise recovering an overpayment. Does not deduct: it records the authorisation and leaves
  // the line `authorized-pending-deduction` for a future run to act on.
  function authorizeRecovery(id, employeeId, input) {
    if (!HIS.rbac.can('payroll')) return { ok: false, error: 'Only Accounting can authorize a recovery.' };
    input = input || {};
    var s = state();
    var c = s.corrections.filter(function (x) { return x.id === id; })[0];
    if (!c) return { ok: false, error: 'Correction not found.' };
    if (c.status === 'released') return { ok: false, error: 'This correction is already released.' };
    var line = c.lines.filter(function (l) { return l.employeeId === employeeId; })[0];
    if (!line || line.kind !== 'overpayment') return { ok: false, error: 'That employee has no overpayment to recover.' };
    if (!String(input.reference || '').trim()) {
      return { ok: false, error: 'Recovering an overpayment needs a written authorisation reference.' };
    }
    line.recovery = {
      status: 'authorized-pending-deduction', authorized: true,
      reference: String(input.reference).trim(),
      method: input.method || 'payroll-deduction',
      at: stamp(), by: actor()
    };
    c.history.push({ at: stamp(), by: actor(), role: roleLabel(), action: 'recovery authorised', note: line.employeeId + ' \u00b7 ' + line.recovery.reference });
    save(s);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Overpayment recovery authorised \u2014 ' + line.employeeId + ' ' + peso(line.receivable) + ' on ' + c.id + ' (' + line.recovery.reference + ')',
        entity: 'payroll:' + c.periodId, before: 'unrecorded', after: line.recovery.status
      });
    }
    return { ok: true, correction: c, line: line };
  }

  function statement(id) {
    var c = get(id);
    if (!c) return null;
    var original = HIS.payrollRuns.get(c.originalRunId);
    return {
      id: c.id, status: c.status, reason: c.reason, periodLabel: c.periodLabel,
      originalRunId: c.originalRunId, originalVersion: c.originalVersion,
      originalReleasedAt: original ? original.releasedAt : null,
      lines: c.lines, totals: c.totals, history: c.history
    };
  }

  function statementPdf(id) {
    var c = get(id);
    if (!c) return { ok: false, error: 'Correction not found.' };
    var money = function (n) { return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var rows = [
      ['MEDIHEAL HOSPITAL', 15, 26],
      ['PAYROLL CORRECTION STATEMENT', 12, 22],
      [''],
      ['Correction         ' + c.id, 10, 16],
      ['Original payroll   ' + c.originalRunId + ' v' + c.originalVersion, 10, 16],
      ['Pay period         ' + c.periodLabel, 10, 16],
      ['Reason             ' + c.reason, 9, 16],
      ['Status             ' + c.status, 10, 22],
      ['EMPLOYEE ADJUSTMENTS', 11, 18]
    ];
    c.lines.forEach(function (l) {
      rows.push(['  ' + l.employeeName + ' (' + l.employeeId + ')', 9, 14]);
      rows.push(['    Original net ' + money(l.originalNet) + '   Corrected net ' + money(l.correctedNet), 9, 14]);
      rows.push(['    ' + (l.kind === 'underpayment' ? 'Underpayment payable ' : 'Overpayment receivable ') + money(Math.abs(l.difference)), 9, 16]);
      if (l.kind === 'overpayment') {
        rows.push(['    Recovery: ' + l.recovery.status + (l.recovery.reference ? ' (' + l.recovery.reference + ')' : ''), 8, 14]);
      }
    });
    rows.push(['']);
    rows.push(['Underpayments  ' + money(c.totals.underpayment), 10, 16]);
    rows.push(['Overpayments   ' + money(c.totals.overpayment), 10, 16]);
    rows.push(['Net adjustment ' + money(c.totals.net), 12, 24]);
    rows.push(['The original released payroll is unchanged. Sample data, not a legal record.', 8, 14]);
    HIS.pdf.save(rows, 'correction-' + c.id + '.pdf');
    return { ok: true };
  }

  function peso(n) {
    return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function reset() { HIS.store.remove(KEY); return state(); }

  HIS.payrollCorrections = {
    KEY: KEY,
    all: all, list: list, get: get, create: create,
    review: review, approve: approve, release: release,
    authorizeRecovery: authorizeRecovery,
    statement: statement, statementPdf: statementPdf,
    alreadyCorrected: alreadyCorrected, reset: reset
  };
  ["create","review","approve","release","authorizeRecovery"].forEach(function (name) {
    if (HIS.payrollCorrections[name]) HIS.payrollCorrections[name] = HIS.store.atomic(HIS.payrollCorrections[name]);
  });

})();
