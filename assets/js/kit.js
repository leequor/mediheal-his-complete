// Shared UI kit (session 23, Phase 0 of docs/IMPROVEMENT-PLAN.md). The pieces every page was
// copying, in one place: the generic modal, the Figma-style dropdown, a status pill, a table row,
// a toast, `esc()` for markup, and the GEOM constants of the Figma action-modal design format
// (docs/IMPROVEMENT-PLAN.md "Design format every phase must follow"). All geometry is Figure
// frame-local px. Later phases build their action modals from GEOM so additions stay consistent.
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var GEOM = {
    w: 680, x: 380,                       // action modal is 680 wide, left edge at 380
    shell: {                              // three validated shells
      664: { h: 664, banner: 366, textarea: 484, buttons: 600 },
      568: { h: 568, textarea: 388, buttons: 504 },
      368: { h: 368, textarea: 388, buttons: 300 }
    },
    rowLabel: [120, 202, 284, 366],       // label y  ->  input y
    rowInput: [142, 224, 306, 388],
    col: { left: 32, right: 348, narrow: 300, wide: 616 },
    btn: { cancel: { x: 396, w: 100 }, ok: { x: 508, w: 140 } }
  };

  // ---- modal stack ---------------------------------------------------------------------------
  // Every overlay in the app joins one layer scale: .modal-bg (this kit), .ac-bg (the page-level
  // editors) and .cl-bg (the claim detail). Without it, a form opened from inside the claim dialog
  // was created at z-index 60 under a parent at 2500 — present in the DOM, reachable by script, and
  // invisible to a person. Layers are assigned in the order overlays are added, so a nested dialog
  // is always above the one that opened it, and removing it restores the previous top.
  var OVERLAY = '.modal-bg, .ac-bg, .cl-bg';
  var LAYER_BASE = 4000, LAYER_STEP = 10;
  var stack = [];

  function restack() {
    stack.forEach(function (el, i) { el.style.zIndex = String(LAYER_BASE + (i + 1) * LAYER_STEP); });
    document.body.classList.toggle('modal-open', stack.length > 0);
  }
  function stackOpen(el) {
    if (!el || stack.indexOf(el) > -1) return;
    stack.push(el);
    restack();
  }
  function stackClose(el) {
    var i = stack.indexOf(el);
    if (i < 0) return;
    stack.splice(i, 1);
    restack();
  }
  // The observer keeps the stack true even for the overlays this file does not create.
  function watchOverlays() {
    if (!document.body || !window.MutationObserver) return;
    new MutationObserver(function (records) {
      var changed = false;
      records.forEach(function (r) {
        [].forEach.call(r.addedNodes, function (n) {
          if (n.nodeType === 1 && n.matches && n.matches(OVERLAY) && stack.indexOf(n) < 0) { stack.push(n); changed = true; }
        });
        [].forEach.call(r.removedNodes, function (n) {
          if (n.nodeType !== 1) return;
          var i = stack.indexOf(n);
          if (i > -1) { stack.splice(i, 1); changed = true; }
        });
      });
      if (changed) restack();
    }).observe(document.body, { childList: true });
  }
  // Escape belongs to the top overlay only. With a single dialog open nothing changes; with two,
  // the inner one closes and the outer one keeps its state.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || stack.length < 2) return;
    e.stopImmediatePropagation();
    var top = stack[stack.length - 1];
    var x = top.querySelector('[data-x], [data-close], .cl-x');
    if (x) x.click();
  }, true);

  // Generic modal (NOT a Figma screen: the temporary form shell used where Figma has no form yet).
  function modal(spec) {
    spec = spec || {};
    var bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = "<form class='modal' role='dialog' aria-modal='true'><h3>" + spec.title + '</h3><p>' + (spec.sub || '') + '</p>' + spec.body +
      "<div class='modal-err' role='alert'></div>" +
      "<div class='actions'><button type='button' class='mbtn out' data-x>Cancel</button><button class='mbtn'>" + (spec.saveLabel || 'Save') + '</button></div></form>';
    var errEl = bg.querySelector('.modal-err');
    var close = function () { bg.remove(); document.removeEventListener('keydown', escKey); stackClose(bg); };
    var escKey = function (e) { if (e.key === 'Escape') close(); };
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    bg.querySelector('[data-x]').onclick = close;
    bg.querySelector('form').onsubmit = function (e) {
      e.preventDefault();
      errEl.textContent = '';
      // A callback returning false is asking for the dialog to stay open: a validation or
      // business-rule failure. Anything else means the work is done and the dialog closes. Before
      // this contract the dialog closed unconditionally, so a rejected approval looked accepted.
      var res = spec.onSave(Object.fromEntries(new FormData(e.target)), errEl);
      if (res === false) {
        if (!errEl.textContent) errEl.textContent = 'That could not be saved. Check the values and try again.';
        var field = bg.querySelector('input,select,textarea');
        if (field) field.focus();
        return;
      }
      close();
    };
    document.addEventListener('keydown', escKey);
    document.body.appendChild(bg);
    stackOpen(bg);
    var first = bg.querySelector('input,select');
    if (first) first.focus();
    return { close: close };
  }

  // Figma dropdown frames: 236x45, items 38 high.
  function dropdown(el, spec) {
    var options = spec.options;
    el.classList.add('dd');
    el.innerHTML = "<button type='button' class='dd-btn'><span class='dd-val'></span>" + svg('chevron', 16) + "</button><div class='dd-panel'>" +
      options.map(function (o, i) { return "<button type='button' data-i='" + i + "'>" + o + '</button>'; }).join('') + '</div>';
    var val = el.querySelector('.dd-val');
    val.textContent = spec.value || options[0];
    el.querySelector('.dd-btn').onclick = function (e) {
      e.stopPropagation();
      document.querySelectorAll('.dd.open').forEach(function (d) { if (d !== el) d.classList.remove('open'); });
      el.classList.toggle('open');
    };
    el.querySelector('.dd-panel').onclick = function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var v = options[+b.dataset.i];
      val.textContent = v;
      el.classList.remove('open');
      spec.onChange(v);
    };
    return { value: function () { return val.textContent; }, set: function (v) { val.textContent = v; } };
  }
  document.addEventListener('click', function () {
    document.querySelectorAll('.dd.open').forEach(function (d) { d.classList.remove('open'); });
  });

  // Status pill: the shared `.badge` look (components.css); `kind` is the status colour class.
  function pill(text, kind) { return "<span class='badge " + (kind || '') + "'>" + esc(text) + '</span>'; }

  // Table row: `cols` is a CSS grid-template-columns value; the header uses the same helper.
  function row(cells, cols) {
    return "<div class='kit-row'" + (cols ? " style='grid-template-columns:" + cols + "'" : '') + '>' +
      cells.map(function (c) { return "<span class='kit-td'>" + c + '</span>'; }).join('') + '</div>';
  }

  // Toast: one shared node, announced to screen readers, auto-hides after 3.2s.
  function toast(msg) {
    var el = document.getElementById('kit-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'kit-toast';
      el.className = 'kit-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.classList.remove('on'); }, 3200);
  }


  // ---- focus return -----------------------------------------------------------------------------
  // Several pages rebuild the whole view when a dialog closes, which destroys the button that opened
  // it; focus then falls to <body> and a keyboard user loses their place. Remember the trigger by
  // description (the element itself is often gone), and after a dialog disappears put focus back on
  // the matching control in the freshly rendered page.
  var lastTrigger = null, hadDialog = false;
  var DIALOG_SEL = '.ac-bg, .bl-modal, .pe-modal, .tp-modal, .at-modal, .cl-bg, .dm-bg, [class$=-modal], [role=dialog]';

  function describe(el) {
    return { tag: el.tagName, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48), cls: el.className || '' };
  }

  // A hidden template container is not an open dialog: only a painted one blocks focus return.
  function dialogOpen() {
    var list = document.querySelectorAll(DIALOG_SEL);
    for (var i = 0; i < list.length; i++) { if (list[i].offsetWidth || list[i].offsetHeight) return true; }
    return false;
  }

  var TRIGGER_SEL = 'button, a, [role=button], [data-open], [data-modal], [data-act]';
  var FOCUSABLE_SEL = 'button, a[href], input, select, textarea, [tabindex]';

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest(TRIGGER_SEL) : null;
    if (!t || !t.offsetWidth) return;
    if (t.closest(DIALOG_SEL)) return;          // a control inside the dialog is not the trigger
    // A table row can open a dialog without being focusable; there is then nowhere to return focus,
    // so remember the nearest focusable ancestor instead (or nothing at all).
    var focusable = t.matches && t.matches(FOCUSABLE_SEL) ? t : (t.closest ? t.closest(FOCUSABLE_SEL) : null);
    lastTrigger = focusable ? describe(focusable) : null;
  }, true);

  function restoreFocus() {
    // only when focus was actually lost, and never while another dialog is on screen
    if (document.activeElement && document.activeElement !== document.body) return;
    if (dialogOpen() || !lastTrigger) return;
    var same = function (el) {
      return el.offsetWidth && el.tagName === lastTrigger.tag &&
        (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 48) === lastTrigger.text;
    };
    var cands = [].slice.call(document.querySelectorAll(lastTrigger.tag)).filter(same);
    var hit = cands[0];
    if (hit && typeof hit.focus === 'function') hit.focus({ preventScroll: true });
  }

  // A dialog that closes re-renders the page, sometimes over several frames and sometimes after a
  // second render of its own; keep trying for about a second, and stop as soon as focus is somewhere
  // real (restoreFocus itself does nothing when focus is already on a control).
  function scheduleRestore() {
    var tries = 0;
    var timer = setInterval(function () {
      restoreFocus();
      if (++tries > 16) clearInterval(timer);
    }, 60);
    restoreFocus();
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') scheduleRestore();
  }, true);

  if (window.MutationObserver) {
    var mo = new MutationObserver(function (records) {
      var removedDialog = false;
      if (dialogOpen()) { hadDialog = true; return; }
      for (var i = 0; i < records.length && !removedDialog; i++) {
        var rm = records[i].removedNodes;
        for (var j = 0; j < rm.length; j++) {
          var n = rm[j];
          if (n.nodeType === 1 && (n.matches && n.matches(DIALOG_SEL) || (n.querySelector && n.querySelector(DIALOG_SEL)))) { removedDialog = true; break; }
        }
      }
      if (removedDialog || hadDialog) { scheduleRestore(); }
      hadDialog = false;
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // The three input pages are Figma stacks, not <form> elements, so pressing Enter in a field did
// nothing at all. Every one of them submits through a #confirm button, so Enter anywhere in a text
// field now confirms - except in a textarea, where Enter is a newline.
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing) return;
  var t = e.target;
  if (!t || !t.matches || !t.matches('input, select')) return;
  if (t.tagName === 'SELECT') return;
  if (t.type === 'checkbox' || t.type === 'radio' || t.type === 'submit' || t.type === 'file') return;
  var btn = document.getElementById('confirm');
  if (!btn || !btn.offsetWidth) return;
  e.preventDefault();
  btn.click();
});

function currency(value) {
  var text = String(value == null ? '' : value).trim().replace(/^(₱|PHP)\s*/i, '');
  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d{1,2})?$/.test(text)) return NaN;
  var n = Number(text.replace(/,/g, '')); return isFinite(n) ? n : NaN;
}
HIS.kit = { esc: esc, currency: currency, GEOM: GEOM, modal: modal, dropdown: dropdown, pill: pill, row: row, toast: toast,
    modalStack: { open: stackOpen, close: stackClose, top: function () { return stack[stack.length - 1] || null; },
      depth: function () { return stack.length; }, all: function () { return stack.slice(); } } };

  watchOverlays();

  // Legacy frame-based forms use positioned label divs. Associate them with real controls while
  // retaining their geometry, and keep keyboard/background access within the active dialog.
  var fieldSeq = 0, locked = [], activeDialog = null;
  function visible(el) { return !!(el.offsetWidth || el.offsetHeight) && getComputedStyle(el).visibility !== 'hidden'; }
  function topDialog() {
    var ds = [].slice.call(document.querySelectorAll('[role=dialog]')).filter(visible);
    function layer(el) { var z = 0; for (var p = el; p; p = p.parentElement) z = Math.max(z, Number(getComputedStyle(p).zIndex) || 0); return z; }
    ds.sort(function (a, b) { return layer(a) - layer(b); }); return ds[ds.length - 1] || null;
  }
  function repairDialogs() {
    document.querySelectorAll('[role=dialog]').forEach(function (d) {
      if (!visible(d)) return;
      var title = d.querySelector('h2,h3,.tp-m-t,.pe-m-t,.pm-t,.bl-m-t,.at-m-t,.pr-m-t,.ap-title,.at-m-title,.pr-m-title');
      if (!d.hasAttribute('aria-label') && !d.hasAttribute('aria-labelledby') && title) d.setAttribute('aria-label', title.textContent.trim());
      var labels = [].slice.call(d.querySelectorAll('.tp-m-l,.pe-m-l,.pm-l,.bl-m-l,.at-m-l,.pr-m-l,.ap-l'));
      var fields = [].slice.call(d.querySelectorAll('input:not([type=hidden]),select,textarea'));
      fields.forEach(function (f, i) {
        if ((f.labels && f.labels.length) || f.hasAttribute('aria-label') || f.hasAttribute('aria-labelledby')) return;
        var l = labels[i]; if (!l) return;
        if (!f.id) f.id = 'kit-field-' + (++fieldSeq);
        if (l.tagName !== 'LABEL') { var real = document.createElement('label'); [].slice.call(l.attributes).forEach(function (a) { real.setAttribute(a.name, a.value); }); real.textContent = l.textContent; l.replaceWith(real); l = real; }
        l.setAttribute('for', f.id);
      });
    });
    var top = topDialog();
    if (top !== activeDialog) {
      locked.forEach(function (r) { r.el.inert = r.inert; if (r.hidden === null) r.el.removeAttribute('aria-hidden'); else r.el.setAttribute('aria-hidden', r.hidden); });
      locked = []; activeDialog = top;
      if (top && top.getAttribute('aria-modal') === 'true') {
        for (var node = top; node && node.parentElement && node.parentElement !== document.documentElement; node = node.parentElement) {
          [].slice.call(node.parentElement.children).forEach(function (sibling) {
            if (sibling === node || /^(SCRIPT|STYLE|LINK)$/.test(sibling.tagName)) return;
            locked.push({ el: sibling, inert: sibling.inert, hidden: sibling.getAttribute('aria-hidden') }); sibling.inert = true; sibling.setAttribute('aria-hidden', 'true');
          });
        }
      }
    }
    if (!HIS.rbac || !HIS.rbac.can) return;
    var page = document.body.dataset.page, policy = {
      consultation: [['[data-modal=dx]', 'diagnosis']], personnel: [['[data-modal],[data-off],[data-ok]', 'personnel']],
      attendance: [['[data-act=approve],[data-act=reopen]', 'verifyAttendance'], ['[data-act=clockin],[data-act=clockout],[data-act=lapprove],[data-act=ldecline],[data-act=reviewleave],[data-act=reviewunpaid],[data-act=newreq]', 'attendance']],
      payroll: [['[data-modal=gen],[data-modal=proc],[data-corr]:not([data-corr=detail]):not([data-corr=pdf])', 'payroll'], ['[data-ts=approve],[data-ts=reopen]', 'verifyAttendance']],
      treatment: [['[data-modal=rx],[data-modal=order],[data-modal=proc],[data-modal=status],[data-modal=summary]', 'prescribe'], ['[data-modal=pharmacy]', 'pharmacyWork'], ['[data-modal=bed]', 'admission']],
      billing: [['[data-modal=pay],[data-modal=cov]', 'money']],
      charges: [['[data-act]', 'money']],
      pharmacy: [['#phNewRx', 'prescribe'], ['#phReceive,[data-batch],[data-act]:not([data-act=view])', 'pharmacyWork']],
      laboratory: [['#lbNew', 'labOrder'], ['[data-act]:not([data-act=view])', 'labWork']],
      profile: [['[data-act=edit]', 'patientDetails'], ['[data-act=transfer],[data-act=discharge]', 'admission']]
    };
    (policy[page] || []).forEach(function (rule) { document.querySelectorAll(rule[0]).forEach(function (b) { if (!HIS.rbac.can(rule[1])) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); b.title = 'Read-only for this account'; } }); });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    repairDialogs(); var d = topDialog(); if (!d || d.getAttribute('aria-modal') !== 'true') return;
    var fields = [].slice.call(d.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')).filter(visible);
    if (!fields.length) { e.preventDefault(); d.tabIndex = -1; d.focus(); return; }
    var first = fields[0], last = fields[fields.length - 1];
    if (!d.contains(document.activeElement) || (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
  }, true);
  var repairPending = false;
  new MutationObserver(function () { if (repairPending) return; repairPending = true; requestAnimationFrame(function () { repairPending = false; repairDialogs(); }); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('his:storage-error', function (e) {
    var alert = document.getElementById('storage-error');
    if (!alert) { alert = document.createElement('div'); alert.id = 'storage-error'; alert.setAttribute('role', 'alert'); alert.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;padding:16px;background:#ffd6d3;color:#9b1c14;z-index:10000'; document.body.appendChild(alert); }
    alert.textContent = e.detail;
  });
})();
