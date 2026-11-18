// Deep links (final QA). A notification is a shortcut to work, not a message: clicking one has to
// land on the record it is about. Each notification therefore carries a page and a record id, and
// this module is the single place that turns "?focus=<id>" into a located, highlighted row.
//
// The static site has no router, so the contract is deliberately small:
//   ?focus=<record id>   locate that row, scroll to it, flash it, and optionally open its action
//   ?tab=<name>          arrive on a specific tab where the page has tabs
// The parameter is consumed with replaceState as soon as it has been used, so a refresh does not
// replay the arrival and a copied URL does not carry a stale instruction.
//
// Nothing here changes a record. Arriving at a task is not completing it.
(function () {
  function params() {
    try { return new URLSearchParams(location.search); } catch (e) { return null; }
  }
  function param(name) {
    var p = params();
    return p ? p.get(name) : null;
  }
  function clear(name) {
    try {
      var u = new URL(location.href);
      if (!u.searchParams.has(name)) return;
      u.searchParams.delete(name);
      var q = u.searchParams.toString();
      history.replaceState(null, '', u.pathname + (q ? '?' + q : '') + u.hash);
    } catch (e) { /* file:// or a blocked history API: leaving the parameter is harmless */ }
  }

  // The row that carries this id. Rows are the app's own classes, and the id is printed in the first
  // cell of each, so a text match inside a row container is enough and no page needs a new attribute.
  var ROWS = '.ad-tr, .pr-r, .dc-row, .bl-row, .at-r, .a-row, tbody tr';
  function rowFor(id) {
    if (!id) return null;
    // 1. a row that carries the id as data (billing, charges, admissions).
    var tagged = null;
    try { tagged = document.querySelector('[data-id="' + id.replace(/"/g, '\"') + '"]'); } catch (e) { tagged = null; }
    if (tagged) return tagged.closest(ROWS) || tagged;
    // 2. a cell whose whole text is the id — walks up to the row that owns it, so an id printed
    //    inside a <b> or a <small> still resolves.
    var cells = document.querySelectorAll(ROWS + ' b, ' + ROWS + ' span, ' + ROWS + ' small, ' + ROWS + ' td');
    for (var c = 0; c < cells.length; c++) {
      if (cells[c].textContent.trim() === id) return cells[c].closest(ROWS);
    }
    // 3. any row whose text mentions it (batch codes, drug names, patient names).
    var rows = document.querySelectorAll(ROWS);
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].textContent.indexOf(id) > -1) return rows[i];
    }
    return null;
  }

  function toast(text) {
    if (window.HIS && HIS.kit && HIS.kit.toast) { HIS.kit.toast(text); return; }
    var d = document.createElement('div');
    d.className = 'dl-tip';
    d.textContent = text;
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 2600);
  }

  // Locate, reveal, flash, and optionally open. Returns true when the record was found.
  function hit(id, opts) {
    opts = opts || {};
    if (!id) return false;
    var row = opts.row || rowFor(id);
    if (!row) {
      toast('That record is no longer on this page.');
      return false;
    }
    try { row.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { row.scrollIntoView(); }
    row.classList.remove('dl-hit');
    void row.offsetWidth;            // restart the animation if it is already running
    row.classList.add('dl-hit');
    setTimeout(function () { row.classList.remove('dl-hit'); }, 2600);
    if (opts.open) {
      var btn = row.querySelector(opts.open);
      if (btn) setTimeout(function () { btn.click(); }, 260);
    }
    return true;
  }

  window.HIS = window.HIS || {};
  HIS.deepLink = { param: param, clear: clear, rowFor: rowFor, hit: hit, toast: toast };

  // ---- arrival --------------------------------------------------------------------------------
  // Only a read-only action is opened automatically. Anything that changes a record stays closed:
  // arriving at a task is not doing it, and a notification click must never validate a result or
  // discharge a patient.
  var OPEN = {
    'laboratory.html': '[data-act="view"]'
  };

  function arrive() {
    var f = param('focus');
    var tab = param('tab');
    if (tab) clear('tab');           // the page has already read it during its own render
    if (!f) return;
    var open = OPEN[(location.pathname.split('/').pop() || '').toLowerCase()] || null;
    var tries = 0;
    (function look() {
      var row = rowFor(f);
      if (row) { clear('focus'); hit(f, { row: row, open: open }); return; }
      if (++tries < 12) { setTimeout(look, 200); return; }
      clear('focus');
      toast('That record is no longer on this page.');
    })();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrive);
  else setTimeout(arrive, 0);
})();
