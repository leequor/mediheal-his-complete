// Shared header + slide-in sidebar. Edit the nav in rbac.js (one place), every page updates.
// Figma: header-bar 239:2978, Sidebar 211:1949 (430x1024). Staff (211:1953) links to Attendance (2002:369).
// Fit-to-width (assets/js/fit.js v3, session 22) is loaded from here so every shell page gets it; index.html (sign-in) loads it itself. No effect at 1440px and wider.
// M1: the drawer renders HIS.rbac.nav() (role-scoped) and the header identity comes from
// HIS.rbac.person(). For the default role both are identical to the previous hardcoded values,
// so the resting appearance is unchanged.
(function () { var s = document.createElement('script'); s.src = 'assets/js/fit.js'; document.head.appendChild(s); })();

(function mountShell() {
  const page = document.body.dataset.page;
  if (!page) return;
  // Page-level role guard (M1). Redirects out before anything renders when the active role
  // cannot open this page. Demo-only: it is browser-side and not a security boundary.
  if (window.HIS.rbac && !HIS.rbac.guard()) return;
  // favicon: stops the /favicon.ico 404 on every page (small logo PNG)
  if (!document.querySelector('link[rel~="icon"]')) document.head.insertAdjacentHTML('beforeend', "<link rel='icon' type='image/png' href='assets/img/logo-removebg-preview%201.png'>");
  const u = HIS.rbac ? HIS.rbac.person() : HIS.user;
  const navLinks = HIS.rbac ? HIS.rbac.nav() : NAV;
  const ini = u.name.replace('Dr. ', '').split(' ').map(s => s[0]).join('');
  document.body.insertAdjacentHTML('afterbegin',
    "<header class='header'><div class='hd'>" +
    "<button class='burger' id='burger' aria-label='Open menu'><i></i><i></i><i></i></button>" +
    "<img class='logo' src='assets/img/logo-large.png' data-fallback='assets/img/logo-removebg-preview%201.png' alt=''>" +
    "<span class='brand'>MediHeal</span>" +
    "<div class='hd-date'>" + svg('calendar', 18) + '<span>' + HIS.fmtShort(HIS.today) + '</span></div>' +
    "<button class='bell' aria-label='Notifications'>" + svg('bell', 20) + '<b>4</b></button>' +
    "<div class='sep'></div>" +
    "<div class='profile' id='profile' role='button' tabindex='0' aria-haspopup='dialog' aria-expanded='false' aria-label='Account: " + u.name + ", " + u.title + "'>" +
    "<span class='avatar'>" + ini + "<img src='assets/img/Avatar.png' alt='' data-hide></span><div><div class='nm'>" + u.name + '</div><small>' + u.title.toUpperCase() + '</small></div></div>' +
    '</div></header>' +
    "<div class='scrim' id='scrim'></div>" +
    "<aside class='drawer' aria-label='Main menu'><div class='dr-in'>" +
    "<span class='dr-brand'>MediHeal</span>" +
    "<a class='dr-exit' id='drExit' href='index.html' aria-label='Sign out'>" + svg('exit', 25) + '</a>' +
    '<nav>' + navLinks.map(n => "<a href='" + n[0] + ".html'>" + svg(n[2], 44) + n[1] + '</a>').join('') + '</nav>' +
    "<a class='dr-out' id='drOut' href='index.html'>Sign out</a>" +
    "<div class='dr-contact'>" + HIS.contact.email + '<br>' + HIS.contact.phone + '</div>' +
    '</div></aside>');
  document.querySelectorAll('img[data-fallback]').forEach(i => i.addEventListener('error', () => { i.src = i.dataset.fallback; }, { once: true }));
  document.querySelectorAll('img[data-hide]').forEach(i => i.addEventListener('error', () => i.remove(), { once: true }));
  const toggle = open => document.body.classList.toggle('menu-open', open);
  document.getElementById('burger').onclick = () => toggle(true);
  document.getElementById('scrim').onclick = () => toggle(false);
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
    const ini = a.name.replace(/^Dr\.\s*/, '').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase();
    panel.innerHTML =
      "<div class='am-id'><span class='am-av'>" + HIS.kit.esc(ini) + '</span><div style="min-width:0">' +
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

// ---- Notifications panel (session 22). Figma: "Notifications panel" 2072:3499 (Dashboard "Notifications open" 2072:3112; the same panel is drawn on every page, e.g. overlay 2008:1064).
// Measured, frame-local: panel (952,90) 420x492 r16 white, stroke #c8dcea. Panel-local: title (24,20) Lexend 500 18 #1b4e6b; subtitle (24,46) Inter 12 #6f8890;
// close button (360,20) 36x36 r8 stroke #c8dcea, "\u2715" Inter 500 16 #1b4e6b; divider y68 h1 #e3edf3; rows x24, y84 + 86*i, 372x78 r10 fill #f6fafd stroke #e3edf3
// (dot (14,17) 8x8 #1c6d9c; title (32,12) Inter 600 13 #1c2b30; body (32,33) Inter 12 #6f8890; time (32,55) Inter 500 11 #5b8db8); "Mark all as read" (24,436) 372x40 r8 #1c6d9c, Inter 600 13 white.
// ESTIMATED (Figma draws only the all-unread state): shadow, the read look (white row, no dot, title weight 500), "All caught up" subtitle, the disabled look of the button, hiding the bell badge at 0.
// Read state persists in localStorage key `mh_notif_read` (array of row indexes) through HIS.store; delete the key to reset. Esc, the close button or a click outside closes the panel.
// The outside-click test uses composedPath() because render() replaces the clicked button (panel.contains(target) would be false and close the panel).
(function notifications() {
  const bell = document.querySelector('.bell');
  if (!bell) return;
  const stage = document.querySelector('.stage,#stage') || document.body;
  if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
  const ITEMS = [
    ['Leave approved', 'Sofia Mendoza \u00b7 Sick leave, Aug 31 (1 day)', 'Today, 8:05 AM'],
    ['Leave request pending', 'Miguel Reyes \u00b7 Vacation leave, Sep 2\u20134', 'Today, 7:40 AM'],
    ['Absence needs review', 'Daniel Cruz \u00b7 No clock entry or leave on file', 'Today, 9:00 AM'],
    ['Payroll sync ready', '7 of 8 records ready for the Aug 16\u201331 period', 'Today, 9:15 AM']
  ];
  const KEY = HIS.store.KEY.notifRead;
  let read = HIS.store.get(KEY, []);
  const save = () => { HIS.store.set(KEY, read); };
  const css = document.createElement('style');
  css.textContent =
    '.nf-p{position:absolute;left:952px;top:90px;width:420px;height:492px;box-sizing:border-box;background:#fff;border-radius:16px;box-shadow:inset 0 0 0 1px #c8dcea,0 12px 32px rgba(15,30,46,.18);z-index:22;display:none;font-family:Inter,sans-serif}' +
    '.nf-p.on{display:block}' +
    '.nf-p *{box-sizing:border-box;margin:0}' +
    '.nf-t{position:absolute;left:24px;top:20px;font:500 18px/22.5px Lexend,Inter,sans-serif;color:#1b4e6b;white-space:nowrap}' +
    '.nf-s{position:absolute;left:24px;top:46px;font:400 12px/14.5px Inter,sans-serif;color:#6f8890;white-space:nowrap}' +
    '.nf-x{position:absolute;left:360px;top:20px;width:36px;height:36px;border:0;border-radius:8px;background:#fff;box-shadow:inset 0 0 0 1px #c8dcea;font:500 16px/36px Inter,sans-serif;color:#1b4e6b;cursor:pointer;padding:0;text-align:center}' +
    '.nf-x:hover{background:#e8f4fb}' +
    '.nf-d{position:absolute;left:0;top:68px;width:420px;height:1px;background:#e3edf3}' +
    '.nf-r{position:absolute;left:24px;width:372px;height:78px;border:0;border-radius:10px;background:#f6fafd;box-shadow:inset 0 0 0 1px #e3edf3;text-align:left;padding:0;cursor:pointer;font-family:Inter,sans-serif}' +
    '.nf-r:hover{background:#e8f4fb}' +
    '.nf-r.rd{background:#fff}' +
    '.nf-dot{position:absolute;left:14px;top:17px;width:8px;height:8px;border-radius:50%;background:#1c6d9c}' +
    '.nf-r.rd .nf-dot{display:none}' +
    '.nf-rt{position:absolute;left:32px;top:12px;font:600 13px/15.7px Inter,sans-serif;color:#1c2b30;white-space:nowrap}' +
    '.nf-r.rd .nf-rt{font-weight:500}' +
    '.nf-rb{position:absolute;left:32px;top:33px;font:400 12px/14.5px Inter,sans-serif;color:#6f8890;white-space:nowrap}' +
    '.nf-rm{position:absolute;left:32px;top:55px;font:500 11px/13.3px Inter,sans-serif;color:#5b8db8;white-space:nowrap}' +
    '.nf-m{position:absolute;left:24px;top:436px;width:372px;height:40px;border:0;border-radius:8px;background:#1c6d9c;color:#fff;font:600 13px/40px Inter,sans-serif;text-align:center;cursor:pointer;padding:0}' +
    '.nf-m:hover{background:#1b4e6b}' +
    '.nf-m:disabled{opacity:.5;cursor:default;background:#1c6d9c}';
  document.head.appendChild(css);
  const panel = document.createElement('div');
  panel.className = 'nf-p'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Notifications');
  stage.appendChild(panel);
  // Billing, Departments and Profile rebuild the stage with innerHTML, which drops the panel;
  // put it back so the bell keeps working on those pages.
  if (window.MutationObserver) new MutationObserver(() => { if (!panel.isConnected) stage.appendChild(panel); }).observe(stage, { childList: true });
  const badge = bell.querySelector('b');
  function render() {
    const unread = ITEMS.filter((_, i) => read.indexOf(i) < 0).length;
    panel.innerHTML =
      "<div class='nf-t'>Notifications</div>" +
      "<div class='nf-s'>" + (unread ? unread + ' unread' : 'All caught up') + ' \u00b7 Attendance and payroll</div>' +
      "<button class='nf-x' data-act='close' aria-label='Close notifications'>\u2715</button>" +
      "<div class='nf-d'></div>" +
      ITEMS.map((n, i) => "<button class='nf-r" + (read.indexOf(i) < 0 ? '' : ' rd') + "' data-n='" + i + "' style='top:" + (84 + 86 * i) + "px'><span class='nf-dot'></span><span class='nf-rt'>" + n[0] + "</span><span class='nf-rb'>" + n[1] + "</span><span class='nf-rm'>" + n[2] + '</span></button>').join('') +
      "<button class='nf-m' data-act='all'" + (unread ? '' : ' disabled') + '>Mark all as read</button>';
    if (badge) { badge.textContent = unread; badge.style.display = unread ? '' : 'none'; }
    bell.setAttribute('aria-label', unread ? 'Notifications, ' + unread + ' unread' : 'Notifications');
  }
  function setOpen(o) {
    if (o && !panel.isConnected) stage.appendChild(panel);
    panel.classList.toggle('on', o);
    bell.setAttribute('aria-expanded', o ? 'true' : 'false');
    if (o) document.body.classList.remove('menu-open');
  }
  panel.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'close') { setOpen(false); bell.focus(); return; }
    if (b.dataset.act === 'all') { read = ITEMS.map((_, i) => i); save(); render(); return; }
    if (b.dataset.n != null) { const i = +b.dataset.n; if (read.indexOf(i) < 0) { read.push(i); save(); render(); } }
  });
  bell.addEventListener('click', () => setOpen(!panel.classList.contains('on')));
  document.addEventListener('click', e => {
    if (!panel.classList.contains('on')) return;
    const path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(panel) < 0 && path.indexOf(bell) < 0) setOpen(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel.classList.contains('on')) setOpen(false); });
  render();
})();
