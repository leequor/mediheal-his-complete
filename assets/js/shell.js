// Shared header + slide-in sidebar. Edit the nav in rbac.js (one place), every page updates.
// Figma: header-bar 239:2978, Sidebar 211:1949 (430x1024). Staff (211:1953) links to Attendance (2002:369).
// Fit-to-width (assets/js/fit.js v3, session 22) is loaded from here so every shell page gets it; index.html (sign-in) loads it itself. No effect at 1440px and wider.
// M1: the drawer renders HIS.rbac.nav() (role-scoped) and the header identity comes from
// HIS.rbac.person(). For the default role both are identical to the previous hardcoded values,
// so the resting appearance is unchanged.
(function () { var s = document.createElement('script'); s.src = 'assets/js/fit.js'; document.head.appendChild(s); })();

// ---- Identity avatars ---------------------------------------------------------------------------
// One photograph was previously shown for every account, which made six different people look like
// the same person. The header, the account menu and any list that names a person now draw initials
// instead, tinted from a fixed six-colour palette keyed on a stable string (the account email), so
// the same person keeps the same colour everywhere and two people never share one.
(function () {
  var TINTS = [
    ['#dff0f8', '#1b4e6b'], ['#dbeafe', '#1d4ed8'], ['#d1fae5', '#0a7355'],
    ['#fef3c7', '#92610a'], ['#fee2e2', '#9b1c14'], ['#ede9fe', '#5b21b6']
  ];
  function initials(name) {
    var clean = String(name || '').replace(/^(Dr|Atty|Ms|Mr|Mrs)\.?\s+/i, '').trim();
    if (!clean) return '';
    var parts = clean.split(/\s+/).filter(function (w) { return /[A-Za-z]/.test(w[0]); });
    if (!parts.length) return clean[0].toUpperCase();
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function tint(seed) {
    var s = String(seed || ''), h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return TINTS[h % TINTS.length];
  }
  // A coloured disc carrying the initials. `size` in px; `label` names the person for a screen reader.
  // line-height is set to the disc height on purpose: that is what centres the letters optically
  // (see the .av-d comment in base.css), so every size gets a correct avatar without per-size CSS.
  function disc(name, seed, size, label) {
    var t = tint(seed || name), n = initials(name), d = size || 42;
    return "<span class='av-d' role='img' aria-label='" + (label || name || 'Account') +
      "' style='width:" + d + 'px;height:' + d + 'px;border-radius:' + (d / 2) + 'px;line-height:' + d +
      'px;background:' + t[0] + ';color:' + t[1] + ';font-size:' + Math.max(11, Math.round(d * 0.36)) +
      "px'>" + (n || '?') + '</span>';
  }
  window.HIS.avatar = { initials: initials, tint: tint, disc: disc };
})();

(function mountShell() {
  const page = document.body.dataset.page;
  if (!page) return;
  // Page-level role guard (M1). Redirects out before anything renders when the active role
  // cannot open this page. Demo-only: it is browser-side and not a security boundary.
  if (window.HIS.rbac && !HIS.rbac.guard()) return;
  // favicon: stops the /favicon.ico 404 on every page (small logo PNG)
  if (!document.querySelector('link[rel~="icon"]')) document.head.insertAdjacentHTML('beforeend', "<link rel='icon' type='image/png' href='assets/img/logo-mark.png'>");
  const u = HIS.rbac ? HIS.rbac.person() : HIS.user;
  const navGroups = HIS.rbac ? HIS.rbac.navGroups() : [{ group: 'Menu', items: NAV }];
  const acct = HIS.auth && HIS.auth.account ? HIS.auth.account() : null;
  const av = HIS.avatar.disc(u.name, (acct && acct.email) || u.name, 42, u.name);
  document.body.insertAdjacentHTML('afterbegin',
    "<header class='header'><div class='hd'>" +
    "<button class='burger' id='burger' aria-label='Open menu' aria-expanded='false'><i></i><i></i><i></i></button>" +
    "<img class='logo' src='assets/img/logo-large.png' data-fallback='assets/img/logo-mark.png' alt=''>" +
    "<span class='brand'>MediHeal</span>" +
    "<div class='hd-date'>" + svg('calendar', 18) + '<span>' + HIS.fmtShort(HIS.today) + '</span></div>' +
    "<button class='bell' aria-label='Notifications'>" + svg('bell', 20) + '<b style="display:none"></b></button>' +
    "<div class='sep'></div>" +
    "<div class='profile' id='profile' role='button' tabindex='0' aria-haspopup='dialog' aria-expanded='false' aria-label='Account: " + u.name + ", " + u.title + "'>" +
    av + "<div><div class='nm'>" + u.name + '</div><small>' + u.title.toUpperCase() + '</small></div></div>' +
    '</div></header>' +
    "<div class='scrim' id='scrim'></div>" +
    "<aside class='drawer' id='drawer' aria-label='Main menu'><div class='dr-in'>" +
    "<div class='dr-top'>" +
    "<img class='dr-logo' src='assets/img/logo-mark.png' alt=''>" +
    "<div class='dr-brand-tx'><b>MediHeal</b><span>Hospital information system</span></div>" +
    "<button class='dr-x' id='drClose' type='button' aria-label='Close menu'>\u2715</button>" +
    '</div>' +
    "<div class='dr-role'><span>Signed in as</span><b>" + u.name + '</b><i>' + (HIS.rbac ? HIS.rbac.current().label : '') + '</i></div>' +
    '<nav>' + navGroups.map(function (g) {
      var head = navGroups.length > 1 ? "<div class='dr-g'>" + g.group + '</div>' : '';
      return head + g.items.map(function (n) {
        var on = n[0] === HIS.rbac.stem() ? " class='on' aria-current='page'" : '';
        return "<a href='" + n[0] + ".html'" + on + '>' + svg(n[2], 19) + '<span>' + n[1] + '</span></a>';
      }).join('');
    }).join('') + '</nav>' +
    "<div class='dr-foot'>" +
    "<a class='dr-out' id='drOut' href='index.html'>" + svg('exit', 17) + 'Sign out</a>' +
    "<div class='dr-contact'>" + HIS.contact.email + '<br>' + HIS.contact.phone + '</div>' +
    '</div>' +
    '</div></aside>');
  document.querySelectorAll('img[data-fallback]').forEach(i => i.addEventListener('error', () => { i.src = i.dataset.fallback; }, { once: true }));
  document.querySelectorAll('img[data-hide]').forEach(i => i.addEventListener('error', () => i.remove(), { once: true }));
  const toggle = open => {
    document.body.classList.toggle('menu-open', open);
    const b = document.getElementById('burger');
    if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  document.getElementById('burger').onclick = () => toggle(true);
  document.getElementById('scrim').onclick = () => toggle(false);
  const drx = document.getElementById('drClose');
  if (drx) drx.onclick = () => toggle(false);
  document.addEventListener('keydown', e => e.key === 'Escape' && toggle(false));
  // Sign out clears the demo session before leaving, so Back cannot reveal a protected page.
  ['drExit', 'drOut'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', e => { e.preventDefault(); HIS.auth.signOut(); location.replace('index.html'); });
  });
})();

// ---- Account menu (M3, Addition - not in Figma).
// Replaces the M1 role switcher. There is NO role selection anywhere in the signed-in UI: the
// account decides the role. The menu shows who you are and offers sign-out, plus a link to account
// management for the Super Administrator only. It opens from the existing header profile block, so
// no new element is added to the locked header.
(function accountMenu() {
  if (!window.HIS.rbac) return;
  const prof = document.getElementById('profile');
  if (!prof) return;
  const hd = document.querySelector('.hd');
  const css = document.createElement('style');
  css.textContent =
    '.profile{cursor:pointer}' +
    '.profile:focus-visible{outline:2px solid #dff9ff;outline-offset:3px;border-radius:10px}' +
    '.am-m{position:absolute;top:74px;right:16px;width:340px;display:none;flex-direction:column;background:#fff;border-radius:14px;box-shadow:inset 0 0 0 1px #c8dcea,0 12px 32px rgba(15,30,46,.18);z-index:24;overflow:hidden;font-family:Inter,sans-serif}' +
    '.am-m.on{display:flex}' +
    '.am-m *{box-sizing:border-box}' +
    '.am-id{display:flex;gap:12px;align-items:center;padding:18px 20px 14px}' +
    '.am-av{width:44px;height:44px;flex:none;border-radius:22px;background:#dff9ff;color:#1b4e6b;display:grid;place-items:center;font:700 15px Inter,sans-serif}' +
    '.am-nm{font:600 14px/18px Inter,sans-serif;color:#1c2b30;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.am-ti{font:400 12px/15.6px Inter,sans-serif;color:#6f8890;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.am-rows{padding:0 20px 14px}' +
    '.am-r{display:flex;justify-content:space-between;gap:12px;padding:5px 0;font:400 12px/16px Inter,sans-serif}' +
    '.am-r span{color:#6f8890}.am-r b{font-weight:600;color:#1c2b30;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.am-a{display:block;width:100%;padding:11px 20px;border:0;border-top:1px solid #e3edf3;background:#fff;text-align:left;font:600 13px/17px Inter,sans-serif;color:#1b4e6b;cursor:pointer;text-decoration:none}' +
    '.am-a:hover{background:#e8f4fb}' +
    '.am-a.out{color:#9b1c14}' +
    '.am-f{padding:9px 20px;border-top:1px solid #e3edf3;background:#f6fafd;font:500 11px/14.3px Inter,sans-serif;color:#8a97a6}';
  document.head.appendChild(css);

  const panel = document.createElement('div');
  panel.className = 'am-m';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Account menu');
  hd.appendChild(panel);

  function render() {
    const a = HIS.auth.account();
    if (!a) return;
    const r = HIS.rbac.ROLES[a.role] || { label: a.role };
    panel.innerHTML =
      "<div class='am-id'>" + HIS.avatar.disc(a.name, a.email, 44, a.name) + '<div style="min-width:0">' +
      "<div class='am-nm'>" + HIS.kit.esc(a.name) + '</div>' +
      "<div class='am-ti'>" + HIS.kit.esc(a.title || r.label) + '</div></div></div>' +
      "<div class='am-rows'>" +
      "<div class='am-r'><span>Email</span><b>" + HIS.kit.esc(a.email) + '</b></div>' +
      "<div class='am-r'><span>Role</span><b>" + HIS.kit.esc(r.label) + '</b></div>' +
      (a.dept ? "<div class='am-r'><span>Department</span><b>" + HIS.kit.esc(a.dept) + '</b></div>' : '') +
      '</div>' +
      (a.role === 'superadmin' ? "<a class='am-a' href='accounts.html'>Manage accounts</a>" : '') +
      "<button class='am-a' data-act='reset'>Reset sample data</button>" +
      "<button class='am-a out' data-act='signout'>Sign out</button>" +
      "<div class='am-f'>Sample data \u00b7 all records fictitious</div>";
  }
  function setOpen(o) {
    panel.classList.toggle('on', o);
    prof.setAttribute('aria-expanded', o ? 'true' : 'false');
    if (o) { render(); const b = panel.querySelector('[data-act="signout"]'); if (b) b.focus(); }
  }
  prof.addEventListener('click', () => setOpen(!panel.classList.contains('on')));
  prof.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!panel.classList.contains('on')); } });
  panel.addEventListener('click', e => {
    const b = e.target.closest('[data-act="signout"]');
    if (b) {
      HIS.auth.signOut();
      location.replace('index.html');
      return;
    }
    const r = e.target.closest('[data-act="reset"]');
    if (r) { setOpen(false); resetDemo(); }
  });
  // A deliberate reset, so a visitor can hand the demonstration on in its original state without
  // having to sign out. Everything is local; nothing is sent anywhere.
  function resetDemo() {
    HIS.kit.modal({
      title: 'Reset sample data?',
      sub: 'Restores every record to its original state and discards anything changed in this session.',
      body: "<p style='margin:12px 0 0;color:#6f8890;font-size:13px'>You stay signed in. This cannot be undone.</p>",
      saveLabel: 'Reset data',
      onSave: function () {
        HIS.store.reset({ includeOwner: true });
        location.reload();
      }
    });
  }
  document.addEventListener('click', e => {
    if (!panel.classList.contains('on')) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(panel) < 0 && path.indexOf(prof) < 0) setOpen(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('on')) { setOpen(false); prof.focus(); } });
})();

// ---- Notifications panel. Figma: "Notifications panel" 2072:3499 (Dashboard "Notifications open" 2072:3112; the same panel is drawn on every page, e.g. overlay 2008:1064).
// Measured, frame-local: panel (952,90) 420x492 r16 white, stroke #c8dcea. Panel-local: title (24,20) Lexend 500 18 #1b4e6b; subtitle (24,46) Inter 12 #6f8890;
// close button (360,20) 36x36 r8 stroke #c8dcea, "\u2715" Inter 500 16 #1b4e6b; divider y68 h1 #e3edf3; rows x24, y84 + 86*i, 372x78 r10 fill #f6fafd stroke #e3edf3
// (dot (14,17) 8x8 #1c6d9c; title (32,12) Inter 600 #1c2b30; body (32,33) Inter 12 #6f8890; time (32,55) Inter 500 11 #5b8db8); "Mark all as read" (24,436) 372x40 r8 #1c6d9c.
// ESTIMATED (Figma draws only the all-unread 4-row state): shadow, the read look, "All caught up", the disabled button, hiding the badge at 0,
// and the panel height, which now follows the row count because the list is no longer a fixed four.
//
// THE LIST IS DERIVED, NOT STORED. Every row comes from the module that owns the fact — laboratory
// orders, pharmacy batches, unbilled charges, invoices, claims, admissions, appointments, leave — and
// only for roles that are allowed to act on it. A medical technologist is not told about payroll, and
// a cashier is not told about specimens. When a role has nothing outstanding the panel says so
// instead of inventing activity.
//
// Read state is keyed by role and by a stable row id, so switching account does not inherit another
// person's read marks. Esc, the close button or a click outside closes the panel. The outside-click
// test uses composedPath() because render() replaces the clicked button.
(function notifications() {
  const bell = document.querySelector('.bell');
  if (!bell) return;
  const stage = document.querySelector('.stage,#stage') || document.body;
  if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';

  const peso = n => (window.HIS.ledger && HIS.ledger.peso) ? HIS.ledger.peso(Math.round(n)) : '\u20b1' + Math.round(n);
  const today = () => (window.HIS.fmtShort && HIS.today) ? HIS.fmtShort(HIS.today) : '';

  // Each rule returns { title, body, meta } or null. Rules run in priority order; the panel shows the
  // first five that produce anything, so the most urgent work is always at the top.
  function build() {
    const a = window.HIS.auth && HIS.auth.account ? HIS.auth.account() : null;
    const role = a ? a.role : 'registration';
    const out = [];
    // title, body, meta, page, focus. `page` is where the work is; `focus` is the record id that
    // page will locate. A row without a page is informational only and is never rendered.
    const add = (title, body, meta, page, focus) =>
      out.push({ id: role + ':' + title, title: title, body: body, meta: meta, page: page, focus: focus || null });

    const lab = window.HIS.lab, ph = window.HIS.pharmacy, cl = window.HIS.claims,
      ad = window.HIS.admissions, ch = window.HIS.charges, bl = window.HIS.billing;
    const labRows = lab && lab.all ? lab.all() : [];
    const LAB = id => 'laboratory.html?focus=' + encodeURIComponent(id);

    const pending = labRows.filter(o => o.status === 'Ordered');
    const running = labRows.filter(o => o.status === 'Collected' || o.status === 'In Process');
    const toValidate = labRows.filter(o => o.status === 'Resulted');
    const released = labRows.filter(o => o.status === 'Validated');
    const critical = labRows.filter(o => o.result && o.result.flag === 'Critical' && !o.criticalAck && o.status !== 'Cancelled');

    const rxAll = ph && ph.rx ? ph.rx() : [];
    const rxPending = rxAll.filter(r => r.status === 'Pending');
    const rxReady = rxAll.filter(r => r.status === 'Verified' || r.status === 'Partial');
    const low = ph && ph.lowStock ? ph.lowStock() : [];
    const soon = ph && ph.nearExpiry ? ph.nearExpiry() : [];
    const RX = id => 'pharmacy.html?tab=rx&focus=' + encodeURIComponent(id);
    const STOCK = id => 'pharmacy.html?tab=stock&focus=' + encodeURIComponent(id);

    const unbilled = ch && ch.unbilled ? ch.unbilled() : [];
    const unbilledTotal = unbilled.reduce((s, c) => s + (c.amount || 0), 0);
    const bills = (bl && bl.bills) || [];
    const balOf = b => (b.amount || 0) - (window.HIS.ledger ? HIS.ledger.paidOf(b) + HIS.ledger.coveredOf(b) : b.paid || 0);
    const openBills = bills.filter(b => balOf(b) > 0.005);
    const outstanding = openBills.reduce((s, b) => s + balOf(b), 0);

    const claims = cl && cl.all ? cl.all() : [];
    const claimReview = claims.filter(c => c.status === 'Submitted' || c.status === 'Under review');
    const claimDenied = claims.filter(c => c.status === 'Denied' || c.status === 'Rejected');

    const adm = ad && ad.active ? ad.active() : [];
    const beds = ad && ad.occupancy ? ad.occupancy() : null;

    const appts = (window.HIS.appointments || []);
    const apptToday = appts.filter(x => today() && String(x.when).indexOf(today()) === 0);
    const apptPending = appts.filter(x => x.status === 'Pending');
    const apptConfirmed = appts.filter(x => x.status === 'Confirmed');

    const att = window.HIS.attendance;
    const leaves = (att && att.leaves) || [];
    const leavePending = leaves.filter(l => l.status === 'Pending');
    const emps = (att && att.emps) || [];
    const absent = emps.filter(e => e.status === 'Absent');
    const late = emps.filter(e => e.status === 'Late');

    const reqs = window.HIS.requests && HIS.requests.open ? HIS.requests.open() : [];

    const audit = window.HIS.audit && HIS.audit.list ? HIS.audit.list() : [];
    const voids = ch && ch.all ? ch.all().filter(c => c.status === 'void') : [];

    switch (role) {
      case 'lab':
        if (critical.length) add('Critical result awaiting acknowledgement',
          critical[0].test + ' \u00b7 ' + patientName(critical[0].patientId) + (critical.length > 1 ? ' and ' + (critical.length - 1) + ' more' : ''),
          'Flagged on release', LAB(critical[0].id), critical[0].id);
        if (toValidate.length) add('Results awaiting validation', toValidate.length + ' entered, not yet released', 'Laboratory', LAB(toValidate[0].id), toValidate[0].id);
        if (pending.length) add('Specimens awaiting collection', pending.length + ' order' + (pending.length === 1 ? '' : 's') + ' not yet collected', 'Laboratory', LAB(pending[0].id), pending[0].id);
        if (running.length) add('Tests in process', running.length + ' specimen' + (running.length === 1 ? '' : 's') + ' collected or running', 'Laboratory', LAB(running[0].id), running[0].id);
        if (released.length) add('Results released', released.length + ' report' + (released.length === 1 ? '' : 's') + ' visible to the care team', 'Laboratory', LAB(released[0].id), released[0].id);
        break;

      case 'pharmacist':
        if (rxPending.length) add('Prescriptions to verify', rxPending.length + ' waiting for a pharmacist', 'Pharmacy', RX(rxPending[0].id), rxPending[0].id);
        if (rxReady.length) add('Prescriptions ready to dispense', rxReady.length + ' verified and not yet given out', 'Pharmacy', RX(rxReady[0].id), rxReady[0].id);
        if (low.length) add('Stock at or below reorder level', low.length + ' item' + (low.length === 1 ? '' : 's') + ' to reorder', 'Inventory', STOCK(low[0].drug), low[0].drug);
        if (soon.length) add('Batches expiring within 90 days', soon.length + ' batch' + (soon.length === 1 ? '' : 'es') + ' to use or return', 'Inventory', STOCK(soon[0].batch || soon[0].id), soon[0].batch || soon[0].id);
        if (critical.length) add('Critical result released', critical.length + ' flagged result' + (critical.length === 1 ? '' : 's') + ' on file', 'Laboratory', LAB(critical[0].id), critical[0].id);
        break;

      case 'nurse':
        if (adm.length) add('Patients on the ward', adm.length + ' active admission' + (adm.length === 1 ? '' : 's'), 'Admissions', 'admissions.html?focus=' + encodeURIComponent(adm[0].id), adm[0].id);
        if (rxReady.length) add('Medication ready to administer', rxReady.length + ' verified prescription' + (rxReady.length === 1 ? '' : 's'), 'Pharmacy', RX(rxReady[0].id), rxReady[0].id);
        if (critical.length) add('Critical result awaiting acknowledgement', critical.length + ' flagged result' + (critical.length === 1 ? '' : 's'), 'Laboratory', LAB(critical[0].id), critical[0].id);
        if (pending.length) add('Specimens awaiting collection', pending.length + ' order' + (pending.length === 1 ? '' : 's'), 'Laboratory', LAB(pending[0].id), pending[0].id);
        break;

      case 'doctor':
        if (apptConfirmed.length) add('Consultations today', apptConfirmed.length + ' confirmed appointment' + (apptConfirmed.length === 1 ? '' : 's'), 'Appointments', 'appointments.html?status=Confirmed&focus=' + encodeURIComponent(apptConfirmed[0].id), apptConfirmed[0].id);
        if (toValidate.length) add('Results ready for review', toValidate.length + ' entered and awaiting validation', 'Laboratory', LAB(toValidate[0].id), toValidate[0].id);
        if (released.length) add('Released results on file', released.length + ' report' + (released.length === 1 ? '' : 's') + ' available', 'Laboratory', LAB(released[0].id), released[0].id);
        if (adm.length) add('Inpatients under care', adm.length + ' active admission' + (adm.length === 1 ? '' : 's'), 'Admissions', 'admissions.html?focus=' + encodeURIComponent(adm[0].id), adm[0].id);
        break;

      case 'registration':
        if (reqs.length) add('Correction requests from patients', reqs.length + ' waiting at the front desk', 'Patient portal', 'registration.html?tab=requests', reqs[0].id);
        if (apptPending.length) add('Appointments awaiting approval', apptPending.length + ' still pending', 'Appointments', 'appointments.html?status=Pending&focus=' + encodeURIComponent(apptPending[0].id), apptPending[0].id);
        if (apptToday.length) add('Appointments today', apptToday.length + ' on the schedule for ' + today(), 'Appointments', 'appointments.html', null);
        if (beds) add('Beds available', beds.available + ' of ' + beds.total + ' free across ' + (ad.wards ? ad.wards().length : 0) + ' wards', 'Admissions', 'admissions.html', null);
        if (adm.length) add('Active admissions', adm.length + ' patient' + (adm.length === 1 ? '' : 's') + ' on the ward', 'Admissions', 'admissions.html?focus=' + encodeURIComponent(adm[0].id), adm[0].id);
        break;

      case 'finance':
        if (claimDenied.length) add('Claims denied', claimDenied.length + ' needing a correction or an appeal', 'Claims', 'claims.html?focus=' + encodeURIComponent(claimDenied[0].id), claimDenied[0].id);
        if (unbilled.length) add('Unbilled revenue', unbilled.length + ' charge' + (unbilled.length === 1 ? '' : 's') + ' worth ' + peso(unbilledTotal), 'Billing', 'charges.html?tab=unbilled&focus=' + encodeURIComponent(unbilled[0].id), unbilled[0].id);
        if (openBills.length) add('Outstanding balance', peso(outstanding) + ' across ' + openBills.length + ' invoice' + (openBills.length === 1 ? '' : 's'), 'Billing', 'billing.html?focus=' + encodeURIComponent(openBills[0].id), openBills[0].id);
        if (claimReview.length) add('Claims awaiting payer review', claimReview.length + ' submitted and not yet decided', 'Claims', 'claims.html?focus=' + encodeURIComponent(claimReview[0].id), claimReview[0].id);
        break;

      case 'hr':
        if (leavePending.length) add('Leave requests to settle', leavePending.length + ' awaiting a decision', 'Attendance', 'attendance.html?focus=' + encodeURIComponent(leavePending[0].name), leavePending[0].name);
        if (absent.length) add('Absences without leave', absent.length + ' employee' + (absent.length === 1 ? '' : 's') + ' with no clock entry', 'Attendance', 'attendance.html?focus=' + encodeURIComponent(absent[0].id), absent[0].id);
        if (late.length) add('Late arrivals today', late.length + ' employee' + (late.length === 1 ? '' : 's') + ' clocked in late', 'Attendance', 'attendance.html?focus=' + encodeURIComponent(late[0].id), late[0].id);
        break;

      case 'depthead':
        if (apptToday.length) add('Appointments today', apptToday.length + ' across the departments you head', 'Appointments', 'appointments.html', null);
        if (late.length) add('Late arrivals today', late.length + ' staff member' + (late.length === 1 ? '' : 's'), 'Attendance', 'attendance.html?focus=' + encodeURIComponent(late[0].id), late[0].id);
        if (adm.length) add('Inpatients on the ward', adm.length + ' active admission' + (adm.length === 1 ? '' : 's'), 'Admissions', 'admissions.html?focus=' + encodeURIComponent(adm[0].id), adm[0].id);
        if (leavePending.length) add('Leave requests to settle', leavePending.length + ' awaiting a decision', 'Attendance', 'attendance.html?focus=' + encodeURIComponent(leavePending[0].name), leavePending[0].name);
        break;

      case 'auditor':
        if (voids.length) add('Voided charges', voids.length + ' charge' + (voids.length === 1 ? '' : 's') + ' reversed with a recorded reason', 'Charges', 'charges.html?tab=all&focus=' + encodeURIComponent(voids[0].id), voids[0].id);
        if (unbilled.length) add('Unbilled charges', unbilled.length + ' not yet on an invoice', 'Charges', 'charges.html?tab=unbilled&focus=' + encodeURIComponent(unbilled[0].id), unbilled[0].id);
        if (audit.length) add('Audit entries this session', audit.length + ' recorded action' + (audit.length === 1 ? '' : 's'), 'Audit', 'audit.html', null);
        if (openBills.length) add('Invoices with a balance', openBills.length + ' open \u00b7 ' + peso(outstanding), 'Billing', 'billing.html?focus=' + encodeURIComponent(openBills[0].id), openBills[0].id);
        break;

      case 'patient':
        break;

      default: // superadmin — operational oversight across every module
        if (reqs.length) add('Correction requests from patients', reqs.length + ' waiting at the front desk', 'Patient portal', 'registration.html?tab=requests', reqs[0].id);
        if (critical.length) add('Critical result awaiting acknowledgement', critical.length + ' flagged result' + (critical.length === 1 ? '' : 's') + ' on file', 'Laboratory', LAB(critical[0].id), critical[0].id);
        if (unbilled.length) add('Unbilled charges', unbilled.length + ' charge' + (unbilled.length === 1 ? '' : 's') + ' worth ' + peso(unbilledTotal), 'Billing', 'charges.html?tab=unbilled&focus=' + encodeURIComponent(unbilled[0].id), unbilled[0].id);
        if (claimReview.length) add('Claims awaiting payer review', claimReview.length + ' submitted and not yet decided', 'Claims', 'claims.html?focus=' + encodeURIComponent(claimReview[0].id), claimReview[0].id);
        if (beds) add('Beds occupied', beds.occupied + ' of ' + beds.total + ' \u00b7 ' + beds.rate + '% occupancy', 'Admissions', 'admissions.html', null);
        break;
    }
    return { items: out.slice(0, 5), role: role };
  }

  function patientName(id) {
    const p = window.HIS.registry && HIS.registry.byId ? HIS.registry.byId(id) : null;
    return p ? p.name : id;
  }

  const KEY = HIS.store.KEY.notifRead;
  // Shape: { v: 2, by: { role: [id, ...] } }. A pre-M13 array of indexes is discarded, because row
  // indexes are no longer stable once the list is derived per role.
  let saved = HIS.store.get(KEY, null);
  if (!saved || Array.isArray(saved) || saved.v !== 2 || typeof saved.by !== 'object') saved = { v: 2, by: {} };
  const readFor = role => (saved.by[role] = saved.by[role] || []);
  const save = () => { HIS.store.set(KEY, saved); };

  const css = document.createElement('style');
  css.textContent =
    '.nf-p{position:absolute;left:952px;top:90px;width:420px;box-sizing:border-box;background:#fff;border-radius:16px;box-shadow:inset 0 0 0 1px #c8dcea,0 12px 32px rgba(15,30,46,.18);z-index:22;display:none;font-family:Inter,sans-serif}' +
    '.nf-p.on{display:block}' +
    '.nf-p *{box-sizing:border-box;margin:0}' +
    '.nf-t{position:absolute;left:24px;top:20px;font:500 18px/22.5px Lexend,Inter,sans-serif;color:#1b4e6b;white-space:nowrap}' +
    '.nf-s{position:absolute;left:24px;top:46px;font:400 12px/14.5px Inter,sans-serif;color:#6f8890;white-space:nowrap}' +
    '.nf-x{position:absolute;left:360px;top:20px;width:36px;height:36px;border:0;border-radius:8px;background:#fff;box-shadow:inset 0 0 0 1px #c8dcea;font:500 16px/36px Inter,sans-serif;color:#1b4e6b;cursor:pointer;padding:0;text-align:center}' +
    '.nf-x:hover{background:#e8f4fb}' +
    '.nf-d{position:absolute;left:0;top:68px;width:420px;height:1px;background:#e3edf3}' +
    '.nf-r{position:absolute;left:24px;width:372px;height:78px;border:0;border-radius:10px;background:#f6fafd;box-shadow:inset 0 0 0 1px #e3edf3;text-align:left;padding:0;cursor:pointer;font-family:Inter,sans-serif;overflow:hidden}' +
    '.nf-r:hover{background:#e8f4fb}' +
    '.nf-r.rd{background:#fff}' +
    '.nf-dot{position:absolute;left:14px;top:17px;width:8px;height:8px;border-radius:50%;background:#1c6d9c}' +
    '.nf-r.rd .nf-dot{display:none}' +
    '.nf-rt{position:absolute;left:32px;top:12px;right:16px;font:600 13px/15.7px Inter,sans-serif;color:#1c2b30;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.nf-r.rd .nf-rt{font-weight:500}' +
    '.nf-rb{position:absolute;left:32px;top:33px;right:16px;font:400 12px/14.5px Inter,sans-serif;color:#6f8890;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.nf-rm{position:absolute;left:32px;top:55px;font:500 11px/13.3px Inter,sans-serif;color:#5b8db8;white-space:nowrap}' +
    '.nf-m{position:absolute;left:24px;width:372px;height:40px;border:0;border-radius:8px;background:#1c6d9c;color:#fff;font:600 13px/40px Inter,sans-serif;text-align:center;cursor:pointer;padding:0}' +
    '.nf-m:hover{background:#1b4e6b}' +
    '.nf-m:disabled{opacity:.5;cursor:default;background:#1c6d9c}' +
    '.nf-e{position:absolute;left:24px;width:372px;border-radius:10px;background:#f6fafd;box-shadow:inset 0 0 0 1px #e3edf3;padding:18px 20px;text-align:center}' +
    '.nf-e b{display:block;font:600 13px/18px Inter,sans-serif;color:#1c2b30}' +
    '.nf-e span{display:block;margin-top:4px;font:400 12px/17px Inter,sans-serif;color:#6f8890}';
  document.head.appendChild(css);

  const panel = document.createElement('div');
  panel.className = 'nf-p'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Notifications');
  stage.appendChild(panel);
  // Billing, Departments and Profile rebuild the stage with innerHTML, which drops the panel;
  // put it back so the bell keeps working on those pages.
  if (window.MutationObserver) new MutationObserver(() => { if (!panel.isConnected) stage.appendChild(panel); }).observe(stage, { childList: true });
  const badge = bell.querySelector('b');

  const ROLE_LABEL = {
    superadmin: 'Hospital operations', registration: 'Front desk', doctor: 'Clinical',
    nurse: 'Nursing', pharmacist: 'Pharmacy', lab: 'Laboratory', finance: 'Billing & finance',
    hr: 'Human resources',
    depthead: 'Department', auditor: 'Compliance', patient: 'Your record'
  };

  function render() {
    const built = build();
    const items = built.items;
    const read = readFor(built.role);
    const unread = items.filter(n => read.indexOf(n.id) < 0).length;
    const n = items.length;
    const height = n ? 84 + 86 * (n - 1) + 150 : 190;
    const btnTop = n ? 84 + 86 * (n - 1) + 94 : 0;
    panel.style.height = height + 'px';
    panel.innerHTML =
      "<div class='nf-t'>Notifications</div>" +
      "<div class='nf-s'>" + (n ? (unread ? unread + ' unread' : 'All caught up') + ' \u00b7 ' + (ROLE_LABEL[built.role] || 'Activity') : 'Nothing needs you') + '</div>' +
      "<button class='nf-x' data-act='close' aria-label='Close notifications'>\u2715</button>" +
      "<div class='nf-d'></div>" +
      (n
        ? items.map((x, i) => "<button class='nf-r" + (read.indexOf(x.id) < 0 ? '' : ' rd') + "' data-n='" + i + "' style='top:" + (84 + 86 * i) + "px'><span class='nf-dot'></span><span class='nf-rt'>" + HIS.kit.esc(x.title) + "</span><span class='nf-rb'>" + HIS.kit.esc(x.body) + "</span><span class='nf-rm'>" + HIS.kit.esc(x.meta) + '</span></button>').join('') +
          "<button class='nf-m' data-act='all' style='top:" + btnTop + "px'" + (unread ? '' : ' disabled') + '>Mark all as read</button>'
        : "<div class='nf-e' style='top:84px'><b>You are all caught up</b><span>Nothing in your area needs attention right now.</span></div>");
    if (badge) { badge.textContent = unread; badge.style.display = unread ? '' : 'none'; }
    bell.setAttribute('aria-label', unread ? 'Notifications, ' + unread + ' unread' : 'Notifications');
  }
  function setOpen(o) {
    if (o && !panel.isConnected) stage.appendChild(panel);
    panel.classList.toggle('on', o);
    bell.setAttribute('aria-expanded', o ? 'true' : 'false');
    if (o) { render(); document.body.classList.remove('menu-open'); }
  }
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const built = build();
    if (b.dataset.act === 'close') { setOpen(false); bell.focus(); return; }
    if (b.dataset.act === 'all') {
      saved.by[built.role] = built.items.map(x => x.id); save(); render(); return;
    }
    if (b.dataset.n != null) {
      const item = built.items[+b.dataset.n];
      if (!item) return;
      // Marking read and doing the work are two different things. This marks the notification read
      // and takes the user to the record; the record's own state is untouched until they act on it.
      const read = readFor(built.role);
      if (read.indexOf(item.id) < 0) { read.push(item.id); save(); }
      if (item.page) { location.href = item.page; return; }
      render();
    }
  });
  bell.addEventListener('click', () => setOpen(!panel.classList.contains('on')));
  document.addEventListener('click', e => {
    if (!panel.classList.contains('on')) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(panel) < 0 && path.indexOf(bell) < 0) setOpen(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('on')) { setOpen(false); bell.focus(); } });
  render();
})();
