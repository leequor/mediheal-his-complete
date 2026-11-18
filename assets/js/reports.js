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

  // M7: collected and status come from the transaction ledger (HIS.ledger), the single record of
  // money moving. This file used to re-derive them from a `paid` field on the invoice, which is
  // how Reports and Billing could disagree.
  function paidOf(b) { return HIS.ledger.paidOf(b); }
  function statusOf(b) { return HIS.ledger.statusOf(b); }
  var PILL = { Paid: 'ok', Partial: 'in', Pending: 'off' };

  var peso = function (n) {
    return '\u20b1' + Number(n).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  };

  function build() {
    var bills = ((HIS.billing || {}).bills || []).slice();
    var billed = bills.reduce(function (s, b) { return s + HIS.ledger.invoiceAmount(b); }, 0);
    var collected = bills.reduce(function (s, b) { return s + paidOf(b); }, 0);
    // M7: coverage and discounts reduce the charge but are not collections, so the outstanding
    // figure must subtract them or the report overstates what patients still owe.
    var covered = bills.reduce(function (s, b) { return s + HIS.ledger.coveredOf(b); }, 0);
    var outstanding = billed - collected - covered;
    var rate = billed ? Math.round((collected / billed) * 100) : 0;

    // M12: two more authoritative sources — the charge engine's unbilled queue and the bed board.
    // Neither is a stored figure; both are derived when this page renders.
    var chg = window.HIS.charges ? HIS.charges.stats() : { unbilledCount: 0, unbilledTotal: 0, bySource: {} };
    var adm = window.HIS.admissions ? HIS.admissions.stats() : { beds: 0, occupied: 0, available: 0, rate: 0, active: 0, outOfService: 0 };
    var bySource = {};
    if (window.HIS.charges) {
      HIS.charges.unbilled().forEach(function (c) {
        bySource[c.sourceLabel] = bySource[c.sourceLabel] || { n: 0, amount: 0 };
        bySource[c.sourceLabel].n++; bySource[c.sourceLabel].amount += c.amount;
      });
    }

    // Split by invoice type (Inpatient / Outpatient) - the dimension the Billing table carries.
    var byType = {};
    bills.forEach(function (b) {
      var k = b.type || 'Unspecified';
      byType[k] = byType[k] || { n: 0, billed: 0, collected: 0, covered: 0 };
      byType[k].n++; byType[k].billed += HIS.ledger.invoiceAmount(b); byType[k].collected += paidOf(b);
      byType[k].covered += HIS.ledger.coveredOf(b);
    });

    stage.innerHTML =
      "<h1 class='ad-title'>Reports</h1>" +
      "<p class='ad-sub'>Billing, collection, unbilled revenue and inpatient occupancy \u2014 each figure derived from the module that owns it.</p>" +
      "<div class='ad-body'>" +
      "<div class='ad-kpis'>" +
      "<div class='ad-kpi'><div class='l'>Total billed</div><div class='v'>" + peso(billed) + "</div><div class='d'>" + bills.length + ' invoices in scope</div></div>' +
      "<div class='ad-kpi g'><div class='l'>Collected</div><div class='v'>" + peso(collected) + "</div><div class='d'>" + rate + '% collection rate' + (covered ? ' · ' + peso(covered) + ' covered' : '') + '</div></div>' +
      "<div class='ad-kpi r'><div class='l'>Outstanding</div><div class='v'>" + peso(outstanding) + "</div><div class='d'>" + bills.filter(function (b) { return statusOf(b) !== 'Paid'; }).length + ' invoices open</div></div>' +
      "<div class='ad-kpi'><div class='l'>Average invoice</div><div class='v'>" + peso(bills.length ? Math.round(billed / bills.length) : 0) + "</div><div class='d'>Per invoice, this scope</div></div>" +
      '</div>' +

      "<div class='ad-kpis' style='grid-template-columns:repeat(4,1fr)'>" +
      "<div class='ad-kpi r'><div class='l'>Unbilled charges</div><div class='v'>" + chg.unbilledCount + "</div><div class='d'>" + peso(chg.unbilledTotal) + ' not yet on an invoice</div></div>' +
      "<div class='ad-kpi'><div class='l'>Beds occupied</div><div class='v'>" + adm.occupied + "</div><div class='d'>" + adm.rate + '% of ' + adm.beds + ' configured</div></div>' +
      "<div class='ad-kpi g'><div class='l'>Beds available</div><div class='v'>" + adm.available + "</div><div class='d'>" + adm.outOfService + ' out of service</div></div>' +
      "<div class='ad-kpi'><div class='l'>Active admissions</div><div class='v'>" + adm.active + "</div><div class='d'>Inpatient episodes open</div></div>" +
      '</div>' +

      "<div class='ad-card' style='margin-bottom:24px'>" +
      "<div class='ad-bar'><h2>Invoices</h2><span class='ad-count'>" + bills.length + ' records</span></div>' +
      "<div class='ad-th ad-g-rep'><span>Invoice</span><span>Type</span><span>Billed</span><span>Collected</span><span>Balance</span><span>Status</span></div>" +
      (bills.length ? bills.map(function (b) {
        var p = paidOf(b), s = statusOf(b);
        return "<div class='ad-tr ad-g-rep'>" +
          "<span><b>" + esc(b.id) + '</b> <span class="mu">' + esc(b.name) + '</span></span>' +
          "<span class='mu'>" + esc(b.type || '\u2014') + '</span>' +
          "<span class='num'>" + peso(HIS.ledger.invoiceAmount(b)) + '</span>' +
          "<span class='num'>" + peso(p) + '</span>' +
          "<span class='num'>" + peso(HIS.ledger.balanceOf(b)) + '</span>' +
          "<span>" + HIS.kit.pill(s, PILL[s]) + '</span></div>';
      }).join('') : "<div class='ad-empty'><b>No invoices</b>The demo ledger is empty.</div>") +
      "<div class='ad-foot'>Balance = billed \u2212 collected. Status is derived, never stored separately.</div>" +
      '</div>' +

      "<div class='ad-card' style='margin-bottom:24px'>" +
      "<div class='ad-bar'><h2>By invoice type</h2><span class='ad-count'>Same " + bills.length + " invoices</span></div>" +
      "<div class='ad-th ad-g-rep' style='grid-template-columns:1.6fr .9fr .9fr .9fr .9fr .7fr'><span>Type</span><span>Count</span><span>Billed</span><span>Collected</span><span>Balance</span><span>Rate</span></div>" +
      Object.keys(byType).map(function (k) {
        var t = byType[k], bal = t.billed - t.collected - t.covered, r = t.billed ? Math.round((t.collected / t.billed) * 100) : 0;
        return "<div class='ad-tr' style='grid-template-columns:1.6fr .9fr .9fr .9fr .9fr .7fr'>" +
          '<span><b>' + esc(k) + '</b></span>' +
          "<span class='num'>" + t.n + '</span>' +
          "<span class='num'>" + peso(t.billed) + '</span>' +
          "<span class='num'>" + peso(t.collected) + '</span>' +
          "<span class='num'>" + peso(bal) + '</span>' +
          "<span class='num'>" + r + '%</span></div>';
      }).join('') +
      '</div>' +

      "<div class='ad-card' style='margin-bottom:24px'>" +
      "<div class='ad-bar'><h2>Unbilled charges by source</h2><span class='ad-count'>" + chg.unbilledCount + ' charge(s)</span></div>' +
      "<div class='ad-th' style='grid-template-columns:1.6fr .9fr .9fr .9fr'><span>Source module</span><span>Charges</span><span>Value</span><span>Share</span></div>" +
      (Object.keys(bySource).length ? Object.keys(bySource).sort().map(function (k) {
        var s = bySource[k];
        return "<div class='ad-tr' style='grid-template-columns:1.6fr .9fr .9fr .9fr'>" +
          '<span><b>' + esc(k) + '</b></span>' +
          "<span class='num'>" + s.n + '</span>' +
          "<span class='num'>" + peso(s.amount) + '</span>' +
          "<span class='num'>" + (chg.unbilledTotal ? Math.round((s.amount / chg.unbilledTotal) * 100) : 0) + '%</span></div>';
      }).join('') : "<div class='ad-empty'><b>Nothing unbilled</b>Every charge raised so far is on an invoice.</div>") +
      "<div class='ad-foot'>A charge waits here until its episode has an invoice and a cashier assigns it. " +
      'It is a price, not a payment, and it is not counted in the collected figure above.</div>' +
      '</div>' +

      "<div class='ad-note'><b>Scope and basis.</b> Every figure on this page is derived at render time from the " +
      'module that owns it: invoice totals and collections from <code>HIS.ledger</code> over the invoices in ' +
      '<code>mh_invoices</code>, unbilled value from <code>HIS.charges</code>, and bed occupancy from ' +
      '<code>HIS.admissions</code>. Nothing here is a stored total, so no screen can drift from another. ' +
      'The Billing screen reads the same ledger, which is why the two cannot disagree. ' +
      'PhilHealth, HMO and discount amounts are recorded per invoice but are not yet split out as their own ' +
      'report.</div>' +
      '</div>';
  }

  build();
})();
