// Role-aware dashboard (M4). Addition (not in Figma) — the Figma dashboard is a single frame drawn
// for one user; the brief requires each of the 14 roles to have a meaningful home.
//
// DESIGN RULE: the visual grammar is unchanged. Same greeting (Outfit 45 at 81,105), same four KPI
// cards at (24 + 355i, 195), same two panels at (38,405) 873 wide and (991,405) 424 wide, same
// .card-h/.card-sub/.dr/.dhead/.si/.dot/.tl/.badge components. Only the CONTENT varies by role.
//
// DATA RULE: every number is derived from the demo stores (HIS.patients, HIS.appointments,
// HIS.billing, HIS.payroll, HIS.nursing, HIS.treatment, HIS.accounts, HIS.audit). Nothing is a
// hardcoded statistic, and where a module does not exist yet the card says so instead of inventing
// activity. See docs/DESIGN-LOCK.md §9.4 for the Figma placeholder values this replaces.
(function () {
  var esc = HIS.kit.esc;

  // ---- data helpers -------------------------------------------------------
  var patients = function () { return HIS.patients || []; };
  var appts = function () { return HIS.appointments || []; };
  var bills = function () { return ((HIS.billing || {}).bills) || []; };
  var emps = function () { return ((HIS.payroll || {}).emps) || []; };
  var staff = function () { return ((HIS.personnel || {}).emps) || []; };
  var nurses = function () { return ((HIS.nursing || {}).pts) || []; };
  var plans = function () { return ((HIS.treatment || {}).plans) || []; };
  var accts = function () { return HIS.accounts ? HIS.accounts.all() : []; };
  var audit = function () { return HIS.audit ? HIS.audit.list().slice().reverse() : []; };
  var depts = function () { return HIS.departments || []; };

  // M7: one money chain. Every dashboard figure comes from the ledger, like Billing and Reports.
  function paidOf(b) { return HIS.ledger.paidOf(b); }
  function money(n) { return '\u20b1' + Number(n).toLocaleString('en-PH', { maximumFractionDigits: 0 }); }
  function count(list, fn) { return list.filter(fn).length; }
  function ptName(id) {
    var p = window.HIS.registry && HIS.registry.byId ? HIS.registry.byId(id) : null;
    return p ? p.name : (id || '—');
  }
  function first(name) { return String(name || '').replace(/^(Dr|Atty)\.\s*/i, '').split(' ')[0] || name; }

  // ---- renderers ----------------------------------------------------------
  // Table panel: the exact .dhead/.dr structure the Figma frame uses.
  function tablePanel(cfg) {
    var head = cfg.cols.map(function (c) {
      return "<span style='left:" + c.left + "px;width:" + (c.w || 85) + "px'>" + esc(c.t) + '</span>';
    }).join('');
    var rows = cfg.rows.map(function (r) {
      var cells = r.cells.map(function (cell, i) {
        var col = cfg.cols[i];
        var next = cfg.cols[i + 1] ? cfg.cols[i + 1].left : 827;
        var max = Math.max(60, next - col.left - 10);
        // First column is the name/meta block; any other array cell is [label, kind] -> badge.
        if (i === 0) return "<div class='who dc-who' style='width:" + Math.min(col.w || 100, max) + "px'><b>" + esc(cell[0]) + '</b><small>' + esc(cell[1] || '') + '</small></div>';
        if (Array.isArray(cell)) return "<span class='badge dc-badge " + (cell[1] || 'off') + "' style='left:" + col.left + "px;max-width:" + max + "px'>" + esc(cell[0]) + '</span>';
        return "<span class='c dc-clamp' style='left:" + col.left + 'px;max-width:' + max + "px'>" + esc(cell) + '</span>';
      }).join('');
      return "<div class='dr'>" + cells + '</div>';
    }).join('');
    var empty = cfg.rows.length ? '' : "<div class='dr'><div class='who'><b>Nothing to show</b><small>" + esc(cfg.empty || 'No records yet') + '</small></div></div>';
    return "<section class='card-lg' style='left:38px;top:405px;width:873px;min-height:627px;padding-top:163px;padding-bottom:20px'>" +
      "<h2 class='card-h' style='left:23px;top:20px'>" + esc(cfg.title) + '</h2>' +
      "<p class='card-sub' style='left:23px;top:62px'>" + esc(cfg.sub) + '</p>' +
      "<div class='dhead'>" + head + '</div>' + rows + empty + '</section>';
  }

  // Feed panel: the Figma timeline (.tl/.dot/.si) with an optional status badge.
  function feedPanel(cfg) {
    var items = cfg.items.map(function (it, i) {
      var top = 129 + i * 104;
      return "<i class='dot' style='top:" + (top + 4) + "px'></i>" +
        "<div class='si' style='top:" + top + "px'><div class='t'>" + esc(it.time) + '</div><b>' + esc(it.title) + '</b>' +
        (it.line1 ? '<small>' + esc(it.line1) + '</small>' : '') +
        (it.line2 ? '<small>' + esc(it.line2) + '</small>' : '') + '</div>' +
        (it.status ? "<span class='badge sched-badge " + (it.kind || 'off') + "' style='left:" + (it.status.length > 8 ? 276 : 283) + 'px;top:' + (top + 9) + "px'>" + esc(it.status) + '</span>' : '');
    }).join('');
    var empty = cfg.items.length ? '' : "<div class='dc-empty'>" + esc(cfg.empty || '') + '</div>';
    return "<section class='card-lg' style='left:991px;top:405px;width:424px;min-height:562px'>" +
      "<h2 class='card-h' style='left:22px;top:20px'>" + esc(cfg.title) + '</h2>' +
      "<p class='card-sub' style='left:22px;top:62px'>" + esc(cfg.sub) + '</p>' +
      "<div class='sched-ic'><span>" + svg(cfg.icon || 'calendar-check', 24) + '</span></div>' +
      (cfg.items.length ? "<i class='tl'></i>" : '') + items + empty + '</section>';
  }

  function kpiCards(list) {
    return list.slice(0, 4).map(function (k, i) {
      return "<div class='kpi' style='left:" + (24 + 355 * i) + "px;top:195px'><div class='ic'>" + svg(k.icon, 36) + '</div>' +
        "<div class='tx'><div class='l'>" + esc(k.label) + "</div><div class='v'>" + esc(k.value) + "</div><div class='d'>" + esc(k.delta) + '</div></div></div>';
    }).join('');
  }

  // ---- per-role configuration --------------------------------------------
  // `greet` is the greeting line; `kpis` four cards; `table` the 873px panel; `feed` the 424px panel.
  function build(role, person) {
    var P = patients(), A = appts(), B = bills(), E = emps(), S = staff(), N = nurses(), T = plans();
    var billed = B.reduce(function (s, b) { return s + b.amount; }, 0);
    var collected = B.reduce(function (s, b) { return s + paidOf(b); }, 0);
    var outstanding = billed - collected;
    var balOf = function (b) { return HIS.ledger.balanceOf(b); };
    var openBills = B.filter(function (b) { return balOf(b) > 0.005; });
    var inpatients = count(P, function (p) { return p.type === 'Inpatient'; });
    var outpatients = count(P, function (p) { return p.type === 'Outpatient'; });
    var waiting = count(P, function (p) { return p.status === 'Waiting'; });
    var admitted = count(P, function (p) { return p.status === 'Admitted'; });
    var AUD = audit();
    var ACC = accts();

    switch (role) {
      case 'superadmin': {
        var activeAcc = count(ACC, function (a) { return a.status === 'active'; });
        return {
          greet: 'System overview',
          kpis: [
            { label: 'User accounts', value: String(ACC.length), delta: activeAcc + ' active \u00b7 ' + (ACC.length - activeAcc) + ' deactivated', icon: 'key' },
            { label: 'Audit entries', value: String(HIS.audit ? HIS.audit.list().length : 0), delta: AUD.length ? 'Latest ' + AUD[0].seq : 'No activity yet', icon: 'shield' },
            { label: 'Departments', value: String(depts().length), delta: 'Clinical and support', icon: 'branches' },
            { label: 'Open invoices', value: String(openBills.length), delta: money(outstanding) + ' outstanding', icon: 'receipt' }
          ],
          table: {
            title: 'Accounts by role', sub: 'Accounts and their current state',
            cols: [{ t: 'ACCOUNT', left: 20, w: 200 }, { t: 'ROLE', left: 240, w: 160 }, { t: 'DEPARTMENT', left: 420, w: 130 }, { t: 'STATUS', left: 570, w: 93 }, { t: 'LAST LOGIN', left: 700, w: 120 }],
            rows: ACC.slice(0, 6).map(function (a) {
              return { cells: [[a.name, a.email], (HIS.rbac.ROLES[a.role] || {}).short || a.role, a.dept || '\u2014', [a.status === 'active' ? 'Active' : 'Deactivated', a.status === 'active' ? 'ok' : 'off'], a.lastLogin ? new Date(a.lastLogin).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' }) : 'Never'] };
            }),
            empty: 'No accounts'
          },
          feed: {
            title: 'Recent activity', sub: 'Newest audit entries', icon: 'shield',
            items: AUD.slice(0, 4).map(function (r) {
              return { time: new Date(r.at).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', hour12: true }), title: r.who, line1: r.what, line2: r.role };
            }),
            empty: 'Actions you take appear here'
          }
        };
      }

      case 'registration':
        return {
          greet: 'Welcome back, ' + first(person.name) + '!',
          kpis: [
            { label: 'Registered patients', value: String(P.length), delta: 'Complete demographic records', icon: 'users' },
            { label: 'Inpatients', value: String(inpatients), delta: 'Admission paperwork required', icon: 'bed' },
            { label: 'Outpatients', value: String(outpatients), delta: 'Same-day registration', icon: 'walk' },
            { label: 'Awaiting admission', value: String(waiting), delta: 'Bed or clearance pending', icon: 'clock' }
          ],
          table: {
            title: 'Recent registrations', sub: 'Newest patient records created at the desk',
            cols: [{ t: 'PATIENT', left: 20, w: 130 }, { t: 'TYPE', left: 151, w: 85 }, { t: 'DEPARTMENT', left: 283, w: 125 }, { t: 'DOCTOR', left: 440, w: 85 }, { t: 'TIME', left: 591, w: 85 }, { t: 'STATUS', left: 712, w: 85 }],
            rows: P.map(function (p) {
              return { cells: [[p.name, p.id + ' \u00b7 ' + p.age + ' yrs'], [p.type, HIS.statusClass[p.type]], p.dept, p.doctor, (p.registered.split('\u00b7')[1] || '').trim(), [p.status, HIS.statusClass[p.status]]] };
            }),
            empty: 'No patients registered'
          },
          feed: {
            title: 'Admission queue', sub: 'Patients waiting for a bed', icon: 'bed',
            items: P.filter(function (p) { return p.status === 'Waiting' || p.status === 'Admitted'; }).slice(0, 4).map(function (p) {
              return { time: p.id.replace('PT-', ''), title: p.name, line1: p.dept + ' \u00b7 ' + p.doctor, line2: p.type + ' \u00b7 ' + p.age + ' yrs', status: p.status, kind: HIS.statusClass[p.status] || 'off' };
            }),
            empty: 'Nobody is waiting'
          }
        };

      case 'doctor': {
        var mine = P.filter(function (p) { return p.doctor === person.name; });
        return {
          greet: 'Welcome back, Dr. ' + first(person.name) + '!',
          kpis: [
            { label: 'My patients', value: String(mine.length), delta: mine.length ? 'Assigned to you' : 'No patients assigned', icon: 'users' },
            { label: 'In consultation', value: String(count(P, function (p) { return p.status === 'In Consultation'; })), delta: 'Across the clinic today', icon: 'clipboard-plus' },
            { label: 'Follow-ups due', value: String(count(T, function (t) { return /follow|review/i.test(t.sub || ''); })), delta: 'From treatment plans', icon: 'calendar-check' },
            { label: 'Plans active', value: String(T.length), delta: 'Treatment plans on file', icon: 'bag' }
          ],
          table: {
            title: 'Consultation queue', sub: 'Patients waiting to be seen',
            cols: [{ t: 'PATIENT', left: 20, w: 130 }, { t: 'TYPE', left: 151, w: 85 }, { t: 'DEPARTMENT', left: 283, w: 125 }, { t: 'DOCTOR', left: 440, w: 85 }, { t: 'TIME', left: 591, w: 85 }, { t: 'STATUS', left: 712, w: 85 }],
            rows: P.map(function (p) {
              return { cells: [[p.name, p.id + ' \u00b7 ' + p.age + ' yrs'], [p.type, HIS.statusClass[p.type]], p.dept, p.doctor, (p.registered.split('\u00b7')[1] || '').trim(), [p.status, HIS.statusClass[p.status]]] };
            }),
            empty: 'The queue is empty'
          },
          feed: {
            title: "Today's schedule", sub: 'Your upcoming appointments', icon: 'calendar-check',
            items: (HIS.schedule || []).slice(0, 4).map(function (s) {
              return { time: s.time, title: s.name, line1: s.what, line2: s.doctor, status: s.status, kind: HIS.statusClass[s.status] || 'off' };
            }),
            empty: 'Nothing booked'
          }
        };
      }

      case 'nurse':
        return {
          greet: 'Welcome back, ' + first(person.name) + '!',
          kpis: [
            { label: 'Assigned patients', value: String(N.length), delta: 'Across all wards', icon: 'users' },
            { label: 'Vitals due', value: String(N.length), delta: 'Next round on the ward board', icon: 'heart' },
            { label: 'Medications due', value: String(N.reduce(function (s, p) { return s + ((p.rec && p.rec.meds) || []).filter(function (m) { return /Due/i.test(m[1]); }).length; }, 0)), delta: 'Scheduled doses not yet given', icon: 'pill' },
            { label: 'Wards covered', value: String(new Set(N.map(function (p) { return p.ward; })).size), delta: 'Nursing assignments today', icon: 'bed' }
          ],
          table: {
            title: 'Assigned patients', sub: 'Ward, bed and next observation',
            cols: [{ t: 'PATIENT', left: 20, w: 170 }, { t: 'WARD', left: 200, w: 120 }, { t: 'BED', left: 330, w: 100 }, { t: 'NEXT VITALS', left: 440, w: 120 }, { t: 'STATUS', left: 712, w: 85 }],
            rows: N.map(function (p) {
              var due = ((p.rec && p.rec.meds) || []).filter(function (m) { return /Due/i.test(m[1]); }).length;
              return { cells: [[p.name, p.id], p.ward, p.bed, p.next, [due ? due + ' meds due' : 'On track', due ? 'in' : 'ok']] };
            }),
            empty: 'No patients assigned'
          },
          feed: {
            title: 'Medication schedule', sub: 'Next doses on your shift', icon: 'pill',
            items: N.slice(0, 4).map(function (p) {
              return { time: p.next, title: p.name, line1: p.ward + ' \u00b7 ' + p.bed, line2: 'Next observation round', status: 'Due', kind: 'in' };
            }),
            empty: 'No doses scheduled'
          }
        };

      case 'pharmacist': {
        // Read the pharmacy store, not the treatment plans: the queue the pharmacist works from is
        // the prescription list, and stock is the batch table.
        var rxAll = HIS.pharmacy ? HIS.pharmacy.rx() : [];
        var rxPending = rxAll.filter(function (r) { return r.status === 'Pending'; });
        var rxReady = rxAll.filter(function (r) { return r.status === 'Verified' || r.status === 'Partial'; });
        var low = HIS.pharmacy ? HIS.pharmacy.lowStock() : [];
        var soon = HIS.pharmacy ? HIS.pharmacy.nearExpiry() : [];
        return {
          greet: 'Welcome back, ' + first(person.name) + '!',
          kpis: [
            { label: 'To verify', value: String(rxPending.length), delta: 'Prescriptions waiting', icon: 'pill' },
            { label: 'Ready to dispense', value: String(rxReady.length), delta: 'Verified, not yet given', icon: 'bag' },
            { label: 'Low stock', value: String(low.length), delta: 'At or below reorder level', icon: 'branches' },
            { label: 'Expiring soon', value: String(soon.length), delta: 'Batches within 90 days', icon: 'clock' }
          ],
          table: {
            title: 'Dispensing queue', sub: 'Prescriptions in the order they were raised',
            cols: [{ t: 'PATIENT', left: 20, w: 170 }, { t: 'MEDICATION', left: 200, w: 240 }, { t: 'QUANTITY', left: 450, w: 150 }, { t: 'STATUS', left: 712, w: 85 }],
            rows: rxAll.slice(0, 6).map(function (r) {
              return { cells: [[ptName(r.patientId), r.id], r.drug + (r.dosage ? ' \u00b7 ' + r.dosage : ''), r.qty + ' ' + r.unit, [r.status, r.status === 'Dispensed' ? 'ok' : (r.status === 'Rejected' ? 'off' : 'in')]] };
            }),
            empty: 'No prescriptions raised yet'
          },
          feed: {
            title: 'Stock watch', sub: 'Items at or below their reorder level', icon: 'bag',
            items: low.slice(0, 4).map(function (r) {
              return { time: r.qty + ' ' + r.unit, title: r.drug, line1: 'Reorder at ' + r.reorder + ' ' + r.unit, line2: r.expired ? r.expired + ' ' + r.unit + ' expired' : 'All batches in date' };
            }),
            empty: 'Every item is above its reorder level'
          }
        };
      }

      case 'lab': {
        // Every figure here is a count of laboratory records by status. The screen previously
        // reported treatment-plan procedures and printed "Not modelled yet" against the two cards
        // that matter most to this role; the module has existed since M6.
        var orders = HIS.lab ? HIS.lab.all() : [];
        var awaiting = orders.filter(function (o) { return o.status === 'Ordered'; });
        var running = orders.filter(function (o) { return o.status === 'Collected' || o.status === 'In Process'; });
        var toValidate = orders.filter(function (o) { return o.status === 'Resulted'; });
        var validated = orders.filter(function (o) { return o.status === 'Validated'; });
        var critical = orders.filter(function (o) { return o.result && o.result.flag === 'Critical' && !o.criticalAck && o.status !== 'Cancelled'; });
        return {
          greet: 'Welcome back, ' + first(person.name) + '!',
          kpis: [
            { label: 'Awaiting collection', value: String(awaiting.length), delta: 'Specimen not yet taken', icon: 'clipboard-plus' },
            { label: 'In process', value: String(running.length), delta: 'Collected or running', icon: 'flask' },
            { label: 'Awaiting validation', value: String(toValidate.length), delta: 'Resulted, not released', icon: 'clock' },
            { label: 'Validated results', value: String(validated.length), delta: 'Released to the record', icon: 'check-circle' }
          ],
          table: {
            title: 'Laboratory orders', sub: 'Every order on file, newest first',
            cols: [{ t: 'PATIENT', left: 20, w: 170 }, { t: 'TEST', left: 200, w: 240 }, { t: 'PRIORITY', left: 450, w: 150 }, { t: 'STATUS', left: 712, w: 85 }],
            rows: orders.slice(0, 6).map(function (o) {
              var kind = o.status === 'Validated' ? 'ok' : (o.status === 'Cancelled' ? 'off' : (o.status === 'Resulted' ? 'in' : 'warn'));
              return { cells: [[ptName(o.patientId), o.id], o.test, o.priority, [o.status, kind]] };
            }),
            empty: 'No laboratory orders on file'
          },
          feed: {
            title: 'Critical results', sub: 'Flagged on release, awaiting acknowledgement', icon: 'bell',
            items: critical.slice(0, 4).map(function (o) {
              return { time: o.result.value + ' ' + (o.result.unit || ''), title: o.test, line1: ptName(o.patientId), line2: 'Reference ' + (o.result.reference || '\u2014') };
            }),
            empty: critical.length ? '' : 'No critical result is waiting for acknowledgement'
          }
        };
      }

      case 'finance': {
        var rate = billed ? Math.round((collected / billed) * 100) : 0;
        var byType = {};
        B.forEach(function (b) { var k = b.type || 'Unspecified'; byType[k] = byType[k] || { n: 0, billed: 0, paid: 0 }; byType[k].n++; byType[k].billed += b.amount; byType[k].paid += paidOf(b); });
        return {
          greet: 'Financial overview',
          kpis: [
            { label: 'Total billed', value: money(billed), delta: B.length + ' invoices in the ledger', icon: 'receipt' },
            { label: 'Collected', value: money(collected), delta: rate + '% collection rate', icon: 'peso' },
            { label: 'Outstanding', value: money(outstanding), delta: openBills.length + ' invoices open', icon: 'clock' },
            { label: 'Average invoice', value: money(B.length ? Math.round(billed / B.length) : 0), delta: 'Per invoice', icon: 'chart' }
          ],
          table: {
            title: 'Collection by invoice type', sub: 'Billed, collected and balance',
            cols: [{ t: 'TYPE', left: 20, w: 200 }, { t: 'COUNT', left: 240, w: 100 }, { t: 'BILLED', left: 360, w: 130 }, { t: 'COLLECTED', left: 500, w: 130 }, { t: 'BALANCE', left: 640, w: 130 }],
            rows: Object.keys(byType).map(function (k) {
              var t = byType[k];
              return { cells: [[k, t.n + ' invoices'], String(t.n), money(t.billed), money(t.paid), money(t.billed - t.paid)] };
            }),
            empty: 'No invoices on file'
          },
          feed: {
            title: 'Reconciliation', sub: 'Largest open balances', icon: 'chart',
            items: openBills.slice(0, 4).map(function (b) {
              return { time: money(balOf(b)), title: b.name, line1: b.id + ' \u00b7 ' + b.dept, line2: b.date, status: 'Open', kind: 'in' };
            }),
            empty: 'Everything is settled'
          }
        };
      }

      case 'hr':
        return {
          greet: 'Welcome back, ' + first(person.name) + '!',
          kpis: [
            { label: 'Headcount', value: String(S.length), delta: count(S, function (s) { return s.status === 'Active'; }) + ' active staff', icon: 'users' },
            { label: 'Payroll records', value: String(E.length), delta: ((HIS.payroll || {}).period) || 'Current period', icon: 'peso' },
            { label: 'Paid', value: String(count(E, function (e) { return e.status === 'Paid'; })), delta: count(E, function (e) { return e.status !== 'Paid'; }) + ' still processing', icon: 'check-circle' },
            { label: 'Departments', value: String(new Set(S.map(function (s) { return s.dept; })).size), delta: 'With staff on file', icon: 'branches' }
          ],
          table: {
            title: 'Employees', sub: 'Personnel records and payroll status',
            cols: [{ t: 'EMPLOYEE', left: 20, w: 170 }, { t: 'ROLE', left: 200, w: 170 }, { t: 'DEPARTMENT', left: 380, w: 130 }, { t: 'DAYS', left: 520, w: 80 }, { t: 'STATUS', left: 712, w: 85 }],
            rows: E.map(function (e) {
              return { cells: [[e.name, e.id], e.role, e.dept, String(e.days), [e.status, e.status === 'Paid' ? 'ok' : (e.status === 'Processing' ? 'in' : 'off')]] };
            }),
            empty: 'No employees on file'
          },
          feed: {
            title: 'Payroll actions', sub: 'Period ' + (((HIS.payroll || {}).period) || '\u2014'), icon: 'peso',
            items: E.filter(function (e) { return e.status !== 'Paid'; }).slice(0, 4).map(function (e) {
              return { time: e.id.replace('EMP-', ''), title: e.name, line1: e.dept + ' \u00b7 ' + e.role, line2: e.days + ' days \u00b7 ' + e.hours + ' hours', status: e.status, kind: 'in' };
            }),
            empty: 'All payroll records are paid'
          }
        };

      case 'depthead': {
        var myDept = person.dept;
        var d = depts().filter(function (x) { return x.name === myDept; })[0] || depts()[0] || {};
        var deptStaff = S.filter(function (s) { return s.dept === myDept; });
        var deptPts = P.filter(function (p) { return p.dept === myDept; });
        return {
          greet: 'Welcome back, Dr. ' + first(person.name) + '!',
          kpis: [
            { label: 'Department', value: myDept || '\u2014', delta: (d.head || 'No head assigned'), icon: 'branches' },
            { label: 'Patients today', value: String(deptPts.length), delta: 'Registered in this department', icon: 'users' },
            { label: 'Staff on file', value: String(deptStaff.length), delta: (d.doctors || 0) + ' doctors \u00b7 ' + (d.nurses || 0) + ' nurses', icon: 'id' },
            { label: 'Bed occupancy', value: (d.pct != null ? d.pct + '%' : '\u2014'), delta: (d.occ || 0) + ' of ' + (d.beds || 0) + ' beds', icon: 'bed' }
          ],
          table: {
            title: 'Department staff', sub: 'People reporting into ' + (myDept || 'this department'),
            cols: [{ t: 'EMPLOYEE', left: 20, w: 170 }, { t: 'ROLE', left: 200, w: 170 }, { t: 'DEPARTMENT', left: 380, w: 130 }, { t: 'JOINED', left: 520, w: 110 }, { t: 'STATUS', left: 712, w: 85 }],
            rows: deptStaff.map(function (s) {
              return { cells: [[s.name, s.id], s.role, s.dept, s.joined || '\u2014', [s.status, s.status === 'Active' ? 'ok' : 'off']] };
            }),
            empty: 'No staff in this department'
          },
          feed: {
            title: 'Department workload', sub: 'Patients by status', icon: 'chart',
            items: deptPts.slice(0, 4).map(function (p) {
              return { time: p.id.replace('PT-', ''), title: p.name, line1: p.doctor, line2: p.type + ' \u00b7 ' + p.age + ' yrs', status: p.status, kind: HIS.statusClass[p.status] || 'off' };
            }),
            empty: 'No patients in this department'
          }
        };
      }

      case 'auditor': {
        var kinds = { financial: 0, clinical: 0, admin: 0 };
        AUD.forEach(function (r) {
          var s = (r.what || '').toLowerCase(), e = (r.entity || '').toLowerCase();
          if (e.indexOf('bill') > -1 || e.indexOf('account') > -1 || s.indexOf('payment') > -1) kinds.financial++;
          else if (e.indexOf('patient') > -1 || e.indexOf('consult') > -1) kinds.clinical++;
          else kinds.admin++;
        });
        return {
          greet: 'Compliance overview',
          kpis: [
            { label: 'Audit entries', value: String(AUD.length), delta: AUD.length ? 'Newest #' + AUD[0].seq : 'Nothing recorded yet', icon: 'shield' },
            { label: 'Financial changes', value: String(kinds.financial), delta: 'Payments and accounts', icon: 'receipt' },
            { label: 'Clinical changes', value: String(kinds.clinical), delta: 'Patient and consultation records', icon: 'clipboard-plus' },
            { label: 'Administrative', value: String(kinds.admin), delta: 'Sessions and configuration', icon: 'id' }
          ],
          table: {
            title: 'Recent activity', sub: 'Newest first, read-only',
            cols: [{ t: '#', left: 20, w: 50 }, { t: 'WHO', left: 80, w: 150 }, { t: 'ROLE', left: 240, w: 150 }, { t: 'ACTION', left: 400, w: 300 }, { t: 'WHEN', left: 712, w: 120 }],
            rows: AUD.slice(0, 6).map(function (r) {
              return { cells: [[r.who, '#' + r.seq], r.role, r.what, new Date(r.at).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })] };
            }),
            empty: 'No audit entries yet'
          },
          feed: {
            title: 'Change trail', sub: 'Before \u2192 after', icon: 'shield',
            items: AUD.slice(0, 4).map(function (r) {
              return { time: '#' + r.seq, title: r.who, line1: r.what, line2: (r.before == null ? '\u2014' : r.before) + ' \u2192 ' + (r.after == null ? '\u2014' : r.after), status: 'Logged', kind: 'ok' };
            }),
            empty: 'Nothing recorded yet'
          }
        };
      }

      case 'patient': {
        var pid = (HIS.auth.account() || {}).patientId;
        var me = P.filter(function (p) { return p.id === pid; })[0] || {};
        var myBills = B.filter(function (b) { return b.pt === pid; });
        var owed = myBills.reduce(function (s, b) { return s + HIS.ledger.balanceOf(b); }, 0);
        return {
          greet: 'Welcome back, ' + first(person.name) + '!',
          kpis: [
            { label: 'My patient ID', value: pid || '\u2014', delta: me.dept || 'Not linked', icon: 'id' },
            { label: 'Appointments', value: String(A.length), delta: 'Scheduled visits', icon: 'calendar-check' },
            { label: 'Balance due', value: money(owed), delta: myBills.length + ' statement(s) on file', icon: 'receipt' },
            { label: 'Status', value: me.status || '\u2014', delta: me.type || 'Patient record', icon: 'heart' }
          ],
          table: {
            title: 'My appointments', sub: 'Scheduled and completed visits',
            cols: [{ t: 'WHEN', left: 20, w: 170 }, { t: 'TYPE', left: 200, w: 200 }, { t: 'DOCTOR', left: 420, w: 180 }, { t: 'STATUS', left: 712, w: 85 }],
            rows: A.map(function (a) {
              return { cells: [[a.patient, a.when], a.kind, a.doctor, [a.status, HIS.statusClass[a.status] || 'off']] };
            }),
            empty: 'No appointments booked'
          },
          feed: {
            title: 'My billing', sub: 'Statements and balances', icon: 'receipt',
            items: myBills.map(function (b) {
              var p = paidOf(b);
              return { time: money(b.amount - p), title: b.id, line1: b.date, line2: 'Paid ' + money(p) + ' of ' + money(b.amount), status: p >= b.amount ? 'Paid' : 'Balance', kind: p >= b.amount ? 'ok' : 'in' };
            }),
            empty: 'No statements on file'
          }
        };
      }

      default:
        return null;
    }
  }

  // ---- mount --------------------------------------------------------------
  var role = HIS.rbac.key();
  var person = HIS.rbac.person();
  var cfg = build(role, person);
  var stage = document.querySelector('.stage');

  if (!cfg) {
    stage.innerHTML = "<h1 class='dash-title'>Dashboard</h1>";
    return;
  }
  stage.innerHTML =
    "<h1 class='dash-title' id='welcome'>" + esc(cfg.greet) + '</h1>' +
    "<div id='kpis'>" + kpiCards(cfg.kpis) + '</div>' +
    tablePanel(cfg.table) +
    feedPanel(cfg.feed);
})();
