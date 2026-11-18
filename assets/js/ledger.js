// Billing ledger (M7 foundation, used by the patient portal in M5).
//
// THE PROBLEM THIS FIXES
// Before this module every screen computed "how much has been paid" differently:
//   billing.js          b.paid != null ? b.paid : (status === 'Paid' ? total : 0)
//   billing-modal.js    the same expression, copied
//   reports.js          re-derived it a third time
//   the KPI strip       was hardcoded to Figma sample text (PHP 482K / 395K / 87K) and had no
//                       relationship to the four invoices underneath it at all
// There was no transaction record anywhere: recording a payment overwrote a number on the invoice.
//
// THE MODEL NOW
//   invoice  ->  charge lines (on the invoice)
//            ->  transactions (this module, the ONLY record of money moving)
//            ->  balance = total - sum(posted transactions)
//
// MONEY IS STORED IN CENTAVOS (integer). Every amount crossing this boundary is converted once,
// so 0.1 + 0.2 can never drift. `peso()` is display only.
//
// STORAGE: `mh_tx` (array). Browser-only, synthetic. See docs/DATA-MODEL.md.
(function () {
  var KEY = 'mh_tx';

  var METHODS = ['Cash', 'GCash', 'Maya', 'QR Ph', 'Bank transfer', 'Debit card', 'Credit card'];
  // Methods where the hospital cannot confirm settlement itself. Recording one of these in this
  // demo stores an INTENT with status 'pending', never a settled payment.
  var ELECTRONIC = ['GCash', 'Maya', 'QR Ph', 'Bank transfer', 'Debit card', 'Credit card'];

  function toCentavos(pesos) { return Math.round(Number(pesos || 0) * 100); }
  function toPesos(centavos) { return Math.round(Number(centavos || 0)) / 100; }

  function bills() { return (window.HIS && HIS.billing && HIS.billing.bills) || []; }
  function billById(id) { return bills().filter(function (b) { return b.id === id; })[0] || null; }

  // ---- seed ---------------------------------------------------------------------------------
  // The four demo invoices already carried a `paid` figure. Rather than lose it, it is migrated
  // into one opening transaction per invoice so that `sum(transactions) === previous paid` exactly.
  // Numbers on screen therefore do not move; only their provenance changes.
  function seed() {
    var out = [], n = 0;
    bills().forEach(function (b) {
      var paid = b.paid != null ? b.paid : (b.status === 'Paid' ? b.amount : 0);
      if (!paid) return;
      n++;
      out.push({
        id: 'TX-' + String(n).padStart(4, '0'),
        kind: 'payment', invoiceId: b.id, patientId: b.pt,
        method: b.status === 'Paid' ? 'Cash' : 'Cash',
        reference: 'OPN-' + b.id,
        amount: toCentavos(paid),
        at: new Date('2026-08-29T10:15:00+08:00').toISOString(),
        cashier: 'Aileen Ramos', status: 'posted',
        notes: 'Opening balance migrated from the invoice record (pre-ledger demo data)',
        seeded: true
      });
    });
    HIS.store.set(KEY, out);
    return out;
  }

  function all() {
    var rows = HIS.store.get(KEY, null);
    if (!Array.isArray(rows)) rows = seed();
    return rows;
  }
  function save(rows) { HIS.store.set(KEY, rows); return rows; }

  function nextId(rows) {
    var max = rows.reduce(function (m, t) {
      var v = parseInt(String(t.id).replace(/\D/g, ''), 10);
      return isNaN(v) ? m : Math.max(m, v);
    }, 0);
    return 'TX-' + String(max + 1).padStart(4, '0');
  }

  // ---- reads --------------------------------------------------------------------------------
  function forInvoice(invoiceId) {
    return all().filter(function (t) { return t.invoiceId === invoiceId; });
  }
  function forPatient(patientId) {
    return all().filter(function (t) { return t.patientId === patientId; });
  }

  // Only `posted` rows move money. `pending` (electronic intent) and `void` do not.
  function settled(rows) {
    return rows.filter(function (t) { return t.status === 'posted'; });
  }

  function paidCentavos(invoiceId) {
    return settled(forInvoice(invoiceId)).reduce(function (s, t) {
      return s + (t.kind === 'refund' || t.kind === 'adjustment' ? -t.amount : t.amount);
    }, 0);
  }
  function paidOf(bill) {
    if (!bill) return 0;
    return toPesos(paidCentavos(bill.id));
  }
  function balanceOf(bill) {
    if (!bill) return 0;
    return toPesos(toCentavos(bill.amount) - paidCentavos(bill.id));
  }

  // Status is DERIVED, never stored independently: an invoice cannot claim "Paid" while its
  // transactions say otherwise.
  function statusOf(bill) {
    if (!bill) return '';
    var paid = paidCentavos(bill.id), total = toCentavos(bill.amount);
    if (paid <= 0) return 'Pending';
    if (paid >= total) return 'Paid';
    return 'Partial';
  }

  function pendingOf(bill) {
    return all().filter(function (t) {
      return t.invoiceId === bill.id && t.status === 'pending';
    });
  }

  // ---- writes -------------------------------------------------------------------------------
  // Record money against an invoice. Returns { ok, transaction } or { ok:false, error }.
  // `amount` is in PESOS for the caller's convenience; it is converted once, here.
  function recordPayment(input) {
    input = input || {};
    var bill = billById(input.invoiceId);
    if (!bill) return { ok: false, error: 'Invoice not found.' };
    var amount = Number(input.amount);
    if (!isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter an amount greater than zero.' };
    if (METHODS.indexOf(input.method) < 0) return { ok: false, error: 'Choose a valid payment method.' };

    var balance = balanceOf(bill);
    if (amount > balance + 1e-9) {
      return { ok: false, error: 'That is more than the outstanding balance of ' + peso(balance) + '.' };
    }

    var rows = all();
    var electronic = ELECTRONIC.indexOf(input.method) > -1;
    var tx = {
      id: nextId(rows), kind: input.kind || 'payment',
      invoiceId: bill.id, patientId: bill.pt,
      method: input.method,
      reference: String(input.reference || '').trim() || (electronic ? '' : 'CASH-' + (rows.length + 1)),
      amount: toCentavos(amount),
      at: new Date().toISOString(),
      cashier: input.cashier || actorName(),
      // An electronic payment cannot be marked settled by the hospital in a static demo.
      status: electronic ? 'pending' : 'posted',
      notes: String(input.notes || '').trim(),
      seeded: false
    };
    if (electronic && !tx.reference) {
      return { ok: false, error: 'An electronic payment needs the provider reference number.' };
    }
    rows.push(tx);
    save(rows);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actorName(), role: roleLabel(),
        what: 'Payment recorded \u2014 ' + peso(amount) + ' via ' + tx.method + ' on ' + bill.id +
          (electronic ? ' (awaiting provider confirmation)' : ''),
        entity: 'invoice:' + bill.id, before: peso(balance), after: peso(balanceOf(bill))
      });
    }
    return { ok: true, transaction: tx, balance: balanceOf(bill) };
  }

  // Confirm an electronic payment after the provider reference has been checked elsewhere.
  function confirm(id) {
    var rows = all();
    var i = rows.findIndex(function (t) { return t.id === id; });
    if (i < 0) return { ok: false, error: 'Transaction not found.' };
    if (rows[i].status !== 'pending') return { ok: false, error: 'Only a pending transaction can be confirmed.' };
    rows[i].status = 'posted';
    rows[i].confirmedAt = new Date().toISOString();
    rows[i].confirmedBy = actorName();
    save(rows);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actorName(), role: roleLabel(),
        what: 'Payment confirmed \u2014 ' + rows[i].id + ' ' + peso(toPesos(rows[i].amount)) + ' (' + rows[i].method + ')',
        entity: 'invoice:' + rows[i].invoiceId, before: 'pending', after: 'posted'
      });
    }
    return { ok: true, transaction: rows[i] };
  }

  function voidTx(id, reason) {
    var rows = all();
    var i = rows.findIndex(function (t) { return t.id === id; });
    if (i < 0) return { ok: false, error: 'Transaction not found.' };
    if (rows[i].status === 'void') return { ok: false, error: 'Already void.' };
    var before = rows[i].status;
    rows[i].status = 'void';
    rows[i].voidedAt = new Date().toISOString();
    rows[i].voidedBy = actorName();
    rows[i].voidReason = reason || '';
    save(rows);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actorName(), role: roleLabel(),
        what: 'Transaction voided \u2014 ' + id + (reason ? ' \u00b7 ' + reason : ''),
        entity: 'invoice:' + rows[i].invoiceId, before: before, after: 'void'
      });
    }
    return { ok: true, transaction: rows[i] };
  }

  function refund(input) {
    input = input || {};
    var bill = billById(input.invoiceId);
    if (!bill) return { ok: false, error: 'Invoice not found.' };
    var paid = paidOf(bill);
    var amount = Number(input.amount);
    if (!isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter a refund amount.' };
    if (amount > paid) return { ok: false, error: 'A refund cannot exceed the ' + peso(paid) + ' received.' };
    var rows = all();
    var tx = {
      id: nextId(rows), kind: 'refund', invoiceId: bill.id, patientId: bill.pt,
      method: input.method || 'Cash', reference: String(input.reference || '').trim(),
      amount: toCentavos(amount), at: new Date().toISOString(),
      cashier: input.cashier || actorName(), status: 'posted',
      notes: String(input.notes || '').trim(), seeded: false
    };
    rows.push(tx);
    save(rows);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actorName(), role: roleLabel(),
        what: 'Refund issued \u2014 ' + peso(amount) + ' on ' + bill.id,
        entity: 'invoice:' + bill.id, before: peso(paid), after: peso(paidOf(bill))
      });
    }
    return { ok: true, transaction: tx };
  }

  // ---- aggregates ---------------------------------------------------------------------------
  // Every figure is a filter over the ledger, so no screen can disagree with another.
  function totals(filter) {
    filter = filter || {};
    var list = bills().filter(function (b) {
      if (filter.type && b.type !== filter.type) return false;
      if (filter.dept && b.dept !== filter.dept) return false;
      if (filter.from && new Date(b.date) < new Date(filter.from)) return false;
      return true;
    });
    var billedC = list.reduce(function (s, b) { return s + toCentavos(b.amount); }, 0);
    var collectedC = list.reduce(function (s, b) { return s + paidCentavos(b.id); }, 0);
    return {
      invoices: list.length,
      billed: toPesos(billedC),
      collected: toPesos(collectedC),
      outstanding: toPesos(billedC - collectedC),
      rate: billedC ? Math.round((collectedC / billedC) * 100) : 0
    };
  }

  function byMethod() {
    var map = {};
    settled(all()).forEach(function (t) {
      var k = t.method || 'Unspecified';
      map[k] = (map[k] || 0) + (t.kind === 'refund' ? -t.amount : t.amount);
    });
    return Object.keys(map).map(function (k) { return { method: k, amount: toPesos(map[k]) }; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  // ---- helpers ------------------------------------------------------------------------------
  function peso(n) {
    return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function actorName() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    return a ? a.name : 'system';
  }
  function roleLabel() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    if (!a || !window.HIS.rbac) return '\u2014';
    return (HIS.rbac.ROLES[a.role] || {}).label || a.role;
  }

  HIS.ledger = {
    KEY: KEY, METHODS: METHODS, ELECTRONIC: ELECTRONIC,
    toCentavos: toCentavos, toPesos: toPesos, peso: peso,
    all: all, save: save, seed: seed,
    forInvoice: forInvoice, forPatient: forPatient, settled: settled,
    paidOf: paidOf, balanceOf: balanceOf, statusOf: statusOf, pendingOf: pendingOf,
    recordPayment: recordPayment, confirm: confirm, void: voidTx, refund: refund,
    totals: totals, byMethod: byMethod
  };
})();
