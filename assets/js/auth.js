// Authentication + demo session (M3).
//
// DEMONSTRATION ONLY. This is client-side authentication on a public static site. It cannot be
// secure: the account list and the session token both live in browser storage and are readable and
// writable by anyone with devtools. It exists so each of the 14 demo roles signs in as a distinct
// person instead of picking a role from a dropdown.
//
// What a real deployment needs instead (see docs/AUTH.md): a server that verifies an Argon2id or
// bcrypt hash, rate-limits attempts, and issues an HttpOnly + Secure + SameSite session cookie that
// the browser cannot read. Nothing below is a substitute for that.
//
// Session storage policy:
//   "Keep me signed in" checked   -> localStorage, 30 days  (survives closing the browser)
//   unchecked                     -> sessionStorage, 12 hours (survives refresh, dies with the tab)
// Either way a plain refresh keeps the user signed in, which is the behaviour users expect.
(function () {
  var LS = 'mh_session';
  var SS = 'mh_session_tab';
  var REMEMBER_DAYS = 30;
  var SESSION_HOURS = 12;

  function readRaw() {
    var raw = null;
    try { raw = localStorage.getItem(LS); } catch (e) { /* blocked */ }
    if (raw) return raw;
    try { raw = sessionStorage.getItem(SS); } catch (e) { /* blocked */ }
    return raw;
  }
  function parse(raw) {
    if (!raw) return null;
    try {
      var s = JSON.parse(raw);
      if (!s || !s.userId || !s.expiresAt) return null;
      if (new Date(s.expiresAt).getTime() <= Date.now()) return null; // expired
      return s;
    } catch (e) { return null; }
  }
  function current() { return parse(readRaw()); }
  function account() {
    var s = current();
    if (!s) return null;
    var a = HIS.accounts.byId(s.userId);
    if (!a || a.status !== 'active') return null; // deactivated mid-session
    return a;
  }
  function isSignedIn() { return !!account(); }

  function clear() {
    try { localStorage.removeItem(LS); } catch (e) { /* blocked */ }
    try { sessionStorage.removeItem(SS); } catch (e) { /* blocked */ }
  }

  function persist(session, remember) {
    var raw = JSON.stringify(session);
    clear();
    try {
      if (remember) localStorage.setItem(LS, raw);
      else sessionStorage.setItem(SS, raw);
    } catch (e) { /* storage blocked: session stays in memory for this page only */ }
  }

  // Resolve a set of credentials. Returns a discriminated result so the UI can show a precise
  // message without leaking whether an email exists (see the generic branch).
  function attempt(email, password, remember) {
    var e = HIS.accounts.norm(email);
    if (!e) return { ok: false, code: 'email-empty', message: 'Enter your email address.' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false, code: 'email-format', message: 'Enter a valid email address.' };
    if (!password) return { ok: false, code: 'password-empty', message: 'Enter your password.' };

    var acct = HIS.accounts.byEmail(e);
    if (!acct) {
      auditFail(e, 'No account for this email');
      return { ok: false, code: 'no-account', message: 'No account uses that email address.' };
    }
    if (acct.status !== 'active') {
      auditFail(e, 'Account is ' + acct.status);
      return { ok: false, code: 'disabled', message: 'This account is deactivated. Ask the Super Administrator to reactivate it.' };
    }
    if (!HIS.accounts.verify(acct, password)) {
      auditFail(e, 'Wrong password');
      return { ok: false, code: 'bad-password', message: 'That password does not match this account.' };
    }

    var ttl = remember ? REMEMBER_DAYS * 864e5 : SESSION_HOURS * 36e5;
    var session = {
      userId: acct.id, email: acct.email, role: acct.role,
      at: new Date().toISOString(), expiresAt: new Date(Date.now() + ttl).toISOString(),
      remember: !!remember
    };
    persist(session, remember);
    HIS.accounts.touchLogin(acct.id);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: acct.name, role: HIS.rbac ? (HIS.rbac.ROLES[acct.role] || {}).label || acct.role : acct.role,
        what: 'Signed in', entity: 'session:' + acct.email, before: null, after: 'active'
      });
    }
    return { ok: true, account: acct, session: session };
  }

  function auditFail(email, why) {
    if (!window.HIS.audit) return;
    HIS.audit.append({
      who: email, role: '\u2014',
      what: 'Failed sign-in attempt \u2014 ' + why, entity: 'session:' + email,
      before: null, after: 'denied'
    });
  }

  function signOut() {
    var a = account();
    // Signing out ends the demonstration: the sample dataset is restored for whoever signs in next,
    // so one visitor's edits never greet the next. The audit trail is carried across the reset —
    // a log that erased itself would not be a log — and both are discarded when the tab closes.
    // See docs/PROJECT-STATUS.md §5.2.
    var trail = window.HIS.audit ? HIS.audit.list() : null;
    // A correction request is a message addressed to staff, not session state: if signing out
    // erased it, the patient's request would vanish exactly when the front desk came to read it.
    // It survives the reset for the same reason the audit trail does.
    // Read by key, not through HIS.requests: sign-out happens on pages that do not load the module.
    var reqKey = (window.HIS.requests && HIS.requests.KEY) || 'mh_patient_requests';
    var reqs = HIS.store.get(reqKey, null);
    clear();
    if (window.HIS.store) HIS.store.reset({ includeOwner: true });
    if (Array.isArray(reqs) && reqs.length) HIS.store.set(reqKey, reqs);
    if (window.HIS.audit) {
      if (trail) HIS.store.set(HIS.audit.KEY, trail);
      if (a) {
        HIS.audit.append({
          who: a.name, role: HIS.rbac ? (HIS.rbac.ROLES[a.role] || {}).label || a.role : a.role,
          what: 'Signed out', entity: 'session:' + a.email, before: 'active', after: 'ended'
        });
      }
    }
  }

  // Where a freshly signed-in account should land.
  function homeFor(acct) {
    if (!acct || !HIS.rbac) return 'dashboard.html';
    var r = HIS.rbac.ROLES[acct.role];
    if (!r) return 'dashboard.html';
    return r.external || (r.home + '.html');
  }

  // Route guard for every shell page. Returns false when a redirect was issued.
  function requireAuth() {
    if (isSignedIn()) return true;
    clear();
    var here = location.pathname.split('/').pop() || 'index.html';
    var q = here && here !== 'index.html' ? '?next=' + encodeURIComponent(here) : '';
    location.replace('index.html' + q);
    return false;
  }

  HIS.auth = {
    current: current, account: account, isSignedIn: isSignedIn,
    attempt: attempt, signOut: signOut, clear: clear,
    homeFor: homeFor, requireAuth: requireAuth,
    REMEMBER_DAYS: REMEMBER_DAYS, SESSION_HOURS: SESSION_HOURS
  };
})();
