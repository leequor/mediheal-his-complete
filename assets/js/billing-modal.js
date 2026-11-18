// Billing action modals as JS states of billing.html. Figma: Record payment 2064:1712, Coverage and discounts 2064:2160, Final statement 2064:5115
// (same 'Action modal' 2064:2089 layout in all three: frame-local (380,180) 680x664 r16; scrim 0b2a3d at .35 over the whole frame).
// Texts are the Figma texts for BL-8801; for other bills identity fields are substituted and amounts derived (ESTIMATED, Figma has no such states).
(function () {
  var B = HIS.billing, stage = document.getElementById('stage'), cur = null;
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var peso = function (n) { return '\u20b1' + n.toLocaleString('en-US'); };
  var p2 = function (n) { return '\u20b1' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var bill = function () { return B.bills.filter(function (b) { return b.id === HIS.blState.sel; })[0]; };
  // M7: money is read from the transaction ledger, not from a number stored on the invoice.
  var paidOf = function (b) { return HIS.ledger.paidOf(b); };
  var is01 = function (b) { return b.id === 'BL-8801'; };
  // Figma shows "Isabel G. Ramos" (middle name abbreviated) in the Record payment and Final statement subtitles; Coverage uses the full name.
  var short = function (n) { var w = String(n).split(' '); return (w.length === 3 && w[1].length > 2) ? w[0] + ' ' + w[1][0] + '. ' + w[2] : n; };

  function spec(kind, b) {
    var total = b.amount, paid = paidOf(b), bal = total - paid, cov = is01(b) ? 7040 : 0;
    if (kind === 'pay') return {
      title: 'Record payment', sub: short(b.name) + ' \u00b7 ' + b.pt + ' \u00b7 Invoice ' + b.id + ' \u00b7 Balance due ' + peso(bal), ok: 'Record payment',
      l: ['Invoice', 'Payment method', 'Amount received', 'Reference number', 'Received by', 'Notes'],
      // M7: the method is a real list of the seven Philippine channels. An electronic method
      // cannot be recorded without the provider reference it will later be reconciled against.
      v: [b.id + ' (' + HIS.ledger.statusOf(b) + ')', 'Cash', bal > 0 ? p2(bal) : '', '', 'Billing clerk on duty \u00b7 Aug 31, 2026', ''],
      bt: 'Payment check', bx: bal > 0 ? peso(bal) + ' clears the balance. Invoice ' + b.id + ' will change from ' + HIS.ledger.statusOf(b) + ' to Paid.' : 'Nothing due on this invoice.',
      methods: HIS.ledger.METHODS };
    if (kind === 'cov') {
      // M7: the payer details come from the PATIENT RECORD, not from text typed into this dialog.
      // The amounts default to zero because a PhilHealth case rate and an HMO approval are
      // decisions made by those payers — this screen records them, it does not invent them.
      var pat = (window.HIS.registry && HIS.registry.byId(b.pt)) || {};
      var ph = pat.philhealth || {}, hm = pat.hmo || {};
      var loa = [hm.provider, hm.loa].filter(Boolean).join(' \u00b7 ');
      return {
        title: 'Coverage and discounts',
        sub: b.full + ' \u00b7 ' + b.pt + ' \u00b7 Invoice ' + b.id + ' \u00b7 Total ' + peso(total) + ' \u00b7 Balance ' + peso(bal),
        ok: 'Apply to invoice',
        l: ['PhilHealth ID', 'PhilHealth case rate', 'HMO / letter of authorization', 'HMO coverage', 'Senior / PWD discount', 'Notes'],
        v: [ph.no || '', '0.00', loa, hm.coverage ? String(hm.coverage) : '0.00',
          '0.00', 'Recorded against the claim or authorisation named on the line above.'],
        bt: 'Net payable',
        bx: 'Coverage and discounts reduce the charge; they are not payments and are never counted as collected. ' +
          'Paid ' + peso(paid) + ' so far, so the balance is ' + peso(bal) + '.'
      };
    }
    if (kind === 'dl') return {
      title: 'Download invoice', sub: 'Invoice ' + b.id + ' \u00b7 ' + short(b.name) + ' \u00b7 ' + b.pt, ok: 'Download PDF',
      l: ['Document', 'File format', 'Includes', 'Invoice total', 'Copies', 'Note'],
      v: ['Invoice ' + b.id, 'PDF', 'Itemised charges, VAT', p2(b.amount), 'Patient copy and billing file copy', 'Coverage and discount lines appear once applied.'],
      bt: 'Ready to download', bx: 'A PDF of invoice ' + b.id + ' will be saved to this device.' };
    if (kind === 'dlok') return {
      title: 'Invoice downloaded', sub: 'Invoice ' + b.id + ' \u00b7 ' + short(b.name) + ' \u00b7 ' + b.pt + ' \u00b7 status unchanged', ok: 'Close',
      l: ['File name', 'Format', 'Invoice total', 'Downloaded', 'Previous status'],
      v: [b.id + '_invoice.pdf', 'PDF', p2(b.amount), 'Aug 31, 2026', HIS.ledger.statusOf(b)] };
    return {
      title: 'Final statement', sub: short(b.name) + ' \u00b7 ' + b.pt + ' \u00b7 ' + b.dept + ' \u00b7 discharge billing', ok: 'Issue statement',
      l: ['Invoice', 'Statement date', 'Total charges (incl. 12% VAT)', 'Less PhilHealth, HMO and discount', 'Less payments received', 'Discharge note'],
      v: [b.id + ' \u00b7 ' + b.pt, 'Aug 31, 2026', p2(total), p2(cov), p2(paid) + ' received on account \u00b7 balance to clear ' + p2(total - cov - paid), is01(b) ? 'Room and nursing charges closed. Clear the balance at the cashier before discharge.' : ''],
      bt: 'Balance to clear', bx: peso(total) + ' \u2212 ' + peso(cov) + ' coverage and discounts \u2212 ' + peso(paid) + ' paid = ' + peso(total - cov - paid) + ' due at discharge.' };
  }

  // label top, input top, left, width
  var POS = [[120, 142, 32, 300], [120, 142, 348, 300], [202, 224, 32, 300], [202, 224, 348, 300], [284, 306, 32, 616], [462, 484, 32, 616]];
  // "Invoice downloaded" is the compact 680x368 state (Figma 2064:5782): no banner, rows end at 388, buttons at 300.
  // It holds FIVE fields: a sixth row at y366/388 fell outside the 368px dialog (overflow is visible, so its textarea
  // floated on the page below the modal looking like a toast). The note it carried is in the dialog subtitle instead.
  // The buttons sit at y297-336, so the last field is 340 wide: at the full 616 it ran underneath them.
  var POS2 = [[120, 142, 32, 300], [120, 142, 348, 300], [202, 224, 32, 300], [202, 224, 348, 300], [284, 306, 32, 340]];

  // Invoice PDF (session 23): the Figma "Download invoice" state promises a PDF, so build a real one
  // (text-only PDF 1.4, Helvetica) instead of opening the browser print dialog. HIS.pdf lives in assets/js/pdf.js.
  function invoiceRows(b) {
    var sub = b.subtotal != null ? b.subtotal : Math.round(b.amount / 1.12);
    var vat = b.vat != null ? b.vat : b.amount - sub;
    var paid = paidOf(b), rows = [];
    var t = function (s, size, dy) { rows.push([s, size || 10, dy || 15]); };
    t('MediHeal - Hospital Information System', 15, 22);
    t('Invoice ' + b.id + ' - ' + b.full, 11, 17);
    t(b.pt + ' - ' + b.dept + ' - ' + b.date, 10, 15);
    t('Status: ' + HIS.ledger.statusOf(b), 10, 24);
    t('Description / charge source                 Qty     Rate            Amount', 10, 16);
    var items = b.items || [];
    if (items.length) items.forEach(function (r) { t(String(r[0]).slice(0, 46) + '    ' + r[1] + '    ' + String(r[2]) + '    ' + String(r[3]), 10, 14); });
    else t('Summary only — itemised lines are not recorded for this invoice', 10, 14);
    var charges = (window.HIS.charges ? HIS.charges.forInvoice(b.id) : []).filter(function (c) { return c.status !== 'void'; });
    charges.forEach(function (c) {
      t(String(c.description + ' - ' + c.sourceLabel).slice(0, 46) + '    ' + c.qty + '    ' + String(c.unitPrice) + '    ' + String(c.amount), 10, 14);
    });
    t('', 10, 12);
    t('Subtotal: ' + peso(sub), 10, 15);
    t('VAT (12%): ' + peso(vat), 10, 15);
    if (charges.length) t('Charges raised: ' + peso(charges.reduce(function (a, c) { return a + c.amount; }, 0)), 10, 15);
    t('Grand total: ' + peso(HIS.ledger.invoiceAmount(b)), 12, 17);
    t('Paid: ' + peso(paid), 10, 15);
    t('Balance due: ' + peso(HIS.ledger.balanceOf(b)), 12, 17);
    t('', 10, 14);
    t('Generated Aug 31, 2026 by the billing desk.', 9, 13);
    return rows;
  }
  function saveInvoicePdf(b) { HIS.pdf.save(invoiceRows(b), b.id + '_invoice.pdf'); }

  function open(kind) {
    var b = bill(); if (!b) return; close();
    cur = { kind: kind, b: b }; var s = spec(kind, b), compact = kind === 'dlok';
    var h = "<div class='bl-scrim' data-mclose='1'></div><div class='bl-modal" + (compact ? ' compact' : '') + "' role='dialog' aria-modal='true' aria-label='" + esc(s.title) + "'>";
    h += "<button class='bl-m-x' data-mclose='1' aria-label='Close'>\u00d7</button><div class='bl-m-t'>" + esc(s.title) + "</div><div class='bl-m-s'>" + esc(s.sub) + "</div><div class='bl-m-d'></div>";
    (compact ? POS2 : POS).forEach(function (p, i) {
      h += "<div class='bl-m-l' style='top:" + p[0] + 'px;left:' + p[2] + "px'>" + esc(s.l[i]) + '</div>';
      if (i === 5) h += "<textarea class='bl-m-i bl-m-ta' data-i='" + i + "' style='top:" + p[1] + 'px;left:' + p[2] + 'px;width:' + p[3] + "px'>" + esc(s.v[i]) + '</textarea>';
      else if (i === 1 && s.methods) h += "<select class='bl-m-i' data-i='" + i + "' style='top:" + p[1] + 'px;left:' + p[2] + 'px;width:' + p[3] + "px'>" +
        s.methods.map(function (m) { return "<option" + (m === s.v[i] ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select>';
      else h += "<input class='bl-m-i' data-i='" + i + "' value='" + esc(s.v[i]) + "' style='top:" + p[1] + 'px;left:' + p[2] + 'px;width:' + p[3] + "px'>";
    });
    if (compact) h += "<button class='bl-m-c' data-mclose='1'>Back to billing</button><button class='bl-m-ok' id='blok'>Close</button>";
    else h += "<div class='bl-m-b'><b>" + esc(s.bt) + "</b><span id='blbx'>" + esc(s.bx) + "</span></div><button class='bl-m-c' data-mclose='1'>Cancel</button><button class='bl-m-ok' id='blok'>" + esc(s.ok) + '</button>';
    h += '</div>';
    var w = document.createElement('div'); w.id = 'blmodal'; w.innerHTML = h; stage.appendChild(w);
    var f = w.querySelector(kind === 'pay' ? '[data-i="2"]' : '.bl-m-i'); if (f) f.focus();
  }
  function close() { var w = document.getElementById('blmodal'); if (w) w.remove(); cur = null; }
  var toast = function (t) { document.dispatchEvent(new CustomEvent('bl:tip', { detail: t })); };

  function confirm() {
    var b = cur.b, w = document.getElementById('blmodal');
    if (cur.kind === 'dlok') { close(); return; }
    if (cur.kind === 'dl') { saveInvoicePdf(b); open('dlok'); return; }
    if (cur.kind === 'pay') {
      var w = document.getElementById('blmodal');
      var inp = w.querySelector('[data-i="2"]'), bal = HIS.ledger.balanceOf(b);
      var amt = parseFloat(String(inp.value).replace(/[^0-9.]/g, ''));
      var bad = !(amt > 0) || amt > bal + 0.001;
      inp.classList.toggle('err', bad);
      if (bad) { toast(bal > 0 ? 'Enter an amount between \u20b10.01 and ' + p2(bal) : 'Nothing due on this invoice'); return; }

      // M7: the payment is a ledger transaction, not an overwrite of a number on the invoice.
      var method = w.querySelector('[data-i="1"]').value;
      var ref = w.querySelector('[data-i="3"]').value;
      var notes = w.querySelector('[data-i="5"]').value;
      var r = HIS.ledger.recordPayment({ invoiceId: b.id, amount: amt, method: method, reference: ref, notes: notes });
      if (!r.ok) {
        var refEl = w.querySelector('[data-i="3"]');
        refEl.classList.toggle('err', true);
        toast(r.error);
        return;
      }
      close();
      document.dispatchEvent(new CustomEvent('bl:refresh'));
      toast(HIS.ledger.ELECTRONIC.indexOf(method) > -1
        ? 'Recorded ' + p2(amt) + ' via ' + method + ' \u2014 awaiting provider confirmation'
        : 'Payment recorded: ' + p2(amt) + ' (' + method + ')');
      return;
    }
    if (cur.kind === 'cov') {
      var wc = document.getElementById('blmodal');
      var numOf = function (s) { return parseFloat(String(s || '').replace(/[^0-9.]/g, '')) || 0; };
      var g = function (i) { return wc.querySelector('[data-i="' + i + '"]').value; };
      var phAmt = numOf(g(1)), hmoAmt = numOf(g(3)), discAmt = numOf(g(4));
      if (phAmt + hmoAmt + discAmt <= 0) {
        toast('Enter at least one coverage or discount amount.');
        return;
      }
      var pat = (window.HIS.registry && HIS.registry.byId(b.pt)) || {};
      var entries = [];
      if (phAmt > 0) entries.push({ kind: 'coverage', payer: 'PhilHealth', reference: g(0).trim(), amount: phAmt, notes: g(5) });
      if (hmoAmt > 0) entries.push({ kind: 'coverage', payer: (pat.hmo && pat.hmo.provider) || 'HMO', reference: g(2).trim(), amount: hmoAmt, notes: g(5) });
      // A discount must name the authorisation it rests on: an amount with no OSCA/PWD number is a leak.
      if (discAmt > 0) {
        if (!/\d/.test(g(4))) { toast('Name the OSCA / PWD ID or authorisation in the discount line.'); return; }
        entries.push({ kind: 'discount', payer: 'Senior / PWD discount', reference: g(4).trim(), basis: g(4).trim(), amount: discAmt, notes: g(5) });
      }
      var applied = 0, lastErr = '';
      for (var i = 0; i < entries.length; i++) {
        var r = HIS.ledger.recordCoverage({
          invoiceId: b.id, kind: entries[i].kind, payer: entries[i].payer,
          reference: entries[i].reference, amount: entries[i].amount,
          basis: entries[i].basis, notes: entries[i].notes
        });
        if (r.ok) applied += entries[i].amount; else lastErr = r.error;
      }
      if (!applied) { toast(lastErr || 'Nothing was applied.'); return; }
      close();
      document.dispatchEvent(new CustomEvent('bl:refresh'));
      toast('Applied ' + p2(applied) + ' in coverage and discounts. Balance now ' + p2(HIS.ledger.balanceOf(b)) + '.');
      return;
    }

    close(); toast((cur ? '' : '') + (b.id) + ': statement issued');
  }

  document.addEventListener('bl:open', function (e) { open(e.detail); });
  stage.addEventListener('click', function (e) {
    if (e.target.closest('[data-mclose]')) { close(); return; }
    if (e.target.closest('#blok')) confirm();
  });
  stage.addEventListener('input', function (e) {
    if (!cur || cur.kind !== 'pay' || e.target.getAttribute('data-i') !== '2') return;
    var b = cur.b, bal = b.amount - paidOf(b), a = parseFloat(String(e.target.value).replace(/[^0-9.]/g, '')) || 0, el = document.getElementById('blbx');
    el.textContent = a >= bal && bal > 0 ? peso(bal) + ' clears the balance. Invoice ' + b.id + ' will change from ' + HIS.ledger.statusOf(b) + ' to Paid.' : (a > 0 ? 'Balance after this payment: ' + peso(Math.max(0, Math.round((bal - a) * 100) / 100)) + '. Invoice ' + b.id + ' stays ' + (HIS.ledger.statusOf(b) === 'Pending' ? 'Partial after payment' : HIS.ledger.statusOf(b)) + '.' : 'Enter the amount received.');
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && cur) close(); });
})();
