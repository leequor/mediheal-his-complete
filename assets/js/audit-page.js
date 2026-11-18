// Audit log (M2). Addition (not in Figma) - docs/IMPROVEMENT-PLAN.md lists a dedicated audit
// screen under "Blocked on new Figma frames"; this builds it in the design format instead.
// Read-only view over HIS.audit (`mh_audit`), newest first. Times are rendered in Asia/Manila,
// the hospital's operating timezone.
(function () {
  var stage = document.getElementById('stage');
  var esc = HIS.kit.esc;
  var list = [];
  var q = '', type = 'all';

  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '\u2014';
    try {
      return d.toLocaleString('en-PH', {
        timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
      });
    } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }

  // Group the free-text `what` into the filter buckets shown in the toolbar.
  function kind(r) {
    var s = (r.what || '').toLowerCase(), e = (r.entity || '').toLowerCase();
    if (s.indexOf('role') > -1 || e === 'session') return 'role';
    if (e.indexOf('pay') > -1 || s.indexOf('payroll') > -1) return 'payroll';
    if (e.indexOf('bill') > -1 || s.indexOf('payment') > -1 || s.indexOf('invoice') > -1) return 'billing';
    if (e.indexOf('patient') > -1 || s.indexOf('registration') > -1) return 'registration';
    if (e.indexOf('consult') > -1 || s.indexOf('diagnos') > -1 || s.indexOf('prescri') > -1) return 'clinical';
    return 'other';
  }
  var KINDS = [['all', 'All activity'], ['role', 'Role changes'], ['billing', 'Billing'], ['payroll', 'Payroll'], ['registration', 'Registration'], ['clinical', 'Clinical'], ['other', 'Other']];

  function change(r) {
    if (r.before == null && r.after == null) return '<span class="mu">\u2014</span>';
    var b = r.before == null ? '\u2014' : String(r.before);
    var a = r.after == null ? '\u2014' : String(r.after);
    return "<span class='ad-arrow'><span>" + esc(b) + "</span><span class='to'>\u2192</span><span>" + esc(a) + '</span></span>';
  }

  function rows() {
    var needle = q.trim().toLowerCase();
    return list.filter(function (r) {
      if (type !== 'all' && kind(r) !== type) return false;
      if (!needle) return true;
      return [r.who, r.role, r.what, r.entity, r.before, r.after].join(' ').toLowerCase().indexOf(needle) > -1;
    });
  }

  function render() {
    var r = rows();
    var canClear = HIS.rbac && HIS.rbac.key() === 'superadmin';
    stage.innerHTML =
      "<h1 class='ad-title'>Audit log</h1>" +
      "<p class='ad-sub'>Every recorded change, newest first. Read-only for auditors.</p>" +
      "<div class='ad-body'>" +
      "<div class='ad-card'>" +
      "<div class='ad-bar'>" +
      "<h2>Activity</h2>" +
      "<span class='ad-count' id='adCount'>" + r.length + ' of ' + list.length + ' entries</span>' +
      "<label class='ad-search'>" + svg('search', 16) + "<input id='adQ' type='search' placeholder='Search who, action, entity' aria-label='Search audit entries' value='" + esc(q) + "'></label>" +
      "<select class='ad-sel' id='adType' aria-label='Filter by activity type'>" +
      KINDS.map(function (k) { return "<option value='" + k[0] + "'" + (type === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') +
      '</select>' +
      "<button class='ad-btn' id='adCsv' type='button'>Export CSV</button>" +
      (canClear ? "<button class='ad-btn' id='adClear' type='button'>Clear log</button>" : '') +
      '</div>' +
      "<div class='ad-th ad-g-audit'><span>#</span><span>When</span><span>Who</span><span>Role</span><span>Action</span><span>Change</span></div>" +
      (r.length
        ? r.map(function (x) {
          return "<div class='ad-tr ad-g-audit'><span class='seq'>" + x.seq + '</span>' +
            "<span class='mu'>" + esc(when(x.at)) + '</span>' +
            '<b>' + esc(x.who) + '</b>' +
            "<span class='mu'>" + esc(x.role) + '</span>' +
            '<span>' + esc(x.what) + '</span>' +
            '<span>' + change(x) + '</span></div>';
        }).join('')
        : "<div class='ad-empty'><b>No audit entries yet</b>Sign in as another role, or record a payment in Billing, and the change appears here.</div>") +
      '</div>' +
      "<div class='ad-note'><b>About this log.</b> Entries are held in this browser only and never leave the device. " +
      'The log is not tamper-evident and is not a substitute for a compliance audit trail.</div>' +
      '</div>';

    document.getElementById('adQ').oninput = function (e) {
      q = e.target.value;
      render();
      var f = document.getElementById('adQ');
      f.focus();
      f.setSelectionRange(f.value.length, f.value.length);
    };
    document.getElementById('adType').onchange = function (e) { type = e.target.value; render(); };
    document.getElementById('adCsv').onclick = exportCsv;
    var cl = document.getElementById('adClear');
    if (cl) cl.onclick = clearLog;
  }

  function exportCsv() {
    var r = rows();
    if (!r.length) { HIS.kit.toast('Nothing to export for this filter.'); return; }
    var head = ['seq', 'when_manila', 'who', 'role', 'action', 'entity', 'before', 'after'];
    var cell = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var csv = [head.join(',')].concat(r.map(function (x) {
      return [x.seq, when(x.at), x.who, x.role, x.what, x.entity, x.before, x.after].map(cell).join(',');
    })).join('\r\n');
    var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    var a = document.createElement('a');
    a.href = url; a.download = 'mediheal-audit-log.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    HIS.kit.toast('Exported ' + r.length + ' entries as CSV.');
  }

  function clearLog() {
    HIS.kit.modal({
      title: 'Clear the audit log?',
      sub: 'Removes all ' + list.length + ' entries stored in this browser. This cannot be undone.',
      body: "<p style='margin:12px 0 0;color:#6f8890;font-size:13px'>Only the audit log is cleared. No patient, billing or payroll record is touched.</p>",
      saveLabel: 'Clear log',
      onSave: function () {
        HIS.audit.clear();
        list = [];
        render();
        HIS.kit.toast('Audit log cleared.');
      }
    });
  }

  function load() { list = HIS.audit.list().slice().sort(function (a, b) { return b.seq - a.seq; }); }
  load();
  render();
  // Pick up entries appended elsewhere while this page stays open (e.g. a role switch in another tab).
  var last = list.length;
  setInterval(function () { var n = HIS.audit.list().length; if (n !== last) { last = n; load(); render(); } }, 1200);
})();
