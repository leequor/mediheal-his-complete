// Reports (M2). Addition (not in Figma) - no Figma frame exists; built in the design format.
// Every figure is DERIVED from the invoices in assets/js/data-billing.js, so the page cannot drift
// away from the Billing screen. Nothing here is a hardcoded total.
//
// Known discrepancy this page makes visible: the Billing page's four KPI cards (Figma values,
// ₱482K / ₱395K / ₱87K) describe the whole month, while its table lists four invoices. This report
// states its own scope explicitly instead of mixing the two bases.
(function () {
  var stage = document.getElementById('stage');
  var esc = HIS.kit.esc;

  // Amount actually collected for a bill: an explicit `paid` field wins; otherwise a Paid invoice
  // is settled in full and anything else has collected nothing yet.
  function paidOf(b) {
    if (typeof b.paid === 'number') return b.paid;
    return b.status === 'Paid' ? b.amount : 0;
  }
  function statusOf(b) {
    var p = paidOf(b);
    if (p >= b.amount) return 'Paid';
    if (p > 0) return 'Partial';
    return 'Pending';
  }
  var PILL = { Paid: 'ok', Partial: 'in', Pending: 'off' };

  var peso = function (n) {
    return '\u20b1' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };

  function build() {
    var bills = ((HIS.billing || {}).bills || []).slice();
    var billed = bills.reduce(function (s, b) { return s + b.amount; }, 0);
    var collected = bills.reduce(function (s, b) { return s + paidOf(b); }, 0);
    var outstanding = billed - collected;
    var rate = billed ? Math.round((collected / billed) * 100) : 0;

    // Split by invoice type (Inpatient / Outpatient) - the dimension the Billing table carries.
    var byType = {};
    bills.forEach(function (b) {
      var k = b.type || 'Unspecified';
      byType[k] = byType[k] || { n: 0, billed: 0, collected: 0 };
      byType[k].n++; byType[k].billed += b.amount; byType[k].collected += paidOf(b);
    });

    stage.innerHTML =
      "<h1 class='ad-title'>Reports</h1>" +
      "<p class='ad-sub'>Billing and collection summary, derived from the invoices in the demo ledger.</p>" +
      "<div class='ad-body'>" +
      "<div class='ad-kpis'>" +
      "<div class='ad-kpi'><div class='l'>Total billed</div><div class='v'>" + peso(billed) + "</div><div class='d'>" + bills.length + ' invoices in scope</div></div>' +
      "<div class='ad-kpi g'><div class='l'>Collected</div><div class='v'>" + peso(collected) + "</div><div class='d'>" + rate + '% collection rate</div></div>' +
      "<div class='ad-kpi r'><div class='l'>Outstanding</div><div class='v'>" + peso(outstanding) + "</div><div class='d'>" + bills.filter(function (b) { return statusOf(b) !== 'Paid'; }).length + ' invoices open</div></div>' +
      "<div class='ad-kpi'><div class='l'>Average invoice</div><div class='v'>" + peso(bills.length ? Math.round(billed / bills.length) : 0) + "</div><div class='d'>Per invoice, this scope</div></div>" +
      '</div>' +

      "<div class='ad-card' style='margin-bottom:24px'>" +
      "<div class='ad-bar'><h2>Invoices</h2><span class='ad-count'>" + bills.length + ' records</span></div>' +
      "<div class='ad-th ad-g-rep'><span>Invoice</span><span>Type</span><span>Billed</span><span>Collected</span><span>Balance</span><span>Status</span></div>" +
      (bills.length ? bills.map(function (b) {
        var p = paidOf(b), s = statusOf(b);
        return "<div class='ad-tr ad-g-rep'>" +
          "<span><b>" + esc(b.id) + '</b> <span class="mu">' + esc(b.name) + '</span></span>' +
          "<span class='mu'>" + esc(b.type || '\u2014') + '</span>' +
          "<span class='num'>" + peso(b.amount) + '</span>' +
          "<span class='num'>" + peso(p) + '</span>' +
          "<span class='num'>" + peso(b.amount - p) + '</span>' +
          "<span>" + HIS.kit.pill(s, PILL[s]) + '</span></div>';
      }).join('') : "<div class='ad-empty'><b>No invoices</b>The demo ledger is empty.</div>") +
      "<div class='ad-foot'>Balance = billed \u2212 collected. Status is derived, never stored separately.</div>" +
      '</div>' +

      "<div class='ad-card'>" +
      "<div class='ad-bar'><h2>By invoice type</h2><span class='ad-count'>Same " + bills.length + " invoices</span></div>" +
      "<div class='ad-th ad-g-rep' style='grid-template-columns:1.6fr .9fr .9fr .9fr .9fr .7fr'><span>Type</span><span>Count</span><span>Billed</span><span>Collected</span><span>Balance</span><span>Rate</span></div>" +
      Object.keys(byType).map(function (k) {
        var t = byType[k], bal = t.billed - t.collected, r = t.billed ? Math.round((t.collected / t.billed) * 100) : 0;
        return "<div class='ad-tr' style='grid-template-columns:1.6fr .9fr .9fr .9fr .9fr .7fr'>" +
          '<span><b>' + esc(k) + '</b></span>' +
          "<span class='num'>" + t.n + '</span>' +
          "<span class='num'>" + peso(t.billed) + '</span>' +
          "<span class='num'>" + peso(t.collected) + '</span>' +
          "<span class='num'>" + peso(bal) + '</span>' +
          "<span class='num'>" + r + '%</span></div>';
      }).join('') +
      '</div>' +

      "<div class='ad-note'><b>Scope and basis.</b> Figures cover the " + bills.length + " invoices held in " +
      '<code>assets/js/data-billing.js</code>, the same records the Billing screen lists. The Billing KPI ' +
      'cards above the table are Figma placeholder values for the whole month and are deliberately not ' +
      'reused here, because mixing a month total with a four-invoice table would misstate both. ' +
      'PhilHealth, HMO and discount amounts are recorded per invoice but are not yet split out as their ' +
      'own report.</div>' +
      '</div>';
  }

  build();
})();
