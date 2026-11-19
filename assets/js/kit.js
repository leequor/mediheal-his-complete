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

  HIS.kit = { esc: esc, GEOM: GEOM, modal: modal, dropdown: dropdown, pill: pill, row: row, toast: toast,
    modalStack: { open: stackOpen, close: stackClose, top: function () { return stack[stack.length - 1] || null; },
      depth: function () { return stack.length; }, all: function () { return stack.slice(); } } };

  watchOverlays();
})();