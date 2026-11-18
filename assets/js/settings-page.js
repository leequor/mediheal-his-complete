// Configuration screen (M12). The charge master's interface.
//
// WHY THIS EXISTS
// `tariffs.setPrice()` was implemented and audited in the same milestone as the charge master, but
// there was no screen, so the effective-dating mechanism was invisible: a price could only be changed
// from the browser console, and the proposed 2027 cardiology rate existed only in code. The brief is
// explicit that administrators must be able to configure supported workflows through the existing
// interface patterns, and that a missing tariff must be surfaced rather than invented.
//
// WHAT IT DOES
// Lists the price in force today for every code, with the date it took effect. "New price" appends a
// new effective-dated row for an existing code — it never edits one — so a charge raised last month
// keeps the price it was raised at. "History" shows every row a code has ever had.
//
// The laboratory catalogue and the bed configuration are read from code (`lab.js` CATALOG,
// `admissions.js` WARDS) and are shown here read-only with their counts, so the screen does not
// pretend to configure what it cannot.
(function () {
  var stage = document.getElementById('stage');
  var esc = HIS.kit.esc;
  var q = '';
  var TODAY = new Date('2026-08-31T12:00:00+08:00');

  function peso(n) {
    return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function day(iso) {
    if (!iso) return '\u2014';
    var d = new Date(iso + 'T00:00:00+08:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function rows() {
    var list = HIS.tariffs.current(TODAY);
    var needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(function (t) {
      return (t.code + ' ' + t.description + ' ' + t.category).toLowerCase().indexOf(needle) > -1;
    });
  }

  function render() {
    var list = rows();
    var all = HIS.tariffs.all();
    var future = all.filter(function (t) { return new Date(t.effectiveFrom) > TODAY; });
    var labCount = Object.keys(HIS.lab ? HIS.lab.CATALOG : {}).length;
    var bedCount = HIS.admissions ? HIS.admissions.beds().length : 0;
    var wardCount = HIS.admissions ? HIS.admissions.wards().length : 0;

    stage.innerHTML =
      "<h1 class='ad-title'>Configuration</h1>" +
      "<p class='ad-sub'>Only service tariffs are administered here. The laboratory catalogue, the bed inventory, the payroll policy and the department list are fixed for this facility and shown read-only below.</p>" +
      "<div class='ad-body'>" +

      "<div class='ad-kpis'>" +
      "<div class='ad-kpi'><div class='l'>Tariff codes</div><div class='v'>" + HIS.tariffs.current(TODAY).length + "</div><div class='d'>In force today</div></div>" +
      "<div class='ad-kpi'><div class='l'>Price rows</div><div class='v'>" + all.length + "</div><div class='d'>Every version kept</div></div>" +
      "<div class='ad-kpi'><div class='l'>Scheduled changes</div><div class='v'>" + future.length + "</div><div class='d'>Effective after today</div></div>" +
      "<div class='ad-kpi'><div class='l'>Beds in service</div><div class='v'>" + bedCount + "</div><div class='d'>Across " + wardCount + ' wards \u00b7 read-only</div></div>' +
      '</div>' +

      "<div class='ad-card' style='margin-bottom:24px'>" +
      "<div class='ad-bar'><h2>Service tariffs</h2><span class='ad-count'>" + list.length + ' of ' + HIS.tariffs.current(TODAY).length + '</span>' +
      "<label class='ad-search'>" + svg('search', 16) + "<input id='cfQ' type='search' placeholder='Search code or description' aria-label='Search tariffs' value='" + esc(q) + "'></label>" +
      "<button class='ad-btn' id='cfNew' type='button'>+ New price</button>" +
      '</div>' +
      "<div class='ad-th ad-g-cfg'><span>Code</span><span>Service</span><span>Price</span><span>Effective from</span><span>State</span><span></span></div>" +
      (list.length ? list.map(function (t) {
        return "<div class='ad-tr ad-g-cfg'>" +
          "<span class='ad-who'><b>" + esc(t.code) + '</b><small>' + esc(t.unit) + '</small></span>' +
          "<span class='ad-who'><b>" + esc(t.description) + '</b><small>' + esc(HIS.tariffs.CATEGORIES[t.category] || t.category) + '</small></span>' +
          "<span class='num'>" + peso(t.price) + '</span>' +
          "<span class='mu'>" + esc(day(t.effectiveFrom)) + '</span>' +
          "<span>" + (t.proposed ? "<span class='badge warn'>Proposed</span>" : "<span class='badge ok'>Active</span>") + '</span>' +
          "<span style='text-align:right'><button class='ad-btn ghost' data-act='history' data-code='" + esc(t.code) + "'>History</button></span></div>";
      }).join('') : "<div class='ad-empty'><b>No tariff matches</b>Clear the search.</div>") +
      "<div class='ad-foot'>A price is superseded, never edited and never deleted: a new row takes over from its effective " +
      'date and the old one stays in the history. A charge copies the price it was raised at into its own record, so a ' +
      'change here alters the next charge and nothing else \u2014 no historical invoice moves.</div>' +
      '</div>' +

      "<div class='ad-card'>" +
      "<div class='ad-bar'><h2>Fixed for this facility \u2014 not editable here</h2><span class='ad-count'>View only</span></div>" +
      "<div class='ad-th' style='grid-template-columns:1.4fr .7fr 1.6fr'><span>Area</span><span>Count</span><span>Where it lives</span></div>" +
      "<div class='ad-tr' style='grid-template-columns:1.4fr .7fr 1.6fr'>" +
      '<span><b>Laboratory catalogue</b></span>' +
      "<span><b>" + labCount + '</b></span>' +
      "<span class='mu'>Tests, prices and reference ranges \u00b7 maintained with the application</span></div>" +
      "<div class='ad-tr' style='grid-template-columns:1.4fr .7fr 1.6fr'>" +
      '<span><b>Beds and wards</b></span>' +
      "<span><b>" + bedCount + '</b></span>' +
      "<span class='mu'>Wards, bed numbering and bed types \u00b7 maintained with the application</span></div>" +
      "<div class='ad-tr' style='grid-template-columns:1.4fr .7fr 1.6fr'>" +
      '<span><b>Payroll policy</b></span>' +
      "<span><b>" + (HIS.payrollCalc ? HIS.payrollCalc.POLICIES.length : '\u2014') + '</b></span>' +
      "<span class='mu'>Effective-dated policies, each with a cited source \u00b7 maintained with the application</span></div>" +
      "<div class='ad-tr' style='grid-template-columns:1.4fr .7fr 1.6fr'>" +
      '<span><b>Departments</b></span>' +
      "<span><b>" + ((window.HIS.departments || []).length || '\u2014') + '</b></span>' +
      "<span class='mu'>Heads, physicians, beds and consultation fees \u00b7 maintained with the application</span></div>" +
      "<div class='ad-foot'>These four are a fixed property of this facility and are maintained with the application rather " +
      'than from this screen. They are listed so the boundary between \u201cadministrable here\u201d and \u201cfixed\u201d is ' +
      'visible rather than implied.</div>' +
      '</div>' +

      "<div class='ad-note'><b>About these prices.</b> The figures are sample tariffs used so that a service can be priced " +
      'end to end; they are not a published hospital price list. Payer-specific tiers and a VAT rule per line are not ' +
      'modelled.</div>' +
      '</div>';

    document.getElementById('cfQ').oninput = function (e) {
      q = e.target.value; render();
      var f = document.getElementById('cfQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length);
    };
    document.getElementById('cfNew').onclick = function () { priceModal(document.getElementById('cfNew')); };
    stage.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () { historyModal(b.dataset.code, b); };
    });
  }

  function modal(opts) {
    var bg = document.createElement('div');
    bg.className = 'ac-bg';
    bg.innerHTML =
      "<form class='ac-m' role='dialog' aria-modal='true' aria-labelledby='mdTitle'>" +
      "<h3 id='mdTitle'>" + esc(opts.title) + '</h3>' +
      "<p class='ac-s'>" + esc(opts.sub || '') + '</p>' +
      opts.body +
      "<div class='ac-err' id='mdErr' role='alert'></div>" +
      "<div class='ac-a'><button type='button' class='mbtn out' data-x>Cancel</button>" +
      "<button type='submit' class='mbtn'>" + esc(opts.ok || 'Save') + '</button></div></form>';
    document.body.appendChild(bg);
    var opener = opts.trigger || document.activeElement;
    function close() {
      bg.remove();
      document.removeEventListener('keydown', escKey);
      if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus();
    }
    function escKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', escKey);
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    bg.querySelector('[data-x]').onclick = close;
    bg.querySelector('form').onsubmit = function (ev) {
      ev.preventDefault();
      var v = Object.fromEntries(new FormData(ev.target).entries());
      var err = opts.onSubmit(v, bg.querySelector('#mdErr'), bg);
      if (!err) { close(); render(); }
    };
    var first = bg.querySelector('input,select,textarea');
    if (first) first.focus();
    if (opts.after) opts.after(bg);
    return { close: close };
  }

  function priceModal(trigger) {
    var codes = HIS.tariffs.current(TODAY);
    modal({
      title: 'Set a new price',
      sub: 'The current price stays on file. The new one applies from the date you choose.',
      ok: 'Add price', trigger: trigger,
      body:
        "<div class='ac-f'><label for='cfCode'>Tariff</label><select id='cfCode' name='code'>" +
        codes.map(function (t) {
          return "<option value='" + esc(t.code) + "'>" + esc(t.code + ' \u00b7 ' + t.description + ' \u00b7 now ' + peso(t.price)) + '</option>';
        }).join('') + '</select></div>' +
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='cfPrice'>New price (\u20b1)</label><input id='cfPrice' name='price' type='number' min='0' step='0.01' required></div>" +
        "<div class='ac-f'><label for='cfFrom'>Effective from</label><input id='cfFrom' name='effectiveFrom' type='date' required></div>" +
        '</div>' +
        "<div class='ac-f'><label for='cfProp'>State</label><select id='cfProp' name='proposed'>" +
        "<option value=''>Active as soon as its date arrives</option>" +
        "<option value='1'>Proposed — shown but not applied</option></select></div>" +
        "<p class='ac-hint'>A price that starts in the future is listed as scheduled and is not returned by " +
        '<code>priceFor()</code> until its date. Nothing already charged is recalculated.</p>',
      onSubmit: function (v, err) {
        var t = HIS.tariffs.current(TODAY).filter(function (x) { return x.code === v.code; })[0];
        var r = HIS.tariffs.setPrice({
          code: v.code, category: t ? t.category : 'consultation',
          description: t ? t.description : v.code, unit: t ? t.unit : 'unit',
          price: v.price, effectiveFrom: v.effectiveFrom, proposed: !!v.proposed
        });
        if (!r.ok) { err.textContent = r.error; return true; }
        HIS.kit.toast(v.code + ' set to ' + peso(r.tariff.price) + ' from ' + r.tariff.effectiveFrom + '.');
        return false;
      }
    });
  }

  function historyModal(code, trigger) {
    var rows = HIS.tariffs.history(code);
    modal({
      title: code + ' \u2014 price history', sub: rows.length + ' row(s), newest last', ok: 'Close', trigger: trigger,
      body: "<div class='ad-kv'>" + rows.map(function (t) {
        return '<div><dt>' + esc(day(t.effectiveFrom)) + (t.proposed ? ' \u00b7 proposed' : '') + '</dt><dd>' +
          esc(peso(t.price) + ' per ' + t.unit) + (t.addedBy ? ' \u00b7 added by ' + t.addedBy : '') + '</dd></div>';
      }).join('') + '</div>' +
        "<p class='ac-hint'>Rows are never edited or removed. A charge raised while one of these was in force keeps that " +
        'price for good, in its own <code>priceSnapshot</code>.</p>',
      onSubmit: function () { return false; }
    });
  }

  function svg(name, size) {
    var paths = { search: "<circle cx='11' cy='11' r='7'/><path d='m20 20-3.5-3.5'/>" };
    return "<svg width='" + size + "' height='" + size + "' viewBox='0 0 24 24' fill='none' stroke='#8a97a6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>" + (paths[name] || '') + '</svg>';
  }

  render();
})();
