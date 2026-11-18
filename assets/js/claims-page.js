// Claims screen (M10). Addition (not in Figma) built in the module-page format used by Audit,
// Reports and Accounts — docs/DESIGN-LOCK.md §2: Outfit 36 title at (68,115), Inter 14 description
// at (68,166), white cards with a 1px #c8dcea stroke and radius 14. No new colours or type sizes.
//
// Data and rules: assets/js/claims.js. Money: HIS.ledger. The screen never computes a balance or a
// collection itself — it asks the ledger, so Claims, Billing, Reports and the portal cannot disagree.
(function () {
  var stage = document.getElementById('stage');
  var esc = HIS.kit.esc;
  var q = '', status = 'all', open = null;

  function money(n) {
    return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function shortDate(iso) {
    if (!iso) return '\u2014';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function dateTime(iso) {
    if (!iso) return '\u2014';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  }
  function pill(c, short) {
    var s = HIS.claims.STATUS[c.status];
    return "<span class='badge " + s.tone + "' title='" + esc(s.label) + "'>" + esc(short ? s.short : s.label) + '</span>';
  }

  function rows() {
    var needle = q.trim().toLowerCase();
    return HIS.claims.all().filter(function (c) {
      if (status !== 'all' && c.status !== status) return false;
      if (!needle) return true;
      return [c.id, c.patientName, c.payer, c.invoiceId, c.memberRef, c.officer].join(' ').toLowerCase().indexOf(needle) > -1;
    });
  }

  function kpi(label, value, detail, tone) {
    return "<div class='ad-kpi" + (tone ? ' ' + tone : '') + "'><div class='l'>" + esc(label) + "</div><div class='v'>" + esc(value) + "</div><div class='d'>" + esc(detail) + '</div></div>';
  }

  function render() {
    var S = HIS.claims.stats();
    var r = rows();
    var canCreate = ['cashier', 'finance', 'superadmin'].indexOf(HIS.rbac.key()) > -1;

    stage.innerHTML =
      "<h1 class='ad-title'>Claims</h1>" +
      "<p class='ad-sub'>PhilHealth and HMO claims from preparation to settlement. A simulated workflow \u2014 nothing is transmitted to a payer.</p>" +
      "<div class='ad-body'>" +
      "<div class='ad-kpis'>" +
      kpi('Open claims', String(S.pending), S.total + ' claims on file') +
      kpi('Awaiting documents', String(S.awaitingDocuments), 'Cannot be submitted until complete') +
      kpi('Submitted / under review', String(S.submitted), S.underReview + ' with the payer now') +
      kpi('Outstanding claim value', money(S.outstanding), money(S.approvedNotSettled) + ' approved, not settled', 'r') +
      '</div>' +
      "<div class='ad-kpis'>" +
      kpi('Approved', String(S.approved), 'Promise to pay, not cash') +
      kpi('Denied', String(S.denied), money(S.deniedValue) + ' refused', 'r') +
      kpi('Settled', String(S.settled), 'Posted to the ledger as coverage', 'g') +
      kpi('Follow-ups due', String(S.followUps.length), S.followUps.length ? 'Past the expected reply date' : 'Nothing overdue') +
      '</div>' +
      (S.followUps.length
        ? "<div class='ad-alert'><b>" + S.followUps.length + ' claim' + (S.followUps.length === 1 ? '' : 's') + ' past the follow-up date</b>' +
        S.followUps.map(function (c) {
          return "<div class='ad-alert-row'><span>" + esc(c.id + ' \u00b7 ' + c.patientName + ' \u00b7 ' + c.payer) + '</span>' +
            '<span>' + esc(c.followUpAt) + '</span>' +
            "<button class='ad-btn' data-open='" + c.id + "'>Open</button></div>";
        }).join('') + '</div>'
        : '') +
      "<div class='ad-card'>" +
      "<div class='ad-bar'><h2>Claim register</h2>" +
      "<span class='ad-count'>" + r.length + ' of ' + S.total + ' claims</span>' +
      "<label class='ad-search'>" + svg('search', 16) + "<input id='clQ' type='search' placeholder='Search claim, patient, payer' aria-label='Search claims' value='" + esc(q) + "'></label>" +
      "<select class='ad-sel' id='clStatus' aria-label='Filter by status'>" +
      "<option value='all'>All statuses</option>" +
      HIS.claims.ORDER.map(function (k) {
        return "<option value='" + k + "'" + (status === k ? ' selected' : '') + '>' + esc(HIS.claims.STATUS[k].label) + '</option>';
      }).join('') + '</select>' +
      (canCreate ? "<button class='ad-btn' id='clNew' type='button'>New claim</button>" : '') +
      '</div>' +
      "<div class='ad-th ad-g-claims'><span>Claim</span><span>Patient</span><span>Payer</span><span>Invoice</span><span>Requested</span><span>Approved</span><span>Status</span><span></span></div>" +
      (r.length
        ? r.map(function (c) {
          return "<div class='ad-tr ad-g-claims' data-open='" + c.id + "'>" +
            "<b>" + esc(c.id) + '</b>' +
            "<span class='ad-who'><b>" + esc(c.patientName) + '</b><small>' + esc(c.memberRef) + '</small></span>' +
            '<span>' + esc(c.payer) + '</span>' +
            "<span class='mu'>" + esc(c.invoiceId) + '</span>' +
            "<span class='num'>" + money(c.requestedAmount) + '</span>' +
            "<span class='num'>" + (c.approvedAmount ? money(c.approvedAmount) : '\u2014') + '</span>' +
            '<span>' + pill(c, true) + '</span>' +
            "<span><button class='ad-btn ghost' data-open='" + c.id + "'>Open</button></span></div>";
        }).join('')
        : "<div class='ad-empty'><b>No claims match this filter</b>Clear the search or choose a different status.</div>") +
      '</div>' +
      "<div class='ad-note'><b>What the figures mean.</b> An approved claim is a promise from the payer, not money in the bank: it is " +
      'reported separately from collections and never added to them. Only a settlement posts a coverage transaction to the ledger, ' +
      'and it posts once — the claim id is the ledger source id, so a repeated settlement is refused.</div>' +
      '</div>';

    document.getElementById('clQ').oninput = function (e) {
      q = e.target.value; render();
      var f = document.getElementById('clQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length);
    };
    document.getElementById('clStatus').onchange = function (e) { status = e.target.value; render(); };
    var nb = document.getElementById('clNew');
    if (nb) nb.onclick = newClaim;
    stage.onclick = function (e) {
      var t = e.target.closest('[data-open]');
      if (t) detail(t.dataset.open);
    };
  }

  function svg(name, size) {
    var paths = {
      search: "<circle cx='11' cy='11' r='7'/><path d='m21 21-4.3-4.3'/>"
    };
    return "<svg width='" + size + "' height='" + size + "' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>" + paths[name] + '</svg>';
  }

  // ---- detail ---------------------------------------------------------------------------------
  function detail(id) {
    var c = HIS.claims.get(id);
    if (!c) return;
    open = id;
    var acts = HIS.claims.available(c);
    var bill = (HIS.billing.bills || []).filter(function (b) { return b.id === c.invoiceId; })[0];
    var balance = bill ? HIS.ledger.balanceOf(bill) : null;
    var collected = bill ? HIS.ledger.paidOf(bill) : null;
    var covered = bill ? HIS.ledger.coveredOf(bill) : null;

    var bg = document.createElement('div');
    bg.className = 'cl-bg';
    bg.setAttribute('role', 'dialog');
    bg.setAttribute('aria-modal', 'true');
    bg.innerHTML = "<div class='cl-card'>" +
      "<div class='cl-h'><div><h3>" + esc(c.id) + ' \u00b7 ' + esc(c.payer) + '</h3>' +
      "<p class='cl-sub'>" + esc(c.patientName) + ' \u00b7 ' + esc(c.invoiceId) + ' \u00b7 ' + esc(c.memberRef) + '</p></div>' +
      "<div class='cl-h-r'>" + pill(c) + "<button class='cl-x' data-close aria-label='Close'>\u00d7</button></div></div>" +

      "<div class='cl-kv'>" +
      kv('Claim amount', money(c.claimAmount)) +
      kv('Requested', money(c.requestedAmount)) +
      kv('Approved', c.approvedAmount ? money(c.approvedAmount) : '\u2014') +
      kv('Patient share', c.patientShare ? money(c.patientShare) : '\u2014') +
      kv('Coverage basis', c.coverage.description) +
      kv('Officer', c.officer) +
      kv('Prepared', shortDate(c.preparedAt)) +
      kv('Submitted', shortDate(c.submittedAt)) +
      kv('Follow-up', c.followUpAt ? shortDate(c.followUpAt) : '\u2014') +
      '</div>' +

      (bill ? "<div class='cl-strip'><b>Invoice " + esc(bill.id) + '</b> total ' + money(bill.amount) +
        ' \u00b7 collected ' + money(collected) + ' \u00b7 covered ' + money(covered) +
        ' \u00b7 outstanding <b>' + money(balance) + '</b>' +
        '<span class="cl-sep">Coverage is not a collection.</span></div>' : '') +

      "<div class='cl-sect'><h4>Supporting documents</h4>" +
      "<div class='cl-docs'>" + c.documents.map(function (d, i) {
        return "<button class='cl-doc" + (d.received ? ' on' : '') + "' data-doc='" + i + "' aria-pressed='" + d.received + "'>" +
          "<span class='bx'>" + (d.received ? '\u2713' : '') + '</span>' +
          '<span>' + esc(d.name) + '</span></button>';
      }).join('') + '</div></div>' +

      (c.notes && c.notes.length
        ? "<div class='cl-sect'><h4>Notes</h4>" + c.notes.map(function (n) {
          return "<div class='cl-note'><b>" + esc(n.by) + '</b> \u00b7 ' + esc(dateTime(n.at)) + '<br>' + esc(n.text) + '</div>';
        }).join('') + '</div>'
        : '') +

      "<div class='cl-sect'><h4>Status history</h4><div class='cl-tl'>" +
      (c.history.length ? c.history.slice().reverse().map(function (h) {
        return "<div class='cl-tl-row'><span class='w'>" + esc(dateTime(h.at)) + '</span>' +
          '<span><b>' + esc(h.by) + '</b> \u00b7 ' + esc(h.role) + '<br>' +
          (h.from ? esc(HIS.claims.STATUS[h.from].label) + ' \u2192 ' : '') + esc(HIS.claims.STATUS[h.to].label) +
          (h.reason ? '<br><span class="why">' + esc(h.reason) + '</span>' : '') + '</span></div>';
      }).join('') : "<div class='cl-tl-row'><span class='w'>\u2014</span><span>No history yet.</span></div>") +
      '</div></div>' +

      (c.settlement
        ? "<div class='cl-settled'><b>Settled " + esc(shortDate(c.settlement.at)) + '</b> \u00b7 ledger transaction ' +
        esc(c.settlement.transactionId) + ' \u00b7 ' + money(c.settlement.amount) + ' posted as coverage. No cash was recorded.</div>'
        : '') +

      "<div class='cl-actions'>" +
      (acts.length ? acts.map(function (t) {
        return "<button class='ad-btn" + (t.action === 'settle' ? ' pri' : '') + "' data-act='" + t.action + "'>" + esc(t.label) + '</button>';
      }).join('') : "<span class='cl-none'>No action is available to your role at this status.</span>") +
      "<button class='ad-btn' data-note='1'>Add note</button>" +
      "<button class='ad-btn ghost' data-close>Close</button></div>" +
      '</div>';
    document.body.appendChild(bg);
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    bg.addEventListener('click', function (e) {
      var T = e.target;
      if (T.closest('[data-close]')) { close(); return; }
      var d = T.closest('[data-doc]');
      if (d) {
        var i = +d.dataset.doc;
        var cur = HIS.claims.get(open).documents[i].received;
        HIS.claims.setDocument(open, i, !cur);
        close(); detail(open); return;
      }
      var a = T.closest('[data-act]');
      if (a) { ask(open, a.dataset.act); return; }
      if (T.closest('[data-note]')) { note(open); return; }
    });
    var first = bg.querySelector('button');
    if (first) first.focus();
  }

  function kv(k, v) {
    return "<div class='cl-f2'><span class='k'>" + esc(k) + "</span><span class='v'>" + esc(v) + '</span></div>';
  }

  function close() {
    var bg = document.querySelector('.cl-bg');
    if (bg) bg.remove();
    open = null;
  }

  // ---- transitions ----------------------------------------------------------------------------
  function ask(id, action) {
    var c = HIS.claims.get(id);
    var t = HIS.claims.TRANSITIONS.filter(function (x) { return x.from === c.status && x.action === action; })[0];
    if (!t) { HIS.kit.toast('That action no longer applies.'); return; }
    var fields = [];
    if (action === 'approve') fields.push(['approvedAmount', 'Approved amount', String(c.requestedAmount)]);
    if (action === 'partial') {
      fields.push(['approvedAmount', 'Approved amount', String(Math.round(c.requestedAmount / 2))]);
      fields.push(['reason', 'Reason for the partial approval', '']);
    }
    if (action === 'deny') fields.push(['reason', 'Reason for the denial', '']);
    if (action === 'appeal') fields.push(['reason', 'Grounds for the appeal', '']);
    if (action === 'request-info') fields.push(['reason', 'What the payer asked for', '']);
    if (action === 'reject-review') fields.push(['reason', 'What is missing', '']);
    if (action === 'submit') fields.push(['reference', 'Payer reference number', '']);
    if (action === 'close') fields.push(['reason', 'Reason for closing', '']);

    var body = fields.map(function (f) {
      return "<label class='cl-f'><span>" + esc(f[1]) + "</span><input name='" + f[0] + "' value='" + esc(f[2]) + "'></label>";
    }).join('');
    if (!fields.length) {
      var r = HIS.claims.transition(id, action, {});
      HIS.kit.toast(r.ok ? 'Claim ' + r.claim.id + ' \u2192 ' + HIS.claims.STATUS[r.claim.status].label : r.error);
      close();
      if (r.ok) render();
      return;
    }
    HIS.kit.modal({
      title: t.label,
      sub: c.id + ' \u00b7 ' + c.payer + ' \u00b7 ' + c.patientName,
      body: body,
      saveLabel: t.label,
      onSave: function (data) {
        var r = HIS.claims.transition(id, action, data);
        if (!r.ok) { HIS.kit.toast(r.error); return; }
        var msg = 'Claim ' + r.claim.id + ' \u2192 ' + HIS.claims.STATUS[r.claim.status].label;
        if (action === 'settle') msg += ' \u00b7 ledger ' + r.claim.settlement.transactionId + ' posted as coverage';
        HIS.kit.toast(msg);
        close();
        render();
      }
    });
  }

  function note(id) {
    HIS.kit.modal({
      title: 'Add a note',
      sub: 'Notes are appended to the claim and shown in its history panel.',
      body: "<label class='cl-f'><span>Note</span><textarea name='text' rows='3'></textarea></label>",
      saveLabel: 'Save note',
      onSave: function (data) {
        var r = HIS.claims.addNote(id, data.text);
        HIS.kit.toast(r.ok ? 'Note added' : r.error);
        close(); render();
      }
    });
  }

  function newClaim() {
    var bills = (HIS.billing.bills || []).filter(function (b) {
      return HIS.ledger.balanceOf(b) > 0;
    });
    if (!bills.length) { HIS.kit.toast('Every invoice is fully settled; there is nothing to claim.'); return; }
    var opts = bills.map(function (b) {
      return "<option value='" + b.id + "'>" + esc(b.id + ' \u00b7 ' + b.full + ' \u00b7 ' + money(b.amount)) + '</option>';
    }).join('');
    HIS.kit.modal({
      title: 'New claim',
      sub: 'A claim can only be raised against an invoice with an outstanding balance.',
      body:
        "<label class='cl-f'><span>Invoice</span><select name='invoiceId'>" + opts + '</select></label>' +
        "<label class='cl-f'><span>Payer</span><select name='payer'><option>PhilHealth</option><option>Maxicare</option><option>Intellicare</option><option>Medicard</option></select></label>" +
        "<label class='cl-f'><span>Payer type</span><select name='payerType'><option value='philhealth'>PhilHealth</option><option value='hmo'>HMO</option></select></label>" +
        "<label class='cl-f'><span>Member reference</span><input name='memberRef' placeholder='12-345678901-2'></label>" +
        "<label class='cl-f'><span>Claim amount</span><input name='requestedAmount' inputmode='decimal' placeholder='0.00'></label>" +
        "<label class='cl-f'><span>Coverage basis</span><input name='coverage' placeholder='Case rate \u2014 medical admission'></label>" +
        "<label class='cl-f'><span>Follow-up date</span><input name='followUpAt' type='date'></label>",
      saveLabel: 'Create claim',
      onSave: function (data) {
        var r = HIS.claims.create(data);
        HIS.kit.toast(r.ok ? 'Claim ' + r.claim.id + ' created as a draft' : r.error);
        if (r.ok) render();
      }
    });
  }

  render();
})();
