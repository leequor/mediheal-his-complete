// Sign-in behaviour (M3). Wires the Figma sign-in screen to the demo account store.
// All feedback is inline and honest: no fake "email sent", no claim that this is secure auth.
(function () {
  var e = document.getElementById('sie');
  var p = document.getElementById('sip');
  var btn = document.getElementById('siBtn');
  var btnTx = document.getElementById('siBtnTx');
  var msg = document.getElementById('siMsg');
  var eye = document.getElementById('siEye');
  var tipEl = document.getElementById('sit');
  var tm;

  function tip(m) { tipEl.textContent = m; tipEl.hidden = false; clearTimeout(tm); tm = setTimeout(function () { tipEl.hidden = true; }, 2600); }
  function say(text, kind) {
    msg.textContent = text || '';
    msg.className = 'si-msg' + (text ? ' on ' + (kind || '') : '');
  }
  function clearBad() { e.classList.remove('bad'); p.classList.remove('bad'); }
  [e, p].forEach(function (i) { i.addEventListener('input', function () { i.classList.remove('bad'); if (msg.classList.contains('bad')) say(''); }); });

  // --- password visibility -------------------------------------------------
  eye.addEventListener('click', function () {
    var show = p.type === 'password';
    p.type = show ? 'text' : 'password';
    eye.classList.toggle('on', show);
    eye.setAttribute('aria-pressed', show ? 'true' : 'false');
    eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    p.focus();
    try { p.setSelectionRange(p.value.length, p.value.length); } catch (err) { /* text inputs only */ }
  });

  // --- already signed in? go straight to the workspace ----------------------
  if (HIS.auth.isSignedIn()) {
    var acct0 = HIS.auth.account();
    location.replace(HIS.auth.homeFor(acct0));
    return;
  }

  var next = new URLSearchParams(location.search).get('next');

  // --- submit --------------------------------------------------------------
  document.getElementById('sif').addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (btn.disabled) return;
    clearBad();
    say('');

    var email = e.value.trim();
    var pass = p.value;

    // Client-side shape checks first, so the user gets the message without a fake "server" round trip.
    if (!email) { e.classList.add('bad'); say('Enter your email address.', 'bad'); e.focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { e.classList.add('bad'); say('Enter a valid email address.', 'bad'); e.focus(); return; }
    if (!pass) { p.classList.add('bad'); say('Enter your password.', 'bad'); p.focus(); return; }

    // Loading feedback: the attempt itself is synchronous, so this is a deliberate short beat that
    // shows the control responded. It does not pretend to contact a server.
    btn.disabled = true;
    btn.classList.add('busy');
    btnTx.textContent = 'Signing in…';

    setTimeout(function () {
      var res = HIS.auth.attempt(email, pass, document.getElementById('sik').checked);
      if (!res.ok) {
        btn.disabled = false;
        btn.classList.remove('busy');
        btnTx.textContent = 'Sign in →';
        say(res.message, 'bad');
        if (res.code === 'bad-password') { p.classList.add('bad'); p.select(); }
        else if (res.code === 'no-account' || res.code === 'disabled') { e.classList.add('bad'); e.focus(); }
        return;
      }
      btn.classList.remove('busy');
      btn.classList.add('done');
      btnTx.textContent = 'Signed in';
      say('Signed in as ' + res.account.name + '. Opening your workspace…', 'ok');
      var dest = HIS.auth.homeFor(res.account);
      // Honour a ?next= return path only when the account can actually open it.
      if (next) {
        var stem = String(next).split('?')[0].replace(/\.html$/, '');
        if (HIS.rbac.allows(stem)) dest = next;
      }
      setTimeout(function () { location.href = dest; }, 420);
    }, 260);
  });

  // --- password help -------------------------------------------------------
  var VIEWS = {
    signin: ['Sign in to your workspace', 'Enter your staff credentials to access the hospital Information System.'],
    forgot: ['Password help', 'How to recover access to a demo account.']
  };
  function view(v) {
    document.getElementById('sif').hidden = v !== 'signin';
    document.getElementById('si-forgot').hidden = v !== 'forgot';
    document.getElementById('sit1').textContent = VIEWS[v][0];
    document.getElementById('sis1').textContent = VIEWS[v][1];
    say('');
  }
  document.getElementById('sif2').addEventListener('click', function () { view('forgot'); document.getElementById('sif-back').focus(); });
  document.getElementById('sif-back').addEventListener('click', function () { view('signin'); e.focus(); });

  // --- demo credential reference -------------------------------------------
  var bg = document.getElementById('dmBg');
  var list = document.getElementById('dmList');
  function roleLabel(k) { var r = HIS.rbac.ROLES[k]; return r ? r.label : k; }

  function copy(text, label) {
    function done() { tip(label + ' copied'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (err) { tip('Copy failed — select the text manually'); }
      ta.remove();
    }
  }

  function openDemo(open) {
    bg.hidden = !open;
    if (!open) { document.getElementById('siDemo').focus(); return; }
    list.innerHTML = HIS.accounts.all().map(function (a) {
      return "<div class='dm-r'><div class='dm-ri'><b>" + HIS.kit.esc(a.name) + '</b>' +
        "<span>" + HIS.kit.esc(roleLabel(a.role)) + (a.dept ? ' \u00b7 ' + HIS.kit.esc(a.dept) : '') + '</span></div>' +
        "<code>" + HIS.kit.esc(a.email) + '</code>' +
        "<button type='button' class='dm-copy' data-copy='" + HIS.kit.esc(a.email) + "'>Copy</button>" +
        "<button type='button' class='dm-use' data-use='" + HIS.kit.esc(a.email) + "'>Use</button></div>";
    }).join('');
    var first = list.querySelector('.dm-use');
    if (first) first.focus();
  }
  document.getElementById('siDemo').addEventListener('click', function () { openDemo(true); });
  document.getElementById('sif-demo').addEventListener('click', function () { openDemo(true); });
  document.getElementById('dmX').addEventListener('click', function () { openDemo(false); });
  bg.addEventListener('mousedown', function (ev) { if (ev.target === bg) openDemo(false); });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !bg.hidden) { ev.preventDefault(); openDemo(false); }
  });
  bg.addEventListener('click', function (ev) {
    var c = ev.target.closest('[data-copy]');
    if (c) { copy(c.dataset.copy, 'Address'); return; }
    var u = ev.target.closest('[data-use]');
    if (u) {
      e.value = u.dataset.use;
      p.value = HIS.accounts.DEMO_PASSWORD;
      clearBad(); say('');
      openDemo(false);
      document.getElementById('sik').checked = false;
      e.focus();
      tip('Demo credentials filled in — press Sign in');
    }
  });
  document.getElementById('dmPw').parentNode.addEventListener('click', function (ev) {
    var c = ev.target.closest('[data-copy]');
    if (c) copy(c.dataset.copy, 'Password');
  });
})();
