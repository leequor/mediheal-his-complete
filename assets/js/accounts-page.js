// Account management (M3). Super Administrator only — the route guard in rbac.js keeps other roles
// out, and every mutation is audited. Passwords are never written to the audit log: only the fact
// that a reset happened.
(function () {
  var stage = document.getElementById('stage');
  var esc = HIS.kit.esc;
  var q = '', roleFilter = 'all';

  function when(iso) {
    if (!iso) return 'Never';
    var d = new Date(iso);
    if (isNaN(d)) return '\u2014';
    try {
      return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
  }
  function roleLabel(k) { var r = HIS.rbac.ROLES[k]; return r ? r.label : k; }
  function initials(n) { var w = n.replace(/^Dr\.\s*|^Atty\.\s*/, '').split(' ').filter(Boolean); return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] || '?').slice(0, 2)).toUpperCase(); }

  function rows() {
    var needle = q.trim().toLowerCase();
    return HIS.accounts.all().filter(function (a) {
      if (roleFilter !== 'all' && a.role !== roleFilter) return false;
      if (!needle) return true;
      return (a.name + ' ' + a.email + ' ' + (a.dept || '') + ' ' + (a.title || '')).toLowerCase().indexOf(needle) > -1;
    });
  }

  function render() {
    var st = HIS.accounts.stats();
    var list = rows();
    stage.innerHTML =
      "<h1 class='ad-title'>Accounts</h1>" +
      "<p class='ad-sub'>Individual demo identities. Each account signs in with its own email and resolves its own role.</p>" +
      "<div class='ad-body'>" +
      "<div class='ad-kpis'>" +
      "<div class='ad-kpi'><div class='l'>Total accounts</div><div class='v'>" + st.total + "</div><div class='d'>Across " + Object.keys(st.byRole).length + ' roles</div></div>' +
      "<div class='ad-kpi g'><div class='l'>Active</div><div class='v'>" + st.active + "</div><div class='d'>Can sign in</div></div>" +
      "<div class='ad-kpi r'><div class='l'>Deactivated</div><div class='v'>" + st.inactive + "</div><div class='d'>Blocked at sign-in</div></div>" +
      "<div class='ad-kpi'><div class='l'>Signed in now</div><div class='v'>" + (HIS.auth.account() ? '1' : '0') + "</div><div class='d'>This browser session</div></div>" +
      '</div>' +

      "<div class='ad-card'>" +
      "<div class='ad-bar'>" +
      "<h2>All accounts</h2>" +
      "<span class='ad-count'>" + list.length + ' of ' + st.total + '</span>' +
      "<label class='ad-search'>" + svg('search', 16) + "<input id='acQ' type='search' placeholder='Search name or email' aria-label='Search accounts' value='" + esc(q) + "'></label>" +
      "<select class='ad-sel' id='acRole' aria-label='Filter by role'>" +
      "<option value='all'" + (roleFilter === 'all' ? ' selected' : '') + '>All roles</option>' +
      Object.keys(HIS.rbac.ROLES).map(function (k) {
        return "<option value='" + k + "'" + (roleFilter === k ? ' selected' : '') + '>' + esc(HIS.rbac.ROLES[k].label) + '</option>';
      }).join('') + '</select>' +
      "<button class='ad-btn' id='acNew' type='button'>+ New account</button>" +
      '</div>' +
      "<div class='ad-th ac-g'><span>Account</span><span>Role</span><span>Department</span><span>Status</span><span>Last sign-in</span><span></span></div>" +
      (list.length ? list.map(function (a) {
        var isMe = HIS.auth.account() && HIS.auth.account().id === a.id;
        return "<div class='ad-tr ac-g'>" +
          "<span class='ac-who'><span class='ac-av'>" + esc(initials(a.name)) + '</span><span class="ac-wt"><b>' + esc(a.name) + (isMe ? " <em class='ac-you'>you</em>" : '') + '</b><small>' + esc(a.email) + '</small></span></span>' +
          "<span class='mu'>" + esc(roleLabel(a.role)) + '</span>' +
          "<span class='mu'>" + esc(a.dept || '\u2014') + '</span>' +
          "<span>" + HIS.kit.pill(a.status === 'active' ? 'Active' : 'Deactivated', a.status === 'active' ? 'ok' : 'off') + '</span>' +
          "<span class='mu'>" + esc(when(a.lastLogin)) + '</span>' +
          "<span style='text-align:right'><button class='ac-edit' type='button' data-id='" + esc(a.id) + "'>Manage</button></span></div>";
      }).join('') : "<div class='ad-empty'><b>No accounts match</b>Clear the search or pick a different role.</div>") +
      '</div>' +

      // ---- M5: patient portal access -------------------------------------------------------
      "<div class='ad-card'>" +
      "<div class='ad-bar'><h2>Patient portal access</h2>" +
      "<span class='ad-count'>" + accessRows().length + ' linked</span>' +
      "<button class='ad-btn' id='acGuardian' type='button'>+ Authorise guardian</button></div>" +
      "<div class='ad-th ac-g2'><span>Patient record</span><span>Portal account</span><span>Authorised guardians</span><span></span></div>" +
      (accessRows().length ? accessRows().map(function (r) {
        return "<div class='ad-tr ac-g2'>" +
          "<span class='ac-who'><span class='ac-av'>" + esc(initials(r.patient.name)) + '</span><span class="ac-wt"><b>' + esc(r.patient.name) + '</b><small>' + esc(r.patient.id) + '</small></span></span>' +
          "<span class='mu'>" + (r.account ? esc(r.account.email) : '<i style="color:#8a97a6">no account</i>') + '</span>' +
          "<span class='mu'>" + (r.guardians.length ? r.guardians.map(function (g) {
            var ga = HIS.accounts.byId(g.accountId);
            return esc((ga ? ga.email : g.accountId) + ' \u00b7 ' + g.relationship) +
              " <button class='ac-edit' type='button' data-revoke='" + esc(g.id) + "' title='Revoke this authorisation'>Revoke</button>";
          }).join('<br>') : '\u2014') + '</span>' +
          "<span style='text-align:right'><button class='ac-edit' type='button' data-link='" + esc(r.patient.id) + "'>Manage</button></span></div>";
      }).join('') : "<div class='ad-empty'><b>No patient accounts yet</b>Create one with “New account”, or link an existing account from “Manage”.</div>") +
      '</div>' +

      "<div class='ad-note'><b>Demonstration identity system.</b> Accounts and the active session live in this " +
      "browser's storage. Passwords are stored as a fast non-cryptographic digest, not a password hash, " +
      'and the session is readable by anyone with devtools. This is not production authentication \u2014 see ' +
      '<code>docs/AUTH.md</code> for what a real deployment requires. Every action on this page is written ' +
      'to the audit log; passwords never are.</div>' +
      '</div>';

    document.getElementById('acQ').oninput = function (e) {
      q = e.target.value; render();
      var f = document.getElementById('acQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length);
    };
    document.getElementById('acRole').onchange = function (e) { roleFilter = e.target.value; render(); };
    document.getElementById('acNew').onclick = function () { editor(null); };
    stage.querySelectorAll('.ac-edit').forEach(function (b) { if (b.dataset.id) b.onclick = function () { editor(HIS.accounts.byId(b.dataset.id), b); }; });

    var gbtn = document.getElementById('acGuardian');
    if (gbtn) gbtn.onclick = function () { guardianEditor(gbtn); };
    stage.querySelectorAll('[data-revoke]').forEach(function (b) {
      b.onclick = function () {
        var r = HIS.registry.revokeGuardian(b.dataset.revoke, 'Revoked from the Accounts screen');
        HIS.kit.toast(r.ok ? 'Authorisation revoked.' : r.error);
        render();
      };
    });
    stage.querySelectorAll('[data-link]').forEach(function (b) {
      b.onclick = function () {
        var pid = b.dataset.link;
        var acct = HIS.registry.accountFor(pid);
        if (acct) editor(acct, b);
        else editor(null, b, { role: 'patient', patientId: pid });
      };
    });
  }

  // ---- guardian authorisation modal -----------------------------------------------------------
  function guardianEditor(trigger) {
    var bg = document.createElement('div');
    bg.className = 'ac-bg';
    var patients = HIS.registry.all();
    bg.innerHTML =
      "<form class='ac-m' role='dialog' aria-modal='true' aria-labelledby='gdTitle'>" +
      "<h3 id='gdTitle'>Authorise a guardian</h3>" +
      "<p class='ac-s'>A guardian sees the dependent's appointments, billing, documents and medical record. " +
      'Access is per patient and can be revoked here.</p>' +
      "<div class='ac-f'><label for='gdAcct'>Guardian account</label><select id='gdAcct' name='accountId'>" +
      HIS.accounts.all().map(function (a) {
        return "<option value='" + esc(a.id) + "'>" + esc(a.email + ' \u00b7 ' + a.name) + '</option>';
      }).join('') + '</select></div>' +
      "<div class='ac-row'>" +
      "<div class='ac-f'><label for='gdPat'>Dependent patient</label><select id='gdPat' name='patientId'>" +
      patients.map(function (p) { return "<option value='" + esc(p.id) + "'>" + esc(p.id + ' \u00b7 ' + p.name) + '</option>'; }).join('') +
      '</select></div>' +
      "<div class='ac-f'><label for='gdRel'>Relationship</label><select id='gdRel' name='relationship'>" +
      ['Parent', 'Spouse', 'Child', 'Sibling', 'Grandparent', 'Legal guardian', 'Other'].map(function (r) {
        return "<option>" + r + '</option>';
      }).join('') + '</select></div>' +
      '</div>' +
      "<div class='ac-f'><label for='gdRef'>Authorisation reference (consent form, court order, …)</label>" +
      "<input id='gdRef' name='reference' placeholder='AUTH-2026-0000'></div>" +
      "<div class='ac-err' id='gdErr' role='alert'></div>" +
      "<div class='ac-a'><button type='button' class='mbtn out' data-x>Cancel</button><button type='submit' class='mbtn'>Authorise</button></div>" +
      '</form>';
    document.body.appendChild(bg);
    var opener = trigger || document.activeElement;
    function close() {
      bg.remove();
      document.removeEventListener('keydown', escKey);
      if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus();
    }
    function escKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', escKey);
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    bg.querySelector('[data-x]').onclick = close;
    bg.querySelector('#gdAcct').focus();
    bg.querySelector('form').onsubmit = function (ev) {
      ev.preventDefault();
      var f = new FormData(ev.target);
      var r = HIS.registry.addGuardian({
        accountId: String(f.get('accountId') || ''),
        patientId: String(f.get('patientId') || ''),
        relationship: String(f.get('relationship') || 'Guardian'),
        reference: String(f.get('reference') || '')
      });
      if (!r.ok) { bg.querySelector('#gdErr').textContent = r.error; return; }
      close();
      HIS.kit.toast('Guardian authorised.');
      render();
    };
  }

  // ---- patient portal access ------------------------------------------------------------------
  // One row per patient record that either has a portal account or an active guardian link.
  function accessRows() {
    if (!window.HIS.registry) return [];
    var out = [];
    HIS.registry.all().forEach(function (p) {
      var acct = HIS.registry.accountFor(p.id);
      var gs = HIS.registry.guardianRowsFor(p.id).filter(function (g) { return g.status === 'active'; });
      if (acct || gs.length) out.push({ patient: p, account: acct, guardians: gs });
    });
    return out;
  }

  // ---- patient link picker -------------------------------------------------------------------
  // Lists every registry patient. A record already owned by a DIFFERENT account is disabled, so
  // the screen cannot create the two-accounts-one-patient state the store also refuses.
  function patientOptions(a) {
    if (!window.HIS.registry) return "<option value=''>(registry unavailable)</option>";
    var cur = a.patientId || '';
    var h = "<option value=''" + (cur ? '' : ' selected') + '>\u2014 not linked \u2014</option>';
    HIS.registry.all().forEach(function (p) {
      var owner = HIS.registry.accountFor(p.id);
      var taken = owner && owner.id !== a.id;
      h += "<option value='" + esc(p.id) + "'" + (cur === p.id ? ' selected' : '') + (taken ? ' disabled' : '') + '>' +
        esc(p.id + ' \u00b7 ' + p.name + (taken ? ' (linked to ' + owner.email + ')' : '')) + '</option>';
    });
    return h;
  }

  // ---- editor modal (design format: white r16 card, 1px #c8dcea, Lexend 20 title) --------------
  function editor(acct, trigger, preset) {
    var isNew = !acct;
    var a = acct || Object.assign({ name: '', email: '', role: 'receptionist', dept: '', title: '', status: 'active', patientId: '' }, preset || {});
    var bg = document.createElement('div');
    bg.className = 'ac-bg';
    bg.innerHTML =
      "<form class='ac-m' role='dialog' aria-modal='true' aria-labelledby='acTitle'>" +
      "<h3 id='acTitle'>" + (isNew ? 'New account' : 'Manage account') + '</h3>' +
      "<p class='ac-s'>" + (isNew ? 'The email becomes a valid login identity immediately.' : esc(a.email) + ' \u00b7 ' + esc(a.id)) + '</p>' +
      "<div class='ac-f'><label for='acName'>Display name</label><input id='acName' name='name' value='" + esc(a.name) + "' required></div>" +
      (isNew ? "<div class='ac-f'><label for='acEmail'>Email address</label><input id='acEmail' name='email' type='email' placeholder='name@mediheal.test' required></div>" : '') +
      "<div class='ac-row'>" +
      "<div class='ac-f'><label for='acRoleSel'>Role</label><select id='acRoleSel' name='role'>" +
      Object.keys(HIS.rbac.ROLES).map(function (k) {
        return "<option value='" + k + "'" + (a.role === k ? ' selected' : '') + '>' + esc(HIS.rbac.ROLES[k].label) + '</option>';
      }).join('') + '</select></div>' +
      "<div class='ac-f'><label for='acDept'>Department</label><input id='acDept' name='dept' value='" + esc(a.dept || '') + "'></div>" +
      '</div>' +
      "<div class='ac-row'>" +
      "<div class='ac-f'><label for='acTitleIn'>Position / title</label><input id='acTitleIn' name='title' value='" + esc(a.title || '') + "'></div>" +
      "<div class='ac-f'><label for='acStatus'>Account status</label><select id='acStatus' name='status'>" +
      "<option value='active'" + (a.status === 'active' ? ' selected' : '') + '>Active</option>' +
      "<option value='disabled'" + (a.status !== 'active' ? ' selected' : '') + '>Deactivated</option></select></div>' +
      '</div>' +
      // M5: a patient login is only useful if it resolves to a hospital record. The link is chosen
      // here, explicitly, and never inferred from the email address or the display name.
      "<div class='ac-f' id='acPatientRow' style='display:none'><label for='acPatient'>Linked patient record</label>" +
      "<select id='acPatient' name='patientId'>" + patientOptions(a) + '</select>' +
      "<small class='ac-hint'>A patient account with no linked record can sign in but the portal shows it nothing.</small></div>" +
      "<div class='ac-f'><label for='acPass'>" + (isNew ? 'Initial password' : 'Reset password (leave blank to keep)') + "</label>" +
      "<input id='acPass' name='password' type='text' autocomplete='new-password' placeholder='" + (isNew ? 'MediHeal2026!' : '\u2014') + "'></div>" +
      "<div class='ac-err' id='acErr' role='alert'></div>" +
      "<div class='ac-a'><button type='button' class='mbtn out' data-x>Cancel</button><button type='submit' class='mbtn'>" + (isNew ? 'Create account' : 'Save changes') + '</button></div>' +
      '</form>';
    document.body.appendChild(bg);
    var err = bg.querySelector('#acErr');
    // Remember what opened the dialog so focus can go back there. Without this, Escape dropped
    // focus onto <body> and a keyboard user lost their place in the table (M9.2 a11y audit).
    var opener = trigger || document.activeElement;
    function close() {
      bg.remove();
      document.removeEventListener('keydown', escKey);
      if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus();
    }
    function escKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', escKey);
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    bg.querySelector('[data-x]').onclick = close;
    bg.querySelector('#acName').focus();

    // The patient picker only applies to a patient account.
    var roleSel = bg.querySelector('#acRoleSel'), patRow = bg.querySelector('#acPatientRow');
    function syncPatientRow() { patRow.style.display = roleSel.value === 'patient' ? '' : 'none'; }
    roleSel.onchange = syncPatientRow;
    syncPatientRow();

    bg.querySelector('form').onsubmit = function (ev) {
      ev.preventDefault();
      var f = new FormData(ev.target);
      var name = String(f.get('name') || '').trim();
      var role = String(f.get('role') || '');
      var dept = String(f.get('dept') || '').trim();
      var title = String(f.get('title') || '').trim();
      var status = String(f.get('status') || 'active');
      var pass = String(f.get('password') || '');
      err.textContent = '';

      if (!name) { err.textContent = 'Enter a display name.'; return; }

      if (isNew) {
        var email = String(f.get('email') || '');
        var made = HIS.accounts.create({ email: email, name: name, role: role, dept: dept, title: title, password: pass || HIS.accounts.DEMO_PASSWORD });
        if (!made.ok) { err.textContent = made.error; return; }
        audit('Account created', made.account, null, made.account.email + ' \u00b7 ' + roleLabel(role));
        // Link after creation: create() takes patientId, but going through linkAccount keeps the
        // one-patient-one-account rule and the audit entry in a single place.
        var pidNew = String(f.get('patientId') || '');
        if (role === 'patient' && pidNew) {
          var ln = HIS.registry.linkAccount(made.account.id, pidNew);
          if (!ln.ok) { err.textContent = ln.error; return; }
        }
        HIS.kit.toast('Account created for ' + made.account.email);
      } else {
        if (pass) {
          var rp = HIS.accounts.setPassword(a.id, pass);
          if (!rp.ok) { err.textContent = rp.error; return; }
          audit('Password reset', a, null, 'reset required');
        }
        var changes = [];
        if (a.role !== role) changes.push(roleLabel(a.role) + ' \u2192 ' + roleLabel(role));
        if ((a.dept || '') !== dept) changes.push('dept ' + (a.dept || '\u2014') + ' \u2192 ' + (dept || '\u2014'));
        if (a.status !== status) changes.push(a.status + ' \u2192 ' + status);
        var up = HIS.accounts.update(a.id, { name: name, role: role, dept: dept, title: title, status: status });
        if (!up.ok) { err.textContent = up.error; return; }
        // Patient link: validated by registry.linkAccount (refuses a second claimant).
        if (role === 'patient') {
          var pid = String(f.get('patientId') || '');
          if ((a.patientId || '') !== pid) {
            var lr = HIS.registry.linkAccount(a.id, pid || null);
            if (!lr.ok) { err.textContent = lr.error; return; }
            changes.push('patient ' + (a.patientId || '\u2014') + ' \u2192 ' + (pid || '\u2014'));
          }
        } else if (a.patientId) {
          HIS.registry.linkAccount(a.id, null);
          changes.push('patient ' + a.patientId + ' \u2192 \u2014');
        }
        if (changes.length) audit('Account updated', up.account, a.role, changes.join('; '));
        HIS.kit.toast(changes.length || pass ? 'Account updated.' : 'No changes to save.');
      }
      close();
      render();
    };
  }

  function audit(what, acct, before, after) {
    HIS.audit.append({
      who: HIS.rbac.person().name, role: HIS.rbac.current().label,
      what: what + ': ' + acct.name + ' (' + acct.email + ')',
      entity: 'account:' + acct.id, before: before, after: after
    });
  }

  render();
})();
