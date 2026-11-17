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
  function initials(n) { return n.replace(/^Dr\.\s*|^Atty\.\s*/, '').split(' ').map(function (s) { return s[0]; }).join('').slice(0, 2).toUpperCase(); }

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
    stage.querySelectorAll('.ac-edit').forEach(function (b) { b.onclick = function () { editor(HIS.accounts.byId(b.dataset.id)); }; });
  }

  // ---- editor modal (design format: white r16 card, 1px #c8dcea, Lexend 20 title) --------------
  function editor(acct) {
    var isNew = !acct;
    var a = acct || { name: '', email: '', role: 'receptionist', dept: '', title: '', status: 'active' };
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
      "<div class='ac-f'><label for='acPass'>" + (isNew ? 'Initial password' : 'Reset password (leave blank to keep)') + "</label>" +
      "<input id='acPass' name='password' type='text' autocomplete='new-password' placeholder='" + (isNew ? 'MediHeal2026!' : '\u2014') + "'></div>" +
      "<div class='ac-err' id='acErr' role='alert'></div>" +
      "<div class='ac-a'><button type='button' class='mbtn out' data-x>Cancel</button><button type='submit' class='mbtn'>" + (isNew ? 'Create account' : 'Save changes') + '</button></div>' +
      '</form>';
    document.body.appendChild(bg);
    var err = bg.querySelector('#acErr');
    function close() { bg.remove(); document.removeEventListener('keydown', escKey); }
    function escKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', escKey);
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    bg.querySelector('[data-x]').onclick = close;
    bg.querySelector('#acName').focus();

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
