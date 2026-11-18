// Pharmacy screen (M6). Admin screen format (admin-pages.css), same as Laboratory and Accounts.
//
// Two tabs share one card: the prescription queue (work to do) and the batch inventory (what is on
// the shelf). They are tabs rather than two pages because a pharmacist deciding whether to dispense
// needs both answers at once — the dispense modal shows the eligible batches inline.
(function () {
  var stage = document.getElementById('stage');
  var esc = HIS.kit.esc;
  var tab = 'rx', q = '', rxFilter = 'open';

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
  function peso(n) { return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 2 }); }

  function rxPill(s) {
    var map = { Pending: 'off', Verified: 'in', Partial: 'warn', Dispensed: 'ok', Rejected: 'red' };
    return "<span class='badge " + (map[s] || 'off') + "'>" + esc(s) + '</span>';
  }
  function stockPill(b) {
    if (HIS.pharmacy.isExpired(b)) return "<span class='badge red'>Expired</span>";
    if (b.qty === 0) return "<span class='badge off'>Empty</span>";
    if (b.qty <= b.reorder) return "<span class='badge warn'>Low</span>";
    return "<span class='badge ok'>In stock</span>";
  }
  function expiryCell(b) {
    var d = HIS.pharmacy.daysToExpiry(b.expiry);
    var cls = d < 0 ? 'red' : d <= 90 ? 'warn' : 'off';
    return esc(b.expiry) + " <span class='badge " + cls + "'>" + (d < 0 ? Math.abs(d) + 'd ago' : d + 'd') + '</span>';
  }

  function rxList() {
    var needle = q.trim().toLowerCase();
    return HIS.pharmacy.rx().filter(function (r) {
      if (rxFilter === 'open' && (r.status === 'Dispensed' || r.status === 'Rejected')) return false;
      if (rxFilter === 'done' && r.status !== 'Dispensed') return false;
      if (!needle) return true;
      return (r.id + ' ' + r.patientId + ' ' + patientName(r.patientId) + ' ' + r.drug + ' ' + r.orderedBy)
        .toLowerCase().indexOf(needle) > -1;
    }).sort(function (a, b) { return new Date(b.orderedAt) - new Date(a.orderedAt); });
  }
  function stockList() {
    var needle = q.trim().toLowerCase();
    return HIS.pharmacy.stock().filter(function (b) {
      if (!needle) return true;
      return (b.drug + ' ' + b.batch + ' ' + (b.supplier || '') + ' ' + (b.generic || '')).toLowerCase().indexOf(needle) > -1;
    }).sort(function (a, b) { return new Date(a.expiry) - new Date(b.expiry); });
  }

  function rxAction(r) {
    if (r.status === 'Pending') {
      return "<button class='ad-btn' data-act='verify' data-id='" + esc(r.id) + "'>Verify</button> " +
        "<button class='ad-btn ghost' data-act='reject' data-id='" + esc(r.id) + "'>Reject</button>";
    }
    if (r.status === 'Verified' || r.status === 'Partial') {
      return "<button class='ad-btn' data-act='dispense' data-id='" + esc(r.id) + "'>Dispense</button>";
    }
    return "<button class='ad-btn ghost' data-act='view' data-id='" + esc(r.id) + "'>View</button>";
  }

  function render() {
    var st = HIS.pharmacy.stats();
    var rxs = rxList(), batches = stockList();

    stage.innerHTML =
      "<h1 class='ad-title'>Pharmacy</h1>" +
      "<p class='ad-sub'>Prescription verification, batch dispensing and stock control. Stock leaves the shelf by batch, so an expired lot can never be dispensed.</p>" +
      "<div class='ad-body'>" +

      "<div class='ad-kpis'>" +
      "<div class='ad-kpi'><div class='l'>Pending prescriptions</div><div class='v'>" + st.pending + "</div><div class='d'>Awaiting verification</div></div>" +
      "<div class='ad-kpi'><div class='l'>Ready to dispense</div><div class='v'>" + (st.verified + st.partial) + "</div><div class='d'>Verified or partly given</div></div>" +
      "<div class='ad-kpi" + (st.low ? ' r' : '') + "'><div class='l'>Low stock lines</div><div class='v'>" + st.low + "</div><div class='d'>At or below reorder level</div></div>" +
      "<div class='ad-kpi" + (st.expired ? ' r' : ' g') + "'><div class='l'>Expired batches</div><div class='v'>" + st.expired + "</div><div class='d'>" + st.nearExpiry + ' expiring within 90 days</div></div>' +
      '</div>' +

      "<div class='ad-card'>" +
      "<div class='ad-bar'>" +
      "<div class='ad-seg'>" +
      "<button data-tab='rx'" + (tab === 'rx' ? " class='on'" : '') + '>Prescriptions (' + rxs.length + ')</button>' +
      "<button data-tab='stock'" + (tab === 'stock' ? " class='on'" : '') + '>Inventory (' + batches.length + ')</button>' +
      '</div>' +
      "<label class='ad-search'>" + svg('search', 16) + "<input id='phQ' type='search' placeholder='" + (tab === 'rx' ? 'Search prescription or patient' : 'Search medication or batch') + "' aria-label='Search' value='" + esc(q) + "'></label>" +
      (tab === 'rx'
        ? "<select class='ad-sel' id='phFilter' aria-label='Filter prescriptions'>" +
          "<option value='open'" + (rxFilter === 'open' ? ' selected' : '') + '>Open only</option>' +
          "<option value='all'" + (rxFilter === 'all' ? ' selected' : '') + '>All</option>' +
          "<option value='done'" + (rxFilter === 'done' ? ' selected' : '') + '>Dispensed</option></select>' +
          "<button class='ad-btn' id='phNewRx' type='button'>+ New prescription</button>"
        : "<button class='ad-btn' id='phReceive' type='button'>+ Receive stock</button>") +
      '</div>' +

      (tab === 'rx' ? rxTable(rxs) : stockTable(batches)) +
      '</div>' +

      "<div class='ad-note'><b>Demonstration inventory.</b> " + st.skus + ' medication lines, stock value ' + peso(st.stockValue) +
      '. Quantities are synthetic. Dispensing deducts from the chosen batch and writes a stock movement and an audit row; ' +
      'an expired batch is excluded from the dispense picker and can only be disposed of, not given to a patient.</div>' +
      '</div>';

    document.getElementById('phQ').oninput = function (e) {
      q = e.target.value; render();
      var f = document.getElementById('phQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length);
    };
    stage.querySelectorAll('[data-tab]').forEach(function (b) {
      b.onclick = function () { tab = b.dataset.tab; q = ''; render(); };
    });
    var filt = document.getElementById('phFilter');
    if (filt) filt.onchange = function (e) { rxFilter = e.target.value; render(); };
    var nrx = document.getElementById('phNewRx');
    if (nrx) nrx.onclick = function () { rxModal(nrx); };
    var rec = document.getElementById('phReceive');
    if (rec) rec.onclick = function () { receiveModal(rec); };

    stage.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () {
        var id = b.dataset.id, act = b.dataset.act;
        if (act === 'verify') return run(HIS.pharmacy.verify(id), 'Prescription verified.');
        if (act === 'reject') return rejectModal(HIS.pharmacy.rxById(id), b);
        if (act === 'dispense') return dispenseModal(HIS.pharmacy.rxById(id), b);
        if (act === 'view') return rxViewModal(HIS.pharmacy.rxById(id), b);
      };
    });
    stage.querySelectorAll('[data-batch]').forEach(function (b) {
      b.onclick = function () {
        var batch = HIS.pharmacy.stock().filter(function (x) { return x.id === b.dataset.batch; })[0];
        if (b.dataset.op === 'adjust') adjustModal(batch, b);
        else disposeModal(batch, b);
      };
    });
  }

  function rxTable(list) {
    return "<div class='ad-th ad-g-rx'><span>Rx</span><span>Patient</span><span>Medication</span><span>Qty</span><span>Status</span><span>Ordered</span><span></span></div>" +
      (list.length ? list.map(function (r) {
        var left = HIS.pharmacy.remaining(r);
        return "<div class='ad-tr ad-g-rx'>" +
          "<span class='ad-who'><b>" + esc(r.id) + '</b><small>' + esc(r.orderedBy) + '</small></span>' +
          "<span class='ad-who'><b>" + esc(patientName(r.patientId)) + '</b><small>' + esc(r.patientId) + '</small></span>' +
          "<span class='mu'>" + esc(r.drug) + (r.dosage ? '<br>' + esc(r.dosage) : '') + '</span>' +
          "<span class='mu'>" + (r.status === 'Dispensed' ? r.qty : left + ' of ' + r.qty) + ' ' + esc(r.unit) + '</span>' +
          '<span>' + rxPill(r.status) + '</span>' +
          "<span class='mu'>" + esc(when(r.orderedAt)) + '</span>' +
          "<span style='text-align:right;white-space:nowrap'>" + rxAction(r) + '</span></div>';
      }).join('') : "<div class='ad-empty'><b>No prescriptions match</b>Clear the search or switch the filter.</div>");
  }

  function stockTable(list) {
    return "<div class='ad-th ad-g-stock'><span>Medication</span><span>Batch</span><span>On hand</span><span>Reorder</span><span>Expiry</span><span>Supplier</span><span></span></div>" +
      (list.length ? list.map(function (b) {
        var exp = HIS.pharmacy.isExpired(b);
        return "<div class='ad-tr ad-g-stock'>" +
          "<span class='ad-who'><b>" + esc(b.drug) + '</b><small>' + esc([b.generic, b.form, b.route].filter(Boolean).join(' \u00b7 ')) + '</small></span>' +
          "<span class='mu'>" + esc(b.batch) + '</span>' +
          "<span class='num'>" + b.qty + ' ' + esc(b.unit) + ' ' + stockPill(b) + '</span>' +
          "<span class='mu'>" + b.reorder + '</span>' +
          "<span class='mu'>" + expiryCell(b) + '</span>' +
          "<span class='mu'>" + esc(b.supplier || '\u2014') + '</span>' +
          "<span style='text-align:right;white-space:nowrap'>" +
          "<button class='ad-btn' data-batch='" + esc(b.id) + "' data-op='adjust'>Adjust</button>" +
          (exp && b.qty > 0 ? " <button class='ad-btn ghost' data-batch='" + esc(b.id) + "' data-op='dispose'>Dispose</button>" : '') +
          '</span></div>';
      }).join('') : "<div class='ad-empty'><b>No batches match</b>Clear the search.</div>");
  }

  function run(res, msg) {
    if (!res.ok) { HIS.kit.toast(res.error); return; }
    HIS.kit.toast(msg);
    render();
  }

  // ---- shared modal shell (same component as Laboratory / Accounts) -------------------------
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
      var err = opts.onSubmit(Object.fromEntries(f.entries()), bg.querySelector('#mdErr'), bg);
      if (!err) { close(); render(); }
    };
    var first = bg.querySelector('input,select,textarea');
    if (first) first.focus();
    if (opts.after) opts.after(bg);
    return { close: close, el: bg };
  }

  function dispenseModal(r, trigger) {
    var batches = HIS.pharmacy.batchesFor(r.drug).filter(function (b) {
      return !HIS.pharmacy.isExpired(b) && b.qty > 0;
    });
    if (!batches.length) {
      HIS.kit.toast('No usable batch of ' + r.drug + ' is in stock.');
      return;
    }
    var left = HIS.pharmacy.remaining(r);
    var best = batches[0]; // first expiry first out
    modal({
      title: 'Dispense ' + r.drug,
      sub: r.id + ' \u00b7 ' + patientName(r.patientId) + ' \u00b7 ' + left + ' of ' + r.qty + ' ' + r.unit + ' outstanding',
      ok: 'Dispense', trigger: trigger,
      body:
        "<div class='ac-f'><label for='phBatch'>Batch (first expiry first out)</label><select id='phBatch' name='batchId'>" +
        batches.map(function (b, i) {
          return "<option value='" + esc(b.id) + "'" + (i === 0 ? ' selected' : '') + '>' +
            esc(b.batch + ' \u00b7 ' + b.qty + ' ' + b.unit + ' \u00b7 expires ' + b.expiry) + '</option>';
        }).join('') + '</select></div>' +
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='phQty'>Quantity to dispense</label><input id='phQty' name='qty' type='number' min='1' max='" + left + "' value='" + left + "' required></div>" +
        "<div class='ac-f'><label for='phNote'>Dispensing note</label><input id='phNote' name='notes' placeholder='optional'></div>" +
        '</div>' +
        "<p class='ac-hint'>Batch " + esc(best.batch) + ' holds ' + best.qty + ' ' + esc(best.unit) + ' and expires ' + esc(best.expiry) + '. ' +
        'A partial quantity leaves the prescription in Partial so the balance can be given later.</p>',
      onSubmit: function (v, err) {
        var res = HIS.pharmacy.dispense(r.id, { batchId: v.batchId, qty: Number(v.qty) });
        if (!res.ok) { err.textContent = res.error; return true; }
        HIS.kit.toast(res.remaining ? 'Dispensed ' + v.qty + '. ' + res.remaining + ' ' + r.unit + ' still outstanding.'
          : 'Prescription fully dispensed.');
        return false;
      }
    });
  }

  function rejectModal(r, trigger) {
    modal({
      title: 'Reject prescription', sub: r.id + ' \u00b7 ' + r.drug + ' \u00b7 ' + patientName(r.patientId), ok: 'Reject', trigger: trigger,
      body: "<div class='ac-f'><label for='phWhy'>Reason (recorded in the audit log)</label>" +
        "<input id='phWhy' name='reason' placeholder='e.g. dose exceeds the maximum daily dose' required></div>",
      onSubmit: function (v, err) {
        var res = HIS.pharmacy.reject(r.id, v.reason);
        if (!res.ok) { err.textContent = res.error; return true; }
        HIS.kit.toast('Prescription rejected.');
        return false;
      }
    });
  }

  function rxViewModal(r, trigger) {
    var rows = [
      ['Prescription', r.id], ['Patient', patientName(r.patientId) + ' \u00b7 ' + r.patientId],
      ['Medication', r.drug], ['Dosage', r.dosage || '\u2014'],
      ['Quantity', r.qty + ' ' + r.unit], ['Outstanding', HIS.pharmacy.remaining(r) + ' ' + r.unit],
      ['Ordered by', r.orderedBy], ['Ordered at', when(r.orderedAt)],
      ['Status', r.status], ['Verified by', r.verifiedBy ? r.verifiedBy + ' \u00b7 ' + when(r.verifiedAt) : '\u2014'],
      ['Notes', r.notes || '\u2014']
    ];
    var dis = (r.dispensed || []).map(function (d) {
      return d.qty + ' ' + r.unit + ' from batch ' + (d.batch || d.batchId) + ' \u00b7 ' + when(d.at) + ' \u00b7 ' + d.by;
    });
    modal({
      title: 'Prescription ' + r.id, sub: 'Read-only record', ok: 'Close', trigger: trigger,
      body: "<div class='ad-kv'>" + rows.map(function (x) {
        return '<div><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd></div>';
      }).join('') + '</div>' +
        (dis.length ? "<div class='ac-f'><label>Dispensing history</label>" + dis.map(function (d) {
          return "<div class='ad-hint-row'>" + esc(d) + '</div>';
        }).join('') + '</div>' : ''),
      onSubmit: function () { return false; }
    });
  }

  function rxModal(trigger) {
    var patients = (HIS.registry ? HIS.registry.all() : []);
    var drugs = Object.keys(HIS.pharmacy.stock().reduce(function (m, b) { m[b.drug] = 1; return m; }, {})).sort();
    modal({
      title: 'New prescription', sub: 'Enters the verification queue immediately.', ok: 'Create', trigger: trigger,
      body:
        "<div class='ac-f'><label for='phPat'>Patient</label><select id='phPat' name='patientId'>" +
        patients.map(function (p) { return "<option value='" + esc(p.id) + "'>" + esc(p.id + ' \u00b7 ' + p.name) + '</option>'; }).join('') + '</select></div>' +
        "<div class='ac-f'><label for='phDrug'>Medication</label><select id='phDrug' name='drug'>" +
        drugs.map(function (d) { return "<option>" + esc(d) + '</option>'; }).join('') + '</select></div>' +
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='phDose'>Dosage instruction</label><input id='phDose' name='dosage' placeholder='1 tablet twice daily' required></div>" +
        "<div class='ac-f'><label for='phQty2'>Quantity</label><input id='phQty2' name='qty' type='number' min='1' value='10' required></div>" +
        '</div>' +
        "<div class='ac-f'><label for='phNote2'>Notes</label><input id='phNote2' name='notes'></div>",
      onSubmit: function (v, err) {
        var res = HIS.pharmacy.createRx(v);
        if (!res.ok) { err.textContent = res.error; return true; }
        HIS.kit.toast('Prescription ' + res.prescription.id + ' created.');
        return false;
      }
    });
  }

  function adjustModal(b, trigger) {
    modal({
      title: 'Adjust stock', sub: b.drug + ' \u00b7 batch ' + b.batch + ' \u00b7 ' + b.qty + ' ' + b.unit + ' on hand', ok: 'Apply adjustment', trigger: trigger,
      body:
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='phDelta'>Change (+ or −)</label><input id='phDelta' name='delta' type='number' placeholder='-5' required></div>" +
        "<div class='ac-f'><label for='phReason'>Reason (required)</label><input id='phReason' name='reason' placeholder='e.g. broken vials' required></div>" +
        '</div>' +
        "<p class='ac-hint'>Stock cannot go negative. Every adjustment is written to the stock movement log and the audit log.</p>",
      onSubmit: function (v, err) {
        var res = HIS.pharmacy.adjust(b.id, Number(v.delta), v.reason);
        if (!res.ok) { err.textContent = res.error; return true; }
        HIS.kit.toast('Stock adjusted.');
        return false;
      }
    });
  }

  function disposeModal(b, trigger) {
    modal({
      title: 'Dispose of expired batch', sub: b.drug + ' \u00b7 batch ' + b.batch + ' \u00b7 expired ' + b.expiry, ok: 'Dispose ' + b.qty + ' ' + b.unit, trigger: trigger,
      body: "<div class='ac-f'><label for='phDisp'>Disposal reference</label>" +
        "<input id='phDisp' name='reason' placeholder='e.g. returned to supplier, DOH disposal form 2026-014'></div>" +
        "<p class='ac-hint'>This zeroes the batch and records a disposal movement. It is not a stock adjustment: the quantity is not recoverable.</p>",
      onSubmit: function (v, err) {
        var res = HIS.pharmacy.dispose(b.id, v.reason);
        if (!res.ok) { err.textContent = res.error; return true; }
        HIS.kit.toast('Batch disposed.');
        return false;
      }
    });
  }

  function receiveModal(trigger) {
    var drugs = Object.keys(HIS.pharmacy.stock().reduce(function (m, b) { m[b.drug] = 1; return m; }, {})).sort();
    modal({
      title: 'Receive stock', sub: 'A new batch is created. Receiving never merges into an existing batch, because the expiry differs.', ok: 'Receive', trigger: trigger,
      body:
        "<div class='ac-f'><label for='phRDrug'>Medication</label><select id='phRDrug' name='drug'>" +
        drugs.map(function (d) { return "<option>" + esc(d) + '</option>'; }).join('') + '</select></div>' +
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='phRQty'>Quantity</label><input id='phRQty' name='qty' type='number' min='1' value='100' required></div>" +
        "<div class='ac-f'><label for='phRBatch'>Batch number</label><input id='phRBatch' name='batch' placeholder='e.g. AML-2501' required></div>" +
        '</div>' +
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='phRExp'>Expiry date</label><input id='phRExp' name='expiry' type='date' required></div>" +
        "<div class='ac-f'><label for='phRUnit'>Unit</label><input id='phRUnit' name='unit' value='tablet'></div>" +
        '</div>' +
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='phRSup'>Supplier</label><input id='phRSup' name='supplier'></div>" +
        "<div class='ac-f'><label for='phRCost'>Unit cost</label><input id='phRCost' name='unitCost' type='number' step='0.01' value='0'></div>" +
        '</div>',
      onSubmit: function (v, err) {
        var res = HIS.pharmacy.receive(v);
        if (!res.ok) { err.textContent = res.error; return true; }
        HIS.kit.toast('Batch ' + res.batch.batch + ' received.');
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
