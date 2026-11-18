// Charges screen (M12). The unbilled queue, the charge ledger and the open-episode list.
//
// WHY A SEPARATE SCREEN
// Billing is a locked Figma frame; adding a queue panel to it would have moved a page the design
// contract says must not move. The queue is also a different job: Billing takes money, this screen
// decides which episode a price belongs to. It uses the same admin format as Admissions and Claims.
//
// WHAT IT DOES
//   1. Shows every active charge that has no invoice, with the reason it has none.
//   2. Assigns one to an invoice, or opens a new invoice for the patient, with a reason and an audit row.
//   3. Voids a charge with a reason, keeping the row.
//   4. Closes an open encounter, which is what lets the next visit open a new one.
(function () {
  var stage = document.getElementById('stage');
  var esc = HIS.kit.esc;
  var tab = 'unbilled', q = '';

  function peso(n) {
    return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function when(iso) {
    if (!iso) return '\u2014';
    var d = new Date(iso);
    if (isNaN(d)) return '\u2014';
    return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function patientName(id) {
    var p = HIS.registry && HIS.registry.byId(id);
    return p ? p.name : (id || '\u2014');
  }
  function rowsFor() {
    var list = tab === 'unbilled' ? HIS.charges.unbilled() : HIS.charges.all().slice().reverse();
    var needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(function (c) {
      return (c.id + ' ' + c.patientId + ' ' + patientName(c.patientId) + ' ' + c.description + ' ' + c.sourceLabel)
        .toLowerCase().indexOf(needle) > -1;
    });
  }

  function render() {
    var st = HIS.charges.stats();
    var rec = HIS.charges.reconcile();
    var list = rowsFor();
    var encs = HIS.encounters ? HIS.encounters.all().filter(function (e) { return e.status === 'open'; }) : [];

    stage.innerHTML =
      "<h1 class='ad-title'>Charges</h1>" +
      "<p class='ad-sub'>Every billable service raises a price event here. A charge with no invoice waits in the unbilled queue until it is assigned to one.</p>" +
      "<div class='ad-body'>" +

      "<div class='ad-kpis'>" +
      "<div class='ad-kpi r'><div class='l'>Unbilled charges</div><div class='v'>" + st.unbilledCount + "</div><div class='d'>" + peso(st.unbilledTotal) + ' awaiting an invoice</div></div>' +
      "<div class='ad-kpi'><div class='l'>On invoices</div><div class='v'>" + st.assignedCount + "</div><div class='d'>Assigned to an episode's bill</div></div>" +
      "<div class='ad-kpi g'><div class='l'>Charge value</div><div class='v'>" + peso(st.total) + "</div><div class='d'>Active charges, all sources</div></div>" +
      "<div class='ad-kpi'><div class='l'>Voided</div><div class='v'>" + st.voided + "</div><div class='d'>Reversed with a reason, kept on file</div></div>" +
      '</div>' +

      (rec.problems.length ? "<div class='ad-alert'><b>" + rec.problems.length + ' charge integrity problem(s)</b>' +
        rec.problems.map(function (p) {
          return "<div class='ad-alert-row'><span>" + esc(p.code) + '</span><span>' + esc(p.charge || p.invoice || '') + '</span><span></span></div>';
        }).join('') + '</div>' : '') +

      "<div class='ad-card' style='margin-bottom:24px'>" +
      "<div class='ad-bar'>" +
      "<div class='ad-seg'><button data-tab='unbilled' class='" + (tab === 'unbilled' ? 'on' : '') + "'>Unbilled queue</button>" +
      "<button data-tab='all' class='" + (tab === 'all' ? 'on' : '') + "'>All charges</button></div>" +
      "<span class='ad-count'>" + list.length + ' rows</span>' +
      "<label class='ad-search'>" + svg('search', 16) + "<input id='chQ' type='search' placeholder='Search charge, patient or source' aria-label='Search charges' value='" + esc(q) + "'></label>" +
      '</div>' +
      "<div class='ad-th ad-g-chg'><span>Charge</span><span>Patient</span><span>Source</span><span>Raised</span><span>Description</span><span>Qty</span><span>Amount</span><span></span></div>" +
      (list.length ? list.map(function (c) {
        var voided = c.status === 'void';
        return "<div class='ad-tr ad-g-chg'" + (voided ? " style='opacity:.62'" : '') + '>' +
          "<span class='ad-who'><b>" + esc(c.id) + '</b><small>' + esc(c.encounterId || 'no encounter') + '</small></span>' +
          "<span class='ad-who'><b>" + esc(patientName(c.patientId)) + '</b><small>' + esc(c.patientId || '\u2014') + '</small></span>' +
          "<span class='mu'>" + esc(c.sourceLabel) + '</span>' +
          "<span class='mu'>" + esc(when(c.at)) + '</span>' +
          "<span class='ad-who'><b>" + esc(c.description) + '</b><small>' +
            esc(voided ? 'void \u00b7 ' + (c.voidReason || '') : c.invoiceId ? 'on ' + c.invoiceId : (c.unbilledReason || 'unbilled')) +
          '</small></span>' +
          "<span class='num'>" + c.qty + '</span>' +
          "<span class='num'>" + peso(c.amount) + '</span>' +
          "<span style='text-align:right;white-space:nowrap'>" +
            (voided ? "<span class='badge red'>Void</span>"
              : c.invoiceId
                ? "<button class='ad-btn ghost' data-act='unassign' data-id='" + esc(c.id) + "'>Unassign</button>"
                : "<button class='ad-btn' data-act='assign' data-id='" + esc(c.id) + "'>Assign</button>") +
            (voided ? '' : "<button class='ad-btn ghost' data-act='void' data-id='" + esc(c.id) + "'>Void</button>") +
          '</span></div>';
      }).join('') : "<div class='ad-empty'><b>" + (tab === 'unbilled' ? 'The unbilled queue is empty' : 'No charges yet') + '</b>' +
        (tab === 'unbilled' ? 'Every charge raised so far is on an invoice.' : 'Order a test, dispense a drug, complete a consultation or post a room charge.') + '</div>') +
      "<div class='ad-foot'>A charge is a price, not money: it raises what is owed and never appears as a collection. " +
      'Voided rows stay on file with the reason and the operator who voided them.</div>' +
      '</div>' +

      "<div class='ad-card'>" +
      "<div class='ad-bar'><h2>Open encounters</h2><span class='ad-count'>" + encs.length + ' open</span></div>' +
      "<div class='ad-th ad-g-enc'><span>Encounter</span><span>Patient</span><span>Department</span><span>Opened</span><span>Charges</span><span>Invoice</span><span></span></div>" +
      (encs.length ? encs.map(function (e) {
        var ch = HIS.charges.forEncounter(e.id).filter(function (c) { return c.status !== 'void'; });
        var val = ch.reduce(function (t, c) { return t + c.amount; }, 0);
        return "<div class='ad-tr ad-g-enc'>" +
          "<span class='ad-who'><b>" + esc(e.id) + '</b><small>' + esc(e.kind) + '</small></span>' +
          "<span class='ad-who'><b>" + esc(patientName(e.patientId)) + '</b><small>' + esc(e.patientId) + '</small></span>' +
          "<span class='mu'>" + esc(e.dept) + '</span>' +
          "<span class='mu'>" + esc(when(e.openedAt)) + '</span>' +
          "<span class='num'>" + ch.length + (val ? ' \u00b7 ' + peso(val) : '') + '</span>' +
          "<span class='mu'>" + esc(e.invoiceId || 'unbilled') + '</span>' +
          "<span style='text-align:right;white-space:nowrap'>" +
            "<button class='ad-btn ghost' data-act='enc-invoice' data-id='" + esc(e.id) + "'>Link invoice</button>" +
            (e.kind === 'outpatient' ? "<button class='ad-btn' data-act='close' data-id='" + esc(e.id) + "'>Close visit</button>" : '') +
          '</span></div>';
      }).join('') : "<div class='ad-empty'><b>No open encounters</b>A new one opens with the next consultation, order or admission.</div>") +
      "<div class='ad-foot'>An inpatient encounter is closed by discharge. An outpatient one is closed here, which is what lets the next visit open a new episode.</div>" +
      '</div>' +

      "<div class='ad-note'><b>Why a charge can be unbilled.</b> A charge is only attached to an invoice through its encounter. " +
      'If the episode has no invoice — a walk-in visit that was never billed, for example — the charge is still recorded here rather than ' +
      'being attached to an unrelated invoice or discarded. Assign it once the right invoice exists, and the assignment is written to the audit log.</div>' +
      '</div>';

    document.getElementById('chQ').oninput = function (e) {
      q = e.target.value; render();
      var f = document.getElementById('chQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length);
    };
    stage.querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () { tab = b.dataset.tab; render(); };
    });
    stage.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.id, act = b.dataset.act;
        if (act === 'assign') return assignModal(HIS.charges.byId(id), b);
        if (act === 'unassign') return unassignModal(HIS.charges.byId(id), b);
        if (act === 'void') return voidModal(HIS.charges.byId(id), b);
        if (act === 'close') return closeModal(HIS.encounters.byId(id), b);
        if (act === 'enc-invoice') return linkModal(HIS.encounters.byId(id), b);
      };
    });
  }

  // ---- modal shell -----------------------------------------------------------------------------
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

  // ---- assign ----------------------------------------------------------------------------------
  function assignModal(c, trigger) {
    if (!c) return;
    var bills = HIS.billing.forPatient(c.patientId);
    var opts = bills.map(function (b) {
      return "<option value='" + esc(b.id) + "'>" + esc(b.id + ' \u00b7 ' + b.date + ' \u00b7 balance ' + peso(HIS.ledger.balanceOf(b))) + '</option>';
    }).join('');
    modal({
      title: 'Assign charge to an invoice',
      sub: c.id + ' \u00b7 ' + patientName(c.patientId) + ' \u00b7 ' + peso(c.amount),
      ok: 'Assign', trigger: trigger,
      body:
        "<div class='ad-kv'>" +
        [['Description', c.description], ['Source', c.sourceLabel], ['Encounter', c.encounterId || 'none'],
         ['Why unbilled', c.unbilledReason || '\u2014']]
          .map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') +
        '</div>' +
        "<div class='ac-f'><label for='asInv'>Invoice</label><select id='asInv' name='invoiceId'>" +
        opts + "<option value='__new'>+ Open a new invoice for this patient</option></select></div>" +
        "<div class='ac-f'><label for='asWhy'>Reason</label><input id='asWhy' name='reason' placeholder='Why this invoice is the right one' required></div>" +
        "<p class='ac-hint'>Only invoices belonging to this patient can be chosen. The assignment is written to the audit log.</p>",
      onSubmit: function (v, err) {
        var invoiceId = v.invoiceId;
        if (invoiceId === '__new') {
          var created = HIS.billing.create({ patientId: c.patientId, encounterId: c.encounterId });
          if (!created.ok) { err.textContent = created.error; return true; }
          invoiceId = created.bill.id;
          if (c.encounterId) HIS.encounters.attachInvoice(c.encounterId, invoiceId);
        }
        var r = HIS.charges.assign(c.id, invoiceId, v.reason);
        if (!r.ok) { err.textContent = r.error; return true; }
        HIS.kit.toast(c.id + ' assigned to ' + invoiceId + ' \u00b7 ' + peso(c.amount));
        return false;
      }
    });
  }

  function unassignModal(c, trigger) {
    if (!c) return;
    modal({
      title: 'Return charge to the queue', sub: c.id + ' \u00b7 currently on ' + c.invoiceId, ok: 'Unassign', trigger: trigger,
      body: "<div class='ac-f'><label for='usWhy'>Reason</label><input id='usWhy' name='reason' placeholder='Why this charge does not belong on that invoice' required></div>",
      onSubmit: function (v, err) {
        var r = HIS.charges.unassign(c.id, v.reason);
        if (!r.ok) { err.textContent = r.error; return true; }
        HIS.kit.toast(c.id + ' returned to the unbilled queue.');
        return false;
      }
    });
  }

  function voidModal(c, trigger) {
    if (!c) return;
    modal({
      title: 'Void charge', sub: c.id + ' \u00b7 ' + c.description + ' \u00b7 ' + peso(c.amount), ok: 'Void charge', trigger: trigger,
      body: "<div class='ac-f'><label for='vdWhy'>Reason</label><input id='vdWhy' name='reason' placeholder='e.g. ordered in error, duplicate, service not rendered' required></div>" +
        "<p class='ac-hint'>The charge stops counting towards any total. The row, its price snapshot and this reason stay on file.</p>",
      onSubmit: function (v, err) {
        var r = HIS.charges.void(c.id, v.reason);
        if (!r.ok) { err.textContent = r.error; return true; }
        HIS.kit.toast(c.id + ' voided.');
        return false;
      }
    });
  }

  // ---- encounters ------------------------------------------------------------------------------
  function closeModal(e, trigger) {
    if (!e) return;
    var ch = HIS.charges.forEncounter(e.id).filter(function (c) { return c.status !== 'void'; });
    var unbilled = ch.filter(function (c) { return !c.invoiceId; });
    modal({
      title: 'Close visit', sub: e.id + ' \u00b7 ' + patientName(e.patientId) + ' \u00b7 ' + e.dept, ok: 'Close encounter', trigger: trigger,
      body: "<div class='ac-f'><label for='clDisp'>Disposition</label><input id='clDisp' name='disposition' value='Discharged from clinic'></div>" +
        "<div class='ad-sum'>" + ch.length + ' charge(s) on this episode. ' +
        (unbilled.length ? '<span class="r">' + unbilled.length + ' still unbilled (' + peso(unbilled.reduce(function (t, c) { return t + c.amount; }, 0)) + ').</span>'
          : '<span class="g">All assigned to an invoice.</span>') + '</div>' +
        "<p class='ac-hint'>Closing the episode stops it accepting new charges. Unbilled charges stay in the queue and can still be assigned afterwards.</p>",
      onSubmit: function (v, err) {
        var r = HIS.encounters.complete(e.id, { disposition: v.disposition });
        if (!r.ok) { err.textContent = r.error; return true; }
        HIS.kit.toast(e.id + ' closed.');
        return false;
      }
    });
  }

  function linkModal(e, trigger) {
    if (!e) return;
    var bills = HIS.billing.forPatient(e.patientId);
    modal({
      title: 'Link an invoice to this encounter', sub: e.id + ' \u00b7 ' + patientName(e.patientId), ok: 'Link invoice', trigger: trigger,
      body: "<div class='ac-f'><label for='lkInv'>Invoice</label><select id='lkInv' name='invoiceId'>" +
        "<option value=''>No invoice (keep charges unbilled)</option>" +
        bills.map(function (b) { return "<option value='" + esc(b.id) + "'" + (e.invoiceId === b.id ? ' selected' : '') + '>' + esc(b.id + ' \u00b7 ' + b.date + ' \u00b7 balance ' + peso(HIS.ledger.balanceOf(b))) + '</option>'; }).join('') +
        '</select></div>' +
        "<p class='ac-hint'>New charges raised in this episode attach to the linked invoice. Existing unbilled charges are not moved automatically — assign those from the queue.</p>",
      onSubmit: function (v, err) {
        var r = HIS.encounters.attachInvoice(e.id, v.invoiceId || null);
        if (!r.ok) { err.textContent = r.error; return true; }
        HIS.kit.toast(e.id + (v.invoiceId ? ' linked to ' + v.invoiceId : ' set to unbilled'));
        return false;
      }
    });
  }

  function svg(name, size) {
    var paths = { search: "<circle cx='11' cy='11' r='7'/><path d='m20 20-3.5-3.5'/>" };
    return "<svg width='" + size + "' height='" + size + "' viewBox='0 0 24 24' fill='none' stroke='#8a97a6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>" + (paths[name] || '') + '</svg>';
  }

  render();
})();
