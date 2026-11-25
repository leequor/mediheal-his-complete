// Laboratory screen (M6). Uses the admin screen format established in M2 (admin-pages.css):
// KPI strip, one card with a toolbar and a table, an action-form modal. No new geometry.
//
// The order of the buttons follows the workflow and nothing else: an order shows exactly the one
// action its status allows, so the screen cannot offer a step the store would refuse.
(function () {
  var stage = document.getElementById('stage');
  var esc = HIS.kit.esc;
  var q = '', statusFilter = 'all', priorityFilter = 'all';

  function when(iso) {
    if (!iso) return '\u2014';
    var d = new Date(iso);
    if (isNaN(d)) return '\u2014';
    return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function patientName(id) {
    var p = HIS.registry && HIS.registry.byId(id);
    return p ? p.name : id;
  }
  function statusPill(s) {
    // One hue per state: quiet grey before work starts, blue once it is in the lab,
    // violet while it is being processed, amber when a value needs eyes, green when safe.
    var map = { Ordered: 'off', Collected: 'info', 'In Process': 'proc', Resulted: 'teal', Validated: 'ok', Cancelled: 'red' };
    return "<span class='badge " + (map[s] || 'off') + "'>" + esc(s) + '</span>';
  }
  function flagPill(f) {
    if (!f) return '';
    var cls = f === 'Critical' ? 'red' : f === 'Abnormal' ? 'warn' : 'norm';
    // 'flag' keeps the pill compact so its text lines up with the test name above it.
    return "<span class='badge flag " + cls + "'>" + esc(f) + '</span>';
  }

  function visible() {
    var needle = q.trim().toLowerCase();
    return HIS.lab.all().filter(function (o) {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (priorityFilter !== 'all' && o.priority !== priorityFilter) return false;
      if (!needle) return true;
      return (o.id + ' ' + o.patientId + ' ' + patientName(o.patientId) + ' ' + o.test + ' ' + o.orderedBy)
        .toLowerCase().indexOf(needle) > -1;
    }).sort(function (a, b) { return new Date(b.orderedAt) - new Date(a.orderedAt); });
  }

  function actionFor(o) {
    var main;
    if (o.status === 'Ordered') main = "<button class='ad-btn' data-act='collect' data-id='" + esc(o.id) + "'>Collect specimen</button>";
    else if (o.status === 'Collected') main = "<button class='ad-btn' data-act='process' data-id='" + esc(o.id) + "'>Start processing</button>";
    else if (o.status === 'In Process') main = "<button class='ad-btn' data-act='result' data-id='" + esc(o.id) + "'>Enter result</button>";
    else if (o.status === 'Resulted') main = "<button class='ad-btn' data-act='validate' data-id='" + esc(o.id) + "'>Validate</button>";
    else main = "<button class='ad-btn ghost' data-act='view' data-id='" + esc(o.id) + "'>View report</button>";
    // M12: a validated result cannot be cancelled, but anything before it can — and cancelling has a
    // stated billing consequence, so the action is offered rather than hidden.
    if (o.status !== 'Validated' && o.status !== 'Cancelled') {
      main += "<button class='ad-btn ghost' data-act='cancel' data-id='" + esc(o.id) + "'>Cancel</button>";
    }
    return main;
  }

  function render() {
    var st = HIS.lab.stats();
    var list = visible();
    var critical = HIS.lab.all().filter(function (o) {
      return o.status === 'Validated' && o.result && o.result.flag === 'Critical' && !o.criticalAck;
    });

    stage.innerHTML =
      "<h1 class='ad-title'>Laboratory</h1>" +
      "<p class='ad-sub'>Test orders, specimen collection, result entry and validation. A result reaches the patient record only after it is validated.</p>" +
      "<div class='ad-body'>" +

      "<div class='ad-kpis'>" +
      "<div class='ad-kpi'><div class='l'>Awaiting collection</div><div class='v'>" + st.ordered + "</div><div class='d'>Specimen not yet taken</div></div>" +
      "<div class='ad-kpi b'><div class='l'>In process</div><div class='v'>" + (st.collected + st.processing) + "</div><div class='d'>Collected or running</div></div>" +
      "<div class='ad-kpi y'><div class='l'>Awaiting validation</div><div class='v'>" + st.resulted + "</div><div class='d'>Entered, not released</div></div>" +
      "<div class='ad-kpi g'><div class='l'>Validated</div><div class='v'>" + st.validated + "</div><div class='d'>Released to the record</div></div>" +
      '</div>' +

      (critical.length ? "<div class='ad-alert'><b>" + critical.length + ' critical result' + (critical.length > 1 ? 's' : '') + ' awaiting acknowledgement</b>' +
        critical.map(function (o) {
          return "<div class='ad-alert-row'><span>" + esc(o.id + ' \u00b7 ' + o.test + ' \u00b7 ' + patientName(o.patientId)) +
            '</span><span>' + esc(o.result.value + ' ' + o.result.unit + ' (ref ' + o.result.reference + ')') + '</span>' +
            "<button class='ad-btn' data-act='ack' data-id='" + esc(o.id) + "'>Acknowledge</button></div>";
        }).join('') + '</div>' : '') +

      "<div class='ad-card'>" +
      "<div class='ad-bar'>" +
      "<h2>Test orders</h2><span class='ad-count'>" + list.length + ' of ' + st.total + '</span>' +
      "<label class='ad-search'>" + svg('search', 16) + "<input id='lbQ' type='search' placeholder='Search order, patient or test' aria-label='Search orders' value='" + esc(q) + "'></label>" +
      "<select class='ad-sel' id='lbStatus' aria-label='Filter by status'>" +
      "<option value='all'" + (statusFilter === 'all' ? ' selected' : '') + '>All statuses</option>' +
      HIS.lab.STATUSES.map(function (s) { return "<option value='" + esc(s) + "'" + (statusFilter === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
      '</select>' +
      "<select class='ad-sel' id='lbPrio' aria-label='Filter by priority'>" +
      "<option value='all'" + (priorityFilter === 'all' ? ' selected' : '') + '>Any priority</option>' +
      HIS.lab.PRIORITIES.map(function (s) { return "<option value='" + esc(s) + "'" + (priorityFilter === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
      '</select>' +
      "<button class='ad-btn' id='lbNew' type='button'>+ New order</button>" +
      '</div>' +
      "<div class='ad-th ad-g-lab'><span>Order</span><span>Patient</span><span>Test</span><span>Priority</span><span>Status</span><span>Ordered</span><span>Action</span></div>" +
      (list.length ? list.map(function (o) {
        return "<div class='ad-tr ad-g-lab'>" +
          "<span class='ad-who'><b>" + esc(o.id) + '</b><small>' + esc(o.orderedBy) + '</small></span>' +
          "<span class='ad-who'><b>" + esc(patientName(o.patientId)) + '</b><small>' + esc(o.patientId + ' \u00b7 ' + o.dept) + '</small></span>' +
          "<span class='mu'>" + esc(o.test) + (o.result ? '<br>' + flagPill(o.result.flag) + ' ' + esc(o.result.value + ' ' + o.result.unit) : '') + '</span>' +
          "<span class='mu'><span class='badge pri " + (o.priority === 'STAT' ? 'stat' : o.priority === 'Urgent' ? 'warn' : 'off') + "'>" + esc(o.priority) + '</span></span>' +
          '<span>' + statusPill(o.status) + '</span>' +
          "<span class='mu'>" + esc(when(o.orderedAt)) + '</span>' +
          "<span style='text-align:right'>" + actionFor(o) + '</span></div>';
      }).join('') : "<div class='ad-empty'><b>No orders match</b>Clear the search or pick a different status.</div>") +
      '</div>' +

      "<div class='ad-note'><b>About these results.</b> The abnormal and critical flags compare the entered value with the " +
      'reference range printed on the order. They are not an interpretation and not a diagnosis, and nothing on this ' +
      'screen infers a condition from a value. A result reaches the patient record only once it is verified.</div>' +
      '</div>';

    document.getElementById('lbQ').oninput = function (e) {
      q = e.target.value; render();
      var f = document.getElementById('lbQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length);
    };
    document.getElementById('lbStatus').onchange = function (e) { statusFilter = e.target.value; render(); };
    document.getElementById('lbPrio').onchange = function (e) { priorityFilter = e.target.value; render(); };
    document.getElementById('lbNew').onclick = function () { orderModal(document.getElementById('lbNew')); };

    stage.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.id, act = b.dataset.act;
        var o = HIS.lab.byId(id);
        if (act === 'collect') return run(HIS.lab.collect(id), 'Specimen collected.');
        if (act === 'process') return run(HIS.lab.process(id), 'Processing started.');
        if (act === 'result') return resultModal(o, b);
        if (act === 'validate') return run(HIS.lab.validate(id), 'Result validated and released.');
        if (act === 'ack') return run(HIS.lab.acknowledgeCritical(id), 'Critical result acknowledged.');
        if (act === 'cancel') return cancelModal(o, b);
        if (act === 'view') return reportModal(o, b);
      };
    });
  }

  function run(res, okMsg) {
    if (!res.ok) { HIS.kit.toast(res.error); return; }
    HIS.kit.toast(okMsg);
    render();
  }

  // ---- shared modal shell -------------------------------------------------------------------
  // Same geometry as the Accounts editor (admin-pages.css .ac-*): white r16 card, 1px #c8dcea ring,
  // Lexend 20 title, right-aligned actions. Escape closes and focus returns to the trigger.
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
      var f = new FormData(ev.target);
      var err = opts.onSubmit(Object.fromEntries(f.entries()), bg.querySelector('#mdErr'));
      if (!err) { close(); render(); }
    };
    var first = bg.querySelector('input,select,textarea');
    if (first) first.focus();
    if (opts.after) opts.after(bg);
    return { close: close, el: bg };
  }

  function orderModal(trigger) {
    var patients = (HIS.registry ? HIS.registry.all() : []);
    var tests = Object.keys(HIS.lab.CATALOG);
    modal({
      title: 'New laboratory order', sub: 'The order enters the collection queue immediately.', ok: 'Create order', trigger: trigger,
      body:
        "<div class='ac-f'><label for='lbPatient'>Patient</label><select id='lbPatient' name='patientId'>" +
        patients.map(function (p) { return "<option value='" + esc(p.id) + "'>" + esc(p.id + ' \u00b7 ' + p.name) + '</option>'; }).join('') + '</select></div>' +
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='lbTest'>Test</label><select id='lbTest' name='test'>" +
        tests.map(function (t) { return "<option>" + esc(t) + '</option>'; }).join('') + '</select></div>' +
        "<div class='ac-f'><label for='lbPrioIn'>Priority</label><select id='lbPrioIn' name='priority'>" +
        HIS.lab.PRIORITIES.map(function (p) { return '<option>' + p + '</option>'; }).join('') + '</select></div>' +
        '</div>' +
        "<div class='ac-f'><label for='lbNotes'>Clinical note for the laboratory (optional)</label><input id='lbNotes' name='notes' placeholder='e.g. rule out acute coronary syndrome'></div>",
      onSubmit: function (v, err) {
        var r = HIS.lab.create(v);
        if (!r.ok) { err.textContent = r.error; return true; }
        HIS.kit.toast('Order ' + r.order.id + ' created.');
        return false;
      }
    });
  }

  function resultModal(o, trigger) {
    var cat = HIS.lab.CATALOG[o.test] || {};
    modal({
      title: 'Enter result', sub: o.id + ' \u00b7 ' + o.test + ' \u00b7 ' + patientName(o.patientId), ok: 'Save result', trigger: trigger,
      body:
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='lbVal'>Result value or reading</label><input id='lbVal' name='value' placeholder='" + esc(cat.unit ? 'e.g. 1.2' : 'e.g. Normal') + "' required></div>" +
        "<div class='ac-f'><label for='lbUnit'>Unit</label><input id='lbUnit' name='unit' value='" + esc(cat.unit || '') + "'></div>" +
        '</div>' +
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='lbRef'>Reference range</label><input id='lbRef' name='reference' value='" + esc(cat.range || '') + "'></div>" +
        "<div class='ac-f'><label for='lbFlag'>Flag</label><select id='lbFlag' name='flag'>" +
        ['Normal', 'Abnormal', 'Critical'].map(function (f) { return '<option>' + f + '</option>'; }).join('') + '</select></div>' +
        '</div>' +
        "<div class='ac-f'><label for='lbRNotes'>Result notes</label><input id='lbRNotes' name='notes'></div>" +
        "<p class='ac-hint'>The flag defaults to a mechanical comparison against the reference range. Override it only when a " +
        'technologist has actually reviewed the value.</p>',
      after: function (bg) {
        // Pre-select the flag the store would compute, so the default is visible before saving.
        var val = bg.querySelector('#lbVal'), ref = bg.querySelector('#lbRef'), flag = bg.querySelector('#lbFlag');
        function sync() { flag.value = HIS.lab.flagFor(val.value, ref.value, o.test); }
        val.oninput = sync; ref.oninput = sync;
      },
      onSubmit: function (v, err) {
        var r = HIS.lab.enterResult(o.id, v);
        if (!r.ok) { err.textContent = r.error; return true; }
        HIS.kit.toast('Result saved. It is not released until it is validated.');
        return false;
      }
    });
  }

  // M12: cancelling states its billing consequence before the operator commits, because a cancelled
  // order either voids its charge or keeps it depending on whether the specimen was collected.
  function cancelModal(o, trigger) {
    var policy = HIS.lab.cancelPolicy(o);
    modal({
      title: 'Cancel order', sub: o.id + ' \u00b7 ' + o.test + ' \u00b7 ' + patientName(o.patientId), ok: 'Cancel order', trigger: trigger,
      body: "<div class='ac-f'><label for='lbCancel'>Reason</label><input id='lbCancel' name='reason' placeholder='Why this order is being cancelled' required></div>" +
        "<p class='ac-hint'><b>Billing:</b> " + esc(policy.why) + '. ' +
        (policy.voidCharge ? 'The charge will be voided and will stop counting towards any invoice.'
          : 'The charge stays on the bill; the reason is recorded on the order.') + '</p>',
      onSubmit: function (v, err) {
        var r = HIS.lab.cancel(o.id, v.reason);
        if (!r.ok) { err.textContent = r.error; return true; }
        HIS.kit.toast(o.id + ' cancelled \u00b7 ' + (policy.voidCharge ? 'charge voided' : 'charge retained'));
        return false;
      }
    });
  }

  function reportModal(o, trigger) {
    var rows = [
      ['Order', o.id], ['Patient', patientName(o.patientId) + ' \u00b7 ' + o.patientId],
      ['Test', o.test], ['Priority', o.priority], ['Ordered by', o.orderedBy],
      ['Ordered at', when(o.orderedAt)],
      ['Specimen collected', o.collected ? when(o.collected.at) + ' by ' + o.collected.by : 'Not collected'],
      ['Result', o.result ? o.result.value + ' ' + o.result.unit : 'None'],
      ['Reference', o.result ? o.result.reference : '\u2014'],
      ['Flag', o.result ? o.result.flag : '\u2014'],
      ['Resulted by', o.resultedBy ? o.resultedBy + ' \u00b7 ' + when(o.resultedAt) : '\u2014'],
      ['Validated by', o.validatedBy ? o.validatedBy + ' \u00b7 ' + when(o.validatedAt) : 'Not validated'],
      ['Notes', o.result && o.result.notes ? o.result.notes : '\u2014']
    ];
    modal({
      title: 'Laboratory report', sub: o.id + ' \u00b7 sample copy', ok: 'Download PDF', trigger: trigger,
      body: "<div class='ad-kv'>" + rows.map(function (r) {
        return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
      }).join('') + '</div>',
      onSubmit: function () {
        HIS.pdf.save([
          ['MEDIHEAL MEDICAL CENTER', 14, 22],
          ['Laboratory report - sample copy', 8, 18],
          [o.test + '  (' + o.id + ')', 12, 24],
          ['Patient: ' + patientName(o.patientId) + '   ' + o.patientId, 9, 14],
          ['Ordered by: ' + o.orderedBy + '   ' + when(o.orderedAt), 9, 14],
          ['', 9, 10],
          ['RESULT: ' + (o.result ? o.result.value + ' ' + o.result.unit : '-'), 12, 18],
          ['Reference: ' + (o.result ? o.result.reference : '-'), 10, 14],
          ['Flag: ' + (o.result ? o.result.flag : '-'), 10, 14],
          ['Notes: ' + (o.result && o.result.notes ? o.result.notes : '-'), 9, 18],
          ['Resulted by: ' + (o.resultedBy || '-'), 9, 14],
          ['Validated by: ' + (o.validatedBy || 'not validated'), 9, 14],
          ['', 9, 12],
          ['Sample data. Not a clinical document.', 8, 12]
        ], o.id + '_report.pdf');
        HIS.kit.toast('Report downloaded.');
        return false;
      }
    });
  }

  // Local svg helper: the admin screens use the shell icon set, which is not loaded on this page.
  function svg(name, size) {
    var paths = {
      search: "<circle cx='11' cy='11' r='7'/><path d='m20 20-3.5-3.5'/>"
    };
    return "<svg width='" + size + "' height='" + size + "' viewBox='0 0 24 24' fill='none' stroke='#8a97a6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>" + (paths[name] || '') + '</svg>';
  }

  render();
})();
