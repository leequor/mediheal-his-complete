// Payroll: ONE template (Figma 623:702) + state frames as JS states: Department filter open
// (4001:4423), Status filter open (4001:4733), overlays Process payments (2030:8587), Generate
// payslips (4008:3316), Export payroll (4008:3345), Payslip per employee (2030:8350).
//
// M10: every figure now comes from HIS.payrollRuns -> HIS.payrollCalc -> HIS.attendancePeriod.
// The row no longer carries `basic`, `allow`, `ded` or `days`; those are computed from the monthly
// salary and the approved timesheet. The geometry of the screen is unchanged — the same cards,
// columns and positions as the Figma frame.
//
// Additions (not in Figma, in the design format): live search, row selection, a run-lifecycle modal
// behind "Process payments", a timesheet review modal behind the attendance link in the footer, a
// CSV export, and a payslip that itemises every earning and deduction.
(function () {
  var P = HIS.payroll, stage = document.getElementById('stage');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return '\u20b1' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var fmt0 = function (n) { return '\u20b1' + Math.round(Number(n || 0)).toLocaleString('en-US'); };
  var ALL_D = 'All departments', ALL_S = 'All payment statuses';
  var st = { q: '', dept: ALL_D, status: ALL_S, menu: '', modal: '', emp: null, sel: {}, tsEmp: null, tsTab: 'timesheets', annualEmp: null, corrId: null, corrReason: '' };
  HIS.prState = st;

  // A period can be selected from the pay-period menu. It is applied BEFORE the run is resolved,
  // so the page renders that cut-off's payroll rather than the one it opened on.
  var wantPeriod = new URLSearchParams(location.search).get('period');
  if (wantPeriod) HIS.attendancePeriod.setPeriod(wantPeriod);

  // One run per period. Created on first load; afterwards the stored run is reused so a reload
  // never produces a second payroll for the same period.
  function ensureRun() {
    var run = HIS.payrollRuns.current();
    if (!run) run = HIS.rbac.can('payroll') ? HIS.payrollRuns.create({ note: 'Initial run for the period' }).run : HIS.payrollRuns.preview();
    return run;
  }
  var run = ensureRun();

  var IC = {
    users: "<path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8'/>",
    wallet: "<path d='M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5'/><path d='M16 13h.01'/>",
    receipt: "<path d='M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM8 8h8M8 12h8M8 16h5'/>",
    banknote: "<rect x='2' y='6' width='20' height='12' rx='2'/><circle cx='12' cy='12' r='2'/><path d='M6 12h.01M18 12h.01'/>",
    download: "<path d='M12 3v12M7 10l5 5 5-5M5 21h14'/>",
    file: "<path d='M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6'/>",
    send: "<path d='M22 2 11 13M22 2l-7 20-4-9-9-4z'/>",
    calendar: "<rect x='3' y='4' width='18' height='18' rx='2'/><path d='M16 2v4M8 2v4M3 10h18'/>",
    chevron: "<path d='M6 9l6 6 6-6'/>",
    search: "<circle cx='11' cy='11' r='7'/><path d='m21 21-4.3-4.3'/>",
    clock: "<circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/>",
    shield: "<path d='M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z'/><path d='m9 12 2 2 4-4'/>",
    check: "<path d='m5 12 5 5 9-10'/>",
    x: "<path d='M18 6 6 18M6 6l12 12'/>"
  };
  var ic = function (n, w, sw) { return "<svg width='" + w + "' height='" + w + "' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='" + (sw || 2) + "' stroke-linecap='round' stroke-linejoin='round'>" + IC[n] + '</svg>'; };
  var at = function (cls, l, t, inner, extra) { return "<div class='pr-a " + cls + "' style='left:" + l + 'px;top:' + t + 'px;' + (extra || '') + "'>" + inner + '</div>'; };

  var wrap = document.createElement('div'); wrap.id = 'prc'; stage.appendChild(wrap);

  function line(e) { return HIS.payrollRuns.lineFor(e.id); }
  function blocked(e) { return HIS.payrollRuns.blockedFor(e.id); }
  function statusOf(e) {
    if (blocked(e)) return 'Blocked';
    var l = line(e);
    return l ? l.status : 'Pending';
  }
  function visible() {
    return HIS.employees.all().filter(function (e) {
      return (st.dept === ALL_D || e.dept === st.dept) && (st.status === ALL_S || statusOf(e) === st.status) &&
        (!st.q || (e.name + ' ' + e.id + ' ' + e.role + ' ' + e.dept).toLowerCase().indexOf(st.q.trim().toLowerCase()) > -1);
    });
  }
  function sum(a, f) { return a.reduce(function (t, x) { return t + (Number(f(x)) || 0); }, 0); }

  // Pay-period menu. The control used to be a styled <div> with no handler at all: clicking it did
  // nothing, which is exactly what it looked like it should do. It is now a real menu over the two
  // cut-offs this hospital runs, and it says which of them already has a payroll run.
  function periodMenu() {
    if (st.menu !== 'period') return '';
    var cur = HIS.attendancePeriod.active();
    var LAB = { draft: 'Draft', reviewed: 'For approval', approved: 'Approved', released: 'Released' };
    var items = HIS.attendancePeriod.periods().map(function (p) {
      var r = HIS.payrollRuns.forPeriod(p.id);
      var on = p.id === cur.id;
      // Step 3 of the hand-off: Accounting picks the cut-off here, so the list has to say which
      // cut-offs HR has actually verified. An unverified one can be opened but never computed.
      var v = HIS.attendancePeriod.isVerified(p.id);
      var state = !v ? 'Attendance not verified · HR must submit first'
        : (r ? esc(r.id) + ' · ' + (LAB[r.status] || r.status) + ' · v' + r.version : 'Verified · no payroll run yet');
      return "<button type='button' class='pr-pm-i" + (on ? ' on' : '') + "' data-period-opt='" + p.id + "' role='option' aria-selected='" + on + "'>" +
        '<b>' + esc(p.label) + (v ? '' : ' · unverified') + '</b>' +
        '<span>' + state + '</span>' +
        (on ? '<i>Showing</i>' : '') + '</button>';
    }).join('');
    return "<div class='pr-pm' role='listbox' aria-label='Pay period'>" +
      "<div class='pr-pm-h'>Pay period</div>" + items +
      "<div class='pr-pm-f'>Semi-monthly cut-offs. Attendance and payroll both follow the period chosen here.</div></div>";
  }

  function top() {
    var E = HIS.employees.all(), T = run.totals;
    var paid = run.lines.filter(function (l) { return l.status === 'Paid'; });
    var statusLabel = { draft: 'Draft', reviewed: 'For approval', approved: 'Approved', released: 'Released' }[run.status] || run.status;
    var h = "<h1 class='pr-a pr-t' style='left:68px;top:115px'>Payroll</h1>" + at('pr-d', 68, 166, 'Review salaries, deductions and payments for each pay period.');
    h += at('pr-card', 68, 207, '', 'width:1304px;height:100px');
    h += at('pr-lbl', 88, 227, 'PAY PERIOD');
    h += "<button type='button' class='pr-a pr-sel' data-period-menu aria-haspopup='listbox' aria-expanded='" + (st.menu === 'period') + "' title='Choose a pay period' style='left:88px;top:247px'>" +
      ic('calendar', 16, 1.8).replace('<svg', "<svg style='position:absolute;left:12px;top:12px;color:#1b4e6b'") +
      "<span class='v'>" + esc(run.periodLabel) + '</span>' +
      ic('chevron', 16, 2).replace('<svg', "<svg style='position:absolute;right:12px;top:12px;color:#1b4e6b'") + '</button>' +
      periodMenu();
    h += at('pr-div', 293, 233, '');
    h += at('pr-lbl', 314, 228.5, 'PAYMENT DATE') + at('pr-date', 314, 248.5, run.payDate) + at('pr-meth', 314, 272.5, 'Semi-monthly \u00b7 ' + P.method + ' \u00b7 ' + statusLabel + ' v' + run.version);
    // pointer-events:none — this wrapper spans the whole pay-period card and was sitting on top of
    // the period control, so the control could not be clicked. Only its buttons take the pointer.
    h += "<div class='pr-a' style='left:68px;top:207px;width:1304px;height:100px;pointer-events:none'>";
    h += "<button class='pr-btn' data-modal='export' style='left:768px;width:146px'>" + ic('download', 18, 1.8) + '<span>Export payroll</span></button>';
    // Fixed-width Figma slot: 172px fits ~17 characters, so the visible label is shortened and the
    // full phrase lives in the title (hover) and in the dialog heading. A clipped label looked broken.
    h += "<button class='pr-btn' data-modal='gen' title='Compute &amp; Release Payslips' style='left:926px;width:172px'>" + ic('file', 18, 1.8) + '<span>Compute &amp; release</span></button>';
    h += "<button class='pr-btn pri' data-modal='proc' style='left:1110px;width:174px'>" + ic('send', 18, 1.8) + '<span>Process payments</span></button></div>';
    var M = [['users', 'Employees in payroll', String(T.headcount) + ' of ' + E.length, paid.length + ' paid \u00b7 ' + (T.headcount - paid.length) + ' awaiting settlement'],
      ['wallet', 'Total earnings', fmt(T.gross), 'Basic + overtime + premiums + allowances'],
      ['receipt', 'Total deductions', fmt(T.deductions), 'Tax + employee contributions'],
      ['banknote', 'Net payroll', fmt(T.net), fmt0(sum(paid, function (l) { return l.net; })) + ' paid this period']];
    M.forEach(function (m, i) { h += "<div class='pr-a pr-card pr-m' style='left:" + (68 + 331 * i) + "px;top:331px'><span class='ic'>" + ic(m[0], 24, 1.8) + "</span><span class='l'>" + m[1] + "</span><span class='n'>" + m[2] + "</span><span class='s'>" + m[3] + '</span></div>'; });
    return h;
  }

  var HCOL = [['EMPLOYEE', 52], ['DEPARTMENT', 290], ['DAYS \u00b7 HOURS', 440]];
  var RCOL = [['BASIC SALARY', 560, 112], ['ALLOWANCES', 680, 110], ['DEDUCTIONS', 798, 112], ['NET PAY', 918, 126]];
  var cb = function (on, l, t, d) { return "<button class='pr-cb" + (on ? ' on' : '') + "' data-cb='" + d + "' style='left:" + l + 'px;top:' + t + "px' aria-label='Select'>" + (on ? ic('check', 12, 3).replace('<svg', "<svg style='color:#fff'") : '') + '</button>'; };

  function register() {
    var v = visible(), E = HIS.employees.all();
    var pend = run.lines.filter(function (l) { return l.status === 'Pending'; }).length;
    var proc = run.lines.filter(function (l) { return l.status === 'Processing'; }).length;
    var allSel = v.length > 0 && v.every(function (e) { return st.sel[e.id]; });
    var h = "<section class='pr-a pr-card pr-reg'>";
    h += at('pr-st', 24, 24, 'Employee salaries') + at('pr-ex', 24, 53, 'Earnings from the monthly salary and the approved timesheet. Amounts in PHP for the period.');
    h += at('pr-ex', 1116, 38, ic('clock', 16, 1.8).replace('<svg', "<svg style='color:#6f8890'")) + at('pr-ex', 1140, 38.5, pend + ' pending \u00b7 ' + proc + ' processing');
    h += "<div class='pr-a pr-search' style='left:24px;top:86px'>" + ic('search', 18, 1.8) + "<input id='prq' placeholder='Search employee name or ID' aria-label='Search employee' value='" + esc(st.q) + "'></div>";
    h += "<button class='pr-flt" + (st.menu === 'dept' ? ' open' : '') + "' id='prd' style='left:444px;width:148px'><span class='v'>" + esc(st.dept) + '</span>' + ic('chevron', 16, 2) + '</button>';
    h += "<button class='pr-flt" + (st.menu === 'status' ? ' open' : '') + "' id='prs' style='left:604px;width:177px'><span class='v'>" + esc(st.status) + '</span>' + ic('chevron', 16, 2) + '</button>';
    h += "<div class='pr-a pr-ex' style='right:24px;top:98.5px'>" + v.length + ' employee' + (v.length === 1 ? '' : 's') + '</div>';
    h += "<div class='pr-a pr-th'>" + cb(allSel, 24, 15, 'all');
    HCOL.forEach(function (c) { h += at('pr-h', c[1], 16.5, c[0]); });
    RCOL.forEach(function (c) { h += at('pr-h', c[1], 16.5, c[0], 'width:' + c[2] + 'px;text-align:right'); });
    h += at('pr-h', 1068, 16.5, 'PAYMENT STATUS') + at('pr-h', 1186, 16.5, 'ACTION', 'width:94px;text-align:right') + '</div>';
    h += "<div class='pr-a pr-rows' role='region' aria-label='Employee payroll rows'>";
    v.forEach(function (e, i) {
      var l = line(e), b = blocked(e), s = statusOf(e);
      var cells = l
        ? [[560, 112, l.earnings.basic], [680, 110, l.earnings.allowances], [798, 112, l.deductions], [918, 126, l.net, 'net']]
        : [[560, 112, 0], [680, 110, 0], [798, 112, 0], [918, 126, 0, 'net']];
      h += "<div class='pr-a pr-r' style='top:" + (64 * i) + "px'>" + cb(!!st.sel[e.id], 24, 24, e.id);
      h += "<span class='nm'>" + esc(e.name) + "</span><span class='mt'>" + e.id + ' \u00b7 ' + esc(e.role) + "</span><span class='dp'>" + esc(e.dept) + '</span>';
      h += "<span class='dh'>" + (l ? l.days.worked + ' days \u00b7 ' + Math.round((l.days.worked * 8) + l.days.overtimeHours) + ' h' : (b ? 'no approved timesheet' : '\u2014')) + '</span>';
      cells.forEach(function (c) {
        h += "<span class='am " + (c[3] || '') + "' style='left:" + c[0] + 'px;width:' + c[1] + "px'>" + (l ? fmt(c[2]) : '\u2014') + '</span>';
      });
      h += "<span class='pr-p " + (s === 'Blocked' ? 'Pending' : s) + "'>" + (s === 'Paid' ? '<i></i>' : '') + "<span class='lb'>" + s + '</span></span>';
      var setup = !e.monthlyBasic && HIS.rbac.can('payroll');
      h += "<button class='pr-ps' " + (setup ? 'data-paysetup' : 'data-slip') + "='" + e.id + "'>" + ic('file', 15, 1.8) + '<span>' + (setup ? 'Set pay' : l ? 'Payslip' : 'Review') + '</span></button></div>';
    });
    h += '</div>';
    if (!v.length) h += "<div class='pr-a pr-none'>No employees match</div>";
    var vis = v.map(line).filter(Boolean);
    h += "<div class='pr-a pr-tot'><span class='tl'>Pay period total \u00b7 " + vis.length + ' employee' + (vis.length === 1 ? '' : 's') + '</span>';
    h += "<span class='dd'>" + sum(vis, function (l) { return l.days.worked; }) + ' days \u00b7 ' + sum(vis, function (l) { return l.days.overtimeHours; }) + ' h OT</span>';
    [[560, 112, function (l) { return l.earnings.basic; }], [680, 110, function (l) { return l.earnings.allowances; }],
      [798, 112, function (l) { return l.deductions; }], [918, 126, function (l) { return l.net; }]].forEach(function (c, i) {
      h += "<span class='am" + (i === 3 ? ' net' : '') + "' style='left:" + c[0] + 'px;width:' + c[1] + "px'>" + fmt(sum(vis, c[2])) + '</span>';
    });
    h += '</div>';
    var un = HIS.attendancePeriod.unapproved();
    h += "<div class='pr-a pr-ft'>" + at('pr-ex', 24, 25.5, 'Showing ' + (v.length ? '1\u2013' + v.length : '0') + ' of ' + E.length + ' employees');
    h += "<button class='pr-link' data-modal='timesheets' style='position:absolute;left:250px;top:26px'>" +
      (un.length ? un.length + ' timesheet' + (un.length === 1 ? '' : 's') + ' need approval \u2192' : 'Timesheets \u00b7 ' + (E.length - un.length) + ' of ' + E.length + ' approved \u2192') + '</button>';
    h += at('pr-meth', 504, 25, ic('shield', 16, 1.8).replace('<svg', "<svg style='color:#6f8890'")) + at('pr-meth', 527, 26.5, 'Statutory tables effective ' + HIS.payrollCalc.CONFIG.effectiveFrom + ' \u00b7 verify before use.');
    h += "<div class='pr-pg'>Page 1 of 1</div></div></section>";
    return h;
  }

  function menu() {
    // The period menu is its own popover and does not need the full-page dismiss layer; drawing it
    // here put a 300-z-index sheet over the period options, so they could not be clicked.
    if (!st.menu || st.menu === 'period') return '';
    var isD = st.menu === 'dept', opts = isD ? [ALL_D].concat(P.depts) : [ALL_S].concat(['Pending', 'Processing', 'Paid', 'Blocked']), cur = isD ? st.dept : st.status;
    var h = "<div class='pr-ml' data-close='1'></div><div class='pr-menu' style='left:" + (isD ? 512 : 672) + 'px;height:' + (16 + 36 * opts.length) + "px'>";
    opts.forEach(function (o) { h += "<button class='pr-o" + (o === cur ? ' on' : '') + "' data-opt='" + esc(o) + "'>" + esc(o) + '</button>'; });
    return h + '</div>';
  }

  // ---- modals --------------------------------------------------------------------------------
  // `next` is the resulting status; `method` is the module function that performs it. They are not
  // the same string — 'reviewed' is the status, `review` is the call.
  var NEXT = {
    draft: { label: 'Mark as reviewed', next: 'reviewed', method: 'review', note: 'Checking the run moves it to review. Figures are still editable until approval.' },
    reviewed: { label: 'Approve payroll', next: 'approved', method: 'approve', note: 'Approval freezes the calculation. A later change needs a correction run.' },
    approved: { label: 'Release payments', next: 'released', method: 'release', note: 'Release marks every line Paid and writes the release to the audit log.' }
  };

  function procBody() {
    var T = run.totals;
    var stageTxt = { draft: 'Draft', reviewed: 'Reviewed', approved: 'Approved', released: 'Released' }[run.status];
    var step = NEXT[run.status];
    var h = "<div class='pr-mv-grid'>";
    h += field('Employees in this run', T.headcount + ' of ' + HIS.employees.all().length);
    h += field('Gross pay', fmt(T.gross));
    h += field('Employee deductions', fmt(T.deductions));
    h += field('Net pay to release', fmt(T.net));
    h += field('Employer contributions', fmt(T.employerTotal));
    h += field('Run status', stageTxt + ' \u00b7 version ' + run.version);
    h += '</div>';
    if (run.blocked.length) {
      h += "<div class='pr-slip-note'><b>" + run.blocked.length + ' employee' + (run.blocked.length === 1 ? '' : 's') + ' cannot be paid.</b> ' +
        esc(run.blocked.map(function (b) { return b.name + ' — ' + b.reason; }).join('; ')) + '</div>';
    } else {
      h += "<div class='pr-slip-note'>" + esc(step ? step.note : 'This run is released and final. Corrections are raised as a separate run.') + '</div>';
    }

    // Wage floor. One line, not one per employee: the period either has an order in force or it
    // does not, and repeating it eight times would bury the figure that matters.
    var floors = run.lines.map(function (l) { return l.wageFloor; }).filter(Boolean);
    var unknown = floors.filter(function (f) { return f.status === 'unknown'; })[0];
    var exempt = floors.filter(function (f) { return f.status === 'exempt'; });
    if (unknown) {
      h += "<div class='pr-slip-note'><b>Wage floor not applicable to this period.</b> " + esc(unknown.explanation) + '</div>';
    } else if (exempt.length) {
      h += "<div class='pr-slip-note'><b>" + exempt.length + ' employee(s) below the floor under an exemption.</b> ' +
        esc(exempt.map(function (f) { return f.employeeId; }).join(', ')) + '</div>';
    } else if (floors.length) {
      h += "<div class='pr-slip-note'>Every rate is at or above the <b>" + esc(floors[0].floor.orderId) +
        '</b> floor of ' + fmt(floors[0].floor.dailyRate) + ' for an 8-hour day. Monthly-paid salaries are ' +
        'converted at 365 days; daily- and hourly-paid rates at their own schedule factor.</div>';
    }

    if (run.status === 'released') h += correctionsBlock();
    return h;
  }

  function correctionsFor(runId) {
    return HIS.payrollCorrections.list().filter(function (c) { return c.originalRunId === runId; });
  }

  function correctionActions(c) {
    var h = '';
    if (c.status === 'draft') h += "<button class='pr-mini pri' data-corr='review' data-id='" + c.id + "'>Review</button>";
    if (c.status === 'reviewed') h += "<button class='pr-mini pri' data-corr='approve' data-id='" + c.id + "'>Approve</button>";
    if (c.status === 'approved') h += "<button class='pr-mini pri' data-corr='release' data-id='" + c.id + "'>Release</button>";
    if (c.status === 'released') h += "<button class='pr-mini' data-corr='pdf' data-id='" + c.id + "'>Statement</button>";
    h += "<button class='pr-mini' data-corr='detail' data-id='" + c.id + "'>Open</button>";
    return h;
  }

  function correctionsBlock() {
    var cs = correctionsFor(run.id);
    var h = "<div class='pr-sect'><h4>Correction runs</h4>";
    if (!cs.length) {
      h += "<div class='pr-slip-note'>No correction has been raised against this run. The released payroll is a historical record and is never edited.</div>";
    } else {
      cs.forEach(function (c) {
        h += "<div class='pr-corr-row'><span><b>" + esc(c.id) + '</b> · ' + esc(c.reason) +
          '<br><small>' + c.totals.employees + ' employee(s) · underpayment ' + fmt(c.totals.underpayment) +
          ' · overpayment ' + fmt(c.totals.overpayment) + ' · ' + esc(c.status) + '</small></span>' +
          '<span>' + correctionActions(c) + '</span></div>';
      });
    }
    if (run.status === 'released') {
      h += "<button class='pr-mini pri' data-corr='new' style='margin-top:10px'>Create correction run</button>";
    }
    return h + '</div>';
  }

  function field(label, value) {
    return "<div class='pr-mv'><span class='k'>" + esc(label) + "</span><span class='v'>" + esc(value) + '</span></div>';
  }

  function slipBody() {
    var p = HIS.payrollRuns.payslip(st.emp.id);
    if (!p) {
      var b = blocked(st.emp);
      return "<div class='pr-slip-note'><b>No payable line.</b> " + esc(b ? b.reason : 'This employee has no payroll line for the period.') +
        ' Approve the timesheet first, then recompute the run.</div>';
    }
    var L = p.line;
    var h = "<div class='pr-mv-grid'>";
    h += field('Employee', p.employee.name + ' \u00b7 ' + p.employee.id);
    h += field('Department \u00b7 position', p.employee.dept + ' \u00b7 ' + p.employee.role);
    h += field('Pay period', p.periodLabel + ' \u00b7 ' + p.frequency);
    h += field('Gross pay', fmt(L.gross));
    h += field('Total deductions', fmt(L.deductions));
    h += field('Net pay', fmt(L.net));
    h += '</div>';
    h += "<div class='pr-slip-list'>";
    L.lines.forEach(function (l) {
      // A zero absence or zero late line is noise on a payslip; the totals still account for it.
      if (l.amount === 0 && l.kind !== 'total') return;
      h += "<div class='pr-slip-row" + (l.kind === 'total' ? ' tot' : '') + "'><span>" + esc(l.label) + '</span><span>' +
        (l.amount < 0 ? '\u2212' : '') + fmt(Math.abs(l.amount)) + '</span></div>';
    });
    h += '</div>';
    h += "<div class='pr-slip-note'><b>Employer contributions are not deducted from pay.</b> SSS " + fmt(p.employer.sss) +
      ' \u00b7 PhilHealth ' + fmt(p.employer.philhealth) + ' \u00b7 Pag-IBIG ' + fmt(p.employer.pagibig) + ' \u00b7 EC ' + fmt(p.employer.ec) +
      '. Attendance: ' + p.attendance.workedDays + ' days worked, ' + p.attendance.absenceDays + ' absent, ' +
      p.attendance.lateMinutes + ' min late, ' + L.days.overtimeHours + ' h OT, ' + L.days.nightHours + ' h night.</div>';
    return h;
  }

  function thirteenthBody() {
    var t = HIS.payrollRuns.thirteenth({ monthsElapsed: 8 });
    var h = "<div class='pr-ts-grid th'><span>Employee</span><span>Months</span><span>Basic earned</span><span>13th month</span><span>Exempt</span><span>Taxable</span><span></span></div>";
    t.rows.forEach(function (r) {
      h += "<div class='pr-ts-row th'><span><b>" + esc(r.name) + '</b><br><small>' + r.employeeId + '</small></span>' +
        '<span>' + r.months + '</span><span>' + fmt(r.basicEarned) + '</span><span>' + fmt(r.amount) + '</span>' +
        '<span>' + fmt(r.taxExempt) + '</span><span>' + fmt(r.taxableExcess) + '</span>' +
        "<span><button class='pr-mini' data-annual='" + r.employeeId + "'>Year-end</button></span></div>";
    });
    h += "<div class='pr-ts-row th tot'><span>Total</span><span></span><span></span><span>" + fmt(t.totals.amount) +
      '</span><span>' + fmt(t.totals.taxExempt) + '</span><span>' + fmt(t.totals.taxableExcess) + '</span><span></span></div>';
    if (st.annualEmp) {
      var emp = HIS.employees.byId(st.annualEmp), a = HIS.payrollRuns.annual(st.annualEmp, { monthsElapsed: 8 });
      h += "<div class='pr-slip-note'><b>Year-end reconciliation · " + esc(emp.name) + '</b><br>' +
        'Regular taxable compensation ' + fmt(a.regularTaxable) + ' − employee contributions ' + fmt(a.contributions) +
        ' + taxable benefits ' + fmt(a.benefitsTaxable) + ' = ' + fmt(a.taxableCompensation) + '.<br>' +
        'Annual tax due ' + fmt(a.annualDue) + ' − withheld ' + fmt(a.taxWithheld) + ' = <b>' +
        fmt(Math.abs(a.adjustment)) + ' ' + (a.direction === 'due' ? 'still due' : a.direction === 'refund' ? 'to refund' : 'even') + '</b>.</div>';
    }
    h += "<div class='pr-slip-note'>13th month is one twelfth of the <b>basic salary</b> earned in the calendar year (PD 851). Allowances, overtime, night differential and premiums are excluded. The first " +
      fmt(HIS.payrollCalc.CONFIG.thirteenth.taxExemptCap) + ' of 13th month pay and other benefits is exempt from income tax (RA 10963); the excess is taxable. Accrual shown to date: 8 months.</div>';
    return h;
  }

  function timesheetBody() {
    var E = HIS.employees.all();
    if (st.tsEmp) {
      var emp = HIS.employees.byId(st.tsEmp), ts = HIS.attendancePeriod.timesheet(st.tsEmp);
      var recs = HIS.attendancePeriod.recordsFor(st.tsEmp);
      var h = "<div class='pr-ts-head'><button class='pr-link' data-ts='back'>\u2190 All timesheets</button>" +
        "<span class='pr-ts-who'>" + esc(emp.name) + ' \u00b7 ' + emp.id + ' \u00b7 <b>' + ts.status + '</b></span></div>';
      h += "<div class='pr-ts-grid det'><span>Date</span><span>Day type</span><span>In</span><span>Out</span><span>Hours</span><span>OT</span><span>ND</span><span>Status</span></div>";
      recs.forEach(function (r) {
        var hours = r.worked ? ((function () {
          var a = r.timeIn.split(':'), b = r.timeOut.split(':');
          var m = (+b[0] * 60 + +b[1]) - (+a[0] * 60 + +a[1]);
          if (m < 0) m += 1440;
          return Math.max(0, (m - (r.breakMinutes || 0)) / 60);
        })()) : 0;
        h += "<div class='pr-ts-row det" + (r.status === 'absent' ? ' bad' : '') + "'>" +
          '<span>' + r.date.slice(5) + '</span><span>' + esc(r.dayType.replace('-', ' ')) + '</span>' +
          '<span>' + (r.timeIn || '\u2014') + '</span><span>' + (r.timeOut || '\u2014') + '</span>' +
          '<span>' + (r.worked ? hours.toFixed(1) : '\u2014') + '</span>' +
          '<span>' + (r.otHours || '\u2014') + '</span><span>' + (r.ndHours || '\u2014') + '</span>' +
          '<span>' + esc(r.status) + '</span></div>';
      });
      h += "<div class='pr-slip-note'>A correction reopens the timesheet: payroll will refuse to run until it is approved again, and the earlier run version stays intact.</div>";
      return h;
    }
    var h2 = "<div class='pr-ts-grid'><span>Employee</span><span>Days</span><span>Absent</span><span>Late</span><span>OT</span><span>Status</span><span></span></div>";
    E.forEach(function (e) {
      var ts = HIS.attendancePeriod.timesheet(e.id);
      var recs = HIS.attendancePeriod.recordsFor(e.id);
      var worked = recs.filter(function (r) { return r.worked; }).length;
      var abs = recs.filter(function (r) { return r.status === 'absent'; }).length;
      var late = recs.reduce(function (t, r) { return t + (r.lateMinutes || 0); }, 0);
      var ot = recs.reduce(function (t, r) { return t + (r.otHours || 0); }, 0);
      h2 += "<div class='pr-ts-row'><span><b>" + esc(e.name) + '</b><br><small>' + e.id + '</small></span>' +
        '<span>' + worked + '</span><span>' + abs + '</span><span>' + late + ' min</span><span>' + ot + ' h</span>' +
        "<span class='" + (ts.status === 'approved' ? 'ok' : 'warn') + "'>" + ts.status + '</span>' +
        "<span><button class='pr-mini' data-ts='open' data-emp='" + e.id + "'>View</button>" +
        (ts.status === 'approved'
          ? "<button class='pr-mini' data-ts='reopen' data-emp='" + e.id + "'>Reopen</button>"
          : "<button class='pr-mini pri' data-ts='approve' data-emp='" + e.id + "'>Approve</button>") + '</span></div>';
    });
    return h2;
  }

  function modalDef() {
    var T = run.totals;
    var per = 'Pay period ' + run.periodLabel + ' \u00b7 Semi-monthly';
    if (st.modal === 'proc') {
      var step = NEXT[run.status];
      return { y: 130, h: 620, t: 'Process payments', s: per + ' \u00b7 ' + (run.status === 'released' ? 'Released' : 'Review before releasing funds'),
        ok: step ? step.label : 'Close', c: step ? 'Cancel' : null, body: procBody(), wide: 1 };
    }
    if (st.modal === 'export') return { y: 453, h: 438, t: 'Export payroll', s: per + ' \u00b7 All employees', ok: 'Export file', c: 'Cancel',
      f: [['File format', 'CSV (opens in Excel)'], ['Records', run.lines.length + ' employees'], ['Pay period', run.periodLabel],
        ['Total net pay', fmt(T.net)], ['Columns', 'Basic, absence, late, overtime, night, premiums, allowances, gross, SSS, PhilHealth, Pag-IBIG, tax, net, employer shares']] };
    if (st.modal === 'gen' && run.status === 'released') return { y: 453, h: 300, t: 'Payroll already released', s: per + ' \u00b7 final for this cut-off', ok: 'Close', c: '',
      f: [['Status', 'Released'], ['Payslips', 'Issued once, at release'], ['Next step', 'Process payments']] };
    if (st.modal === 'gen') return { y: 453, h: 438, t: 'Compute & Release Payslips', s: per + ' \u00b7 Requires the cut-off verified by HR', ok: 'Compute & Release', c: 'Cancel',
      f: [['Employees', run.lines.length + ' payslips'], ['Total net pay', fmt(T.net)], ['Pay period', run.periodLabel],
        ['Delivery', 'Download — one PDF per employee, in a ZIP'], ['Includes', 'Every earning and deduction line, plus the employer contribution block']] };
    if (st.modal === 'corr-new') {
      return {
        y: 200, h: 420, t: 'Correction run', s: 'Against ' + run.id + ' · ' + run.periodLabel,
        ok: 'Create correction', c: 'Cancel', wide: 1,
        body: "<div class='pr-slip-note'>Every employee in the released run is recomputed from the current approved timesheet. Only those with a difference are included; the original payroll is not changed.</div>" +
          "<label class='pr-fld'><span>Reason for the correction</span><textarea id='corrReason' rows='3' placeholder='e.g. night differential omitted for EMP-005 on 25 August'>" + esc(st.corrReason) + "</textarea></label>"
      };
    }
    if (st.modal === 'corr-detail') {
      var c = HIS.payrollCorrections.get(st.corrId);
      if (!c) return { y: 200, h: 300, t: 'Correction', s: 'Not found', ok: 'Close', c: null, body: "<div class='pr-slip-note'>That correction no longer exists.</div>", wide: 1 };
      var rows = c.lines.map(function (l) {
        return "<div class='pr-corr-line'><span><b>" + esc(l.employeeName) + '</b> · ' + l.employeeId +
          '<br><small>original ' + fmt(l.originalNet) + ' → corrected ' + fmt(l.correctedNet) +
          (l.alreadyCorrected ? ' · already corrected ' + fmt(l.alreadyCorrected) : '') + '</small></span>' +
          '<span class="' + (l.kind === 'underpayment' ? 'pr-corr-due' : 'pr-corr-rec') + '">' +
          (l.kind === 'underpayment' ? '+' : '−') + fmt(Math.abs(l.difference)) + '</span></div>';
      }).join('');
      var rec = c.lines.filter(function (l) { return l.kind === 'overpayment'; });
      return {
        y: 170, h: Math.min(560, 300 + c.lines.length * 52), t: c.id + ' · ' + c.status, s: esc(c.reason), ok: 'Close', c: null, wide: 1,
        body: rows +
          "<div class='pr-slip-note'>Underpayments " + fmt(c.totals.underpayment) + ' · overpayments ' +
          fmt(c.totals.overpayment) + ' · net ' + fmt(c.totals.net) + '. ' +
          (rec.length ? 'An overpayment is recorded as a receivable; it is not deducted without a written authorisation.' : '') + '</div>' +
          (c.status === 'released' ? "<button class='pr-mini' data-corr='pdf' data-id='" + c.id + "'>Download statement</button>" : '') +
          rec.map(function (l) {
            return "<div class='pr-corr-row'><span>" + esc(l.employeeName) + ' · recovery ' + esc(l.recovery.status) + '</span>' +
              (l.recovery.authorized ? "<span class='pr-corr-ok'>" + esc(l.recovery.reference) + '</span>'
                : "<span><button class='pr-mini' data-corr='authorize' data-id='" + c.id + "' data-emp='" + l.employeeId + "'>Authorise recovery</button></span>") + '</div>';
          }).join('')
      };
    }
    if (st.modal === 'timesheets') {
      var tabBar = "<div class='pr-seg'><button data-tab='timesheets' class='" + (st.tsTab === 'timesheets' ? 'on' : '') + "'>Timesheets</button>" +
        "<button data-tab='thirteenth' class='" + (st.tsTab === 'thirteenth' ? 'on' : '') + "'>13th month</button></div>";
      var body = tabBar + (st.tsTab === 'thirteenth' ? thirteenthBody() : timesheetBody());
      return {
        y: st.tsTab === 'thirteenth' ? 130 : 76,
        h: st.tsTab === 'thirteenth' ? 620 : (st.tsEmp ? 748 : 560),
        t: st.tsTab === 'thirteenth' ? '13th month and year-end' : 'Timesheets',
        s: st.tsTab === 'thirteenth' ? 'Calendar year 2026 \u00b7 accrual to date' : run.periodLabel + ' \u00b7 ' + (HIS.employees.all().length - HIS.attendancePeriod.unapproved().length) + ' of ' + HIS.employees.all().length + ' approved',
        ok: 'Close', c: null, body: body, wide: 1
      };
    }
    return { y: 76, h: 748, t: 'Payslip', s: st.emp.name + ' \u00b7 ' + st.emp.id + ' \u00b7 ' + st.emp.role + ' \u00b7 ' + run.periodLabel,
      ok: 'Download PDF', c: 'Close', body: slipBody(), wide: 1, slip: 1 };
  }

  function modal() {
    if (!st.modal) return '';
    var d = modalDef(), h = "<div class='pr-scrim' data-close='1'></div><div class='pr-modal" + (d.wide ? ' wide' : '') + "' role='dialog' aria-modal='true' style='height:" + d.h + "px'>";
    h += "<button class='pr-m-x' data-close='1' aria-label='Close'>\u00d7</button><div class='pr-m-t'>" + esc(d.t) + "</div><div class='pr-m-s'>" + esc(d.s) + "</div><div class='pr-m-d'></div>";
    if (d.body) {
      h += "<div class='pr-m-body'>" + d.body + '</div>';
    } else {
      var pos = [[32, 120], [348, 120], [32, 202], [348, 202], [32, 284], [32, 366]], wid = [300, 300, 300, 300, 616, 616];
      d.f.forEach(function (f, i) {
        h += "<div class='pr-m-l' style='left:" + pos[i][0] + 'px;top:' + pos[i][1] + "px'>" + esc(f[0]) + '</div>';
        h += "<div class='pr-m-i" + (i === 5 ? ' ta' : '') + "' style='left:" + pos[i][0] + 'px;top:' + (pos[i][1] + 22) + 'px;width:' + wid[i] + "px'>" + esc(f[1]) + '</div>';
      });
    }
    var by = d.h - 64;
    h += (d.c ? "<button class='pr-m-c' data-close='1' style='top:" + by + "px'>" + esc(d.c) + '</button>' : '');
    h += "<button class='pr-m-ok' data-ok='1' style='top:" + by + 'px;' + (d.c ? '' : 'left:508px;') + "'>" + esc(d.ok) + '</button></div>';
    return h;
  }

  var tipT;
  function tip(t) { var o = document.querySelector('.pr-tip'); if (o) o.remove(); var d = document.createElement('div'); d.className = 'pr-tip'; d.textContent = t; document.body.appendChild(d); clearTimeout(tipT); tipT = setTimeout(function () { d.remove(); }, 2600); }

  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }

  function render(keepFocus) {
    run = HIS.payrollRuns.current() || run;
    wrap.innerHTML = top() + register() + "<div id='prmenu'>" + menu() + '</div><div id="prmodal">' + modal() + '</div>';
    if (keepFocus) { var q = document.getElementById('prq'); if (q) { q.focus(); var c = st.caret == null ? q.value.length : st.caret; q.setSelectionRange(c, c); } }
  }
  render();

  stage.addEventListener('click', function (e) {
    var T = e.target;
    if (T.closest('[data-close]')) { st.menu = ''; st.modal = ''; st.tsEmp = null; render(); return; }
    if (T.closest('[data-period-menu]')) { st.menu = st.menu === 'period' ? '' : 'period'; render(); return; }
    var po = T.closest('[data-period-opt]');
    if (po) {
      var pid = po.dataset.periodOpt;
      if (pid === HIS.attendancePeriod.active().id) { st.menu = ''; render(); return; }
      HIS.attendancePeriod.setPeriod(pid);
      location.href = 'payroll.html?period=' + encodeURIComponent(pid);
      return;
    }
    var o = T.closest('.pr-o');
    if (o) { if (st.menu === 'dept') st.dept = o.dataset.opt; else st.status = o.dataset.opt; st.menu = ''; render(); return; }
    if (T.closest('#prd')) { st.menu = st.menu === 'dept' ? '' : 'dept'; render(); return; }
    if (T.closest('#prs')) { st.menu = st.menu === 'status' ? '' : 'status'; render(); return; }
    var c = T.closest('[data-cb]');
    if (c) {
      var id = c.dataset.cb, v = visible();
      if (id === 'all') { var on = !v.every(function (x) { return st.sel[x.id]; }); v.forEach(function (x) { st.sel[x.id] = on; }); } else st.sel[id] = !st.sel[id];
      render(); return;
    }
    var corr = T.closest('[data-corr]');
    if (corr) {
      var cact = corr.dataset.corr, cid = corr.dataset.id;
      if (cact === 'new') { st.corrReason = ''; st.modal = 'corr-new'; render(); return; }
      if (cact === 'detail') { st.corrId = cid; st.modal = 'corr-detail'; render(); return; }
      if (cact === 'pdf') {
        var pdf = HIS.payrollCorrections.statementPdf(cid);
        tip(pdf.ok ? 'Correction statement downloaded' : pdf.error);
        return;
      }
      if (cact === 'review' || cact === 'approve' || cact === 'release') {
        var rr = HIS.payrollCorrections[cact](cid, 'Via the payroll screen');
        tip(rr.ok ? 'Correction ' + cid + ' ' + cact + 'd' : rr.error);
        st.modal = 'proc'; render(); return;
      }
      if (cact === 'authorize') {
        HIS.kit.modal({
          title: 'Authorise overpayment recovery',
          sub: 'Recovery needs a written authorisation on file. Nothing is deducted by this action.',
          body: "<label style='display:block;margin-top:10px;font:600 12px Inter,sans-serif;color:#1b4e6b'>Authorisation reference<input name='reference' style='display:block;width:100%;margin-top:5px;height:36px;border:1px solid #c8dcea;border-radius:8px;padding:0 10px;font:400 13px Inter,sans-serif'></label>",
          saveLabel: 'Record authorisation',
          onSave: function (data) {
            var ar = HIS.payrollCorrections.authorizeRecovery(cid, corr.dataset.emp, data);
            tip(ar.ok ? 'Recovery authorised' : ar.error);
            render();
          }
        });
        return;
      }
    }
    var tb = T.closest('[data-tab]');
    if (tb) { st.tsTab = tb.dataset.tab; st.tsEmp = null; st.annualEmp = null; render(); return; }
    var an = T.closest('[data-annual]');
    if (an) { st.annualEmp = an.dataset.annual; render(); return; }
    var tsb = T.closest('[data-ts]');
    if (tsb) {
      var act = tsb.dataset.ts;
      if (act === 'back') { st.tsEmp = null; render(); return; }
      if (act === 'open') { st.tsEmp = tsb.dataset.emp; render(); return; }
      if (act === 'approve') {
        var r = HIS.attendancePeriod.approve(tsb.dataset.emp, 'Approved from the payroll screen');
        if (r.ok) { var rc = HIS.payrollRuns.recompute(run.id, 'Timesheet approved for ' + tsb.dataset.emp); tip('Timesheet approved \u00b7 payroll recomputed to version ' + (rc.ok ? rc.run.version : run.version)); }
        else tip(r.error);
        render(); return;
      }
      if (act === 'reopen') {
        var rr = HIS.attendancePeriod.reopen(tsb.dataset.emp, 'Reopened from the payroll screen');
        tip(rr.ok ? 'Timesheet reopened \u2014 payroll is blocked until it is approved again' : rr.error);
        render(); return;
      }
    }
    var setupButton = T.closest('[data-paysetup]');
    if (setupButton) {
      HIS.kit.modal({ title: 'Set employee pay', sub: esc(HIS.employees.byId(setupButton.dataset.paysetup).name), body: "<label>Monthly basic salary (PHP)<input type='number' name='monthlyBasic' min='0.01' step='0.01' required></label><label>Payroll category<select name='category'><option value='rank-and-file'>Rank and file</option><option value='managerial'>Managerial</option></select></label>", onSave: function (v, err) {
        var result = HIS.employees.setPay(setupButton.dataset.paysetup, v);
        if (!result.ok) { err.textContent = result.error; return false; }
        HIS.payrollRuns.recompute(run.id, 'Employee pay setup'); render();
      } }); return;
    }
    var sl = T.closest('[data-slip]');
    if (sl) { st.emp = HIS.employees.byId(sl.dataset.slip); st.modal = 'slip'; render(); return; }
    var m = T.closest('[data-modal]'); if (m) { st.modal = m.dataset.modal; st.tsEmp = null; render(); return; }
    if (T.closest('[data-ok]')) {
      var k = st.modal;
      if (k === 'proc') {
        var step = NEXT[run.status];
        if (!step) { st.modal = ''; render(); return; }
        var res = HIS.payrollRuns[step.method](run.id, 'Via the payroll screen');
        if (!res.ok) { tip(res.error); return; }
        tip(step.next === 'released' ? 'Payments released \u00b7 ' + fmt(res.run.totals.net) : 'Payroll ' + step.next);
      } else if (k === 'gen') {
        // Step 3 of the hand-off. Accounting may only compute a cut-off that HR has verified, and one
        // click takes the run from computed to released so employees can open their own payslip.
        // A released run is final: clicking again must not re-announce a release or re-issue payslips,
        // or the page looks like it is releasing the same money over and over.
        if (run.status === 'released') {
          tip('Already released. Payslips for this cut-off were issued once and the run is final.');
          st.modal = '';
          render();
          return;
        }
        if (!HIS.attendancePeriod.isVerified(run.periodId)) {
          tip('HR has not verified this cut-off yet. Attendance must be verified before payroll can compute it.');
          return;
        }
        var stepRes = null;
        // One click walks the run to released: computed -> reviewed -> approved -> released. Each step is
        // re-read so a refusal (a blocked employee, a stale line) stops the chain instead of being skipped.
        var recomputed = false;
        for (var guard = 0; guard < 6; guard++) {
          run = HIS.payrollRuns.get(run.id) || run;
          if (run.status === 'released') break;
          if (run.status === 'draft') {
            if (!recomputed) { stepRes = HIS.payrollRuns.recompute(run.id); recomputed = true; }
            else stepRes = HIS.payrollRuns.review(run.id, 'Computed from the verified cut-off');
          }
          else if (run.status === 'reviewed') stepRes = HIS.payrollRuns.approve(run.id, 'Verified cut-off from HR');
          else if (run.status === 'approved') stepRes = HIS.payrollRuns.release(run.id, 'Released by Accounting');
          else break;
          if (stepRes && !stepRes.ok) { tip(stepRes.error); return; }
        }
        run = HIS.payrollRuns.get(run.id) || run;
        // One archive, so the count in the message is the number of files the browser actually saved.
        // Eight separate downloads are throttled by Chrome and the tail is dropped silently.
        var batch = HIS.payrollRuns.payslipBatch();
        tip(batch.ok
          ? 'Payslips computed and released to ' + batch.count + ' employee(s) \u00b7 ' + fmt(run.totals.net) + ' net'
          : batch.error);
      } else if (k === 'export') {
        download('payroll-' + run.periodId.replace(/\//g, '-') + '-v' + run.version + '.csv', HIS.payrollRuns.csv(run.id));
        tip('Payroll exported as CSV');
      } else if (k === 'corr-new') {
        var reasonEl = document.getElementById('corrReason');
        var res = HIS.payrollCorrections.create({ originalRunId: run.id, reason: reasonEl ? reasonEl.value : '' });
        if (!res.ok) { tip(res.error); return; }
        st.corrId = res.correction.id;
        st.modal = 'corr-detail';
        tip('Correction ' + res.correction.id + ' created');
        render();
        return;
      } else if (k === 'slip') {
        var pr = HIS.payrollRuns.payslipPdf(st.emp.id);
        tip(pr.ok ? 'Payslip PDF downloaded' : pr.error);
      }
      st.modal = ''; st.tsEmp = null; render();
    }
  });
  // A menu that only closes by picking something is a trap: clicking anywhere else should dismiss it.
  document.addEventListener('click', function (e) {
    if (st.menu !== 'period') return;
    if (e.target.closest('.pr-pm') || e.target.closest('[data-period-menu]')) return;
    st.menu = ''; render();
  });

  stage.addEventListener('input', function (e) {
    if (e.target.id === 'prq') { st.q = e.target.value; st.caret = e.target.selectionStart; render(true); }
    if (e.target.id === 'corrReason') st.corrReason = e.target.value;
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && (st.menu || st.modal)) { st.menu = ''; st.modal = ''; st.tsEmp = null; render(); } });
})();
