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

  // One place that defines what each transaction kind does to a balance.
  //   payment   -> money received
  //   refund    -> money returned, so it reduces what was received
  //   coverage  -> a payer (PhilHealth / HMO) settles part of the charge; NOT money the hospital
  //                received from the patient, and it must never be reported as a collection
  //   discount  -> an authorised reduction of the charge (senior citizen, PWD, hospital-approved)
  //   adjustment-> a correction that reduces the charge
  function sums(invoiceId) {
    var rows = settled(forInvoice(invoiceId));
    var paid = 0, refunded = 0, covered = 0;
    rows.forEach(function (t) {
      if (t.kind === 'payment') paid += t.amount;
      else if (t.kind === 'refund') refunded += t.amount;
      else covered += t.amount;   // coverage | discount | adjustment
    });
    return { paid: paid, refunded: refunded, net: paid - refunded, covered: covered };
  }

  function paidCentavos(invoiceId) { return sums(invoiceId).net; }
  function coveredCentavos(invoiceId) { return sums(invoiceId).covered; }

  function paidOf(bill) {
    if (!bill) return 0;
    return toPesos(paidCentavos(bill.id));
  }
  // What a payer other than the patient has taken off the bill. Reported separately from collected.
  function coveredOf(bill) {
    if (!bill) return 0;
    return toPesos(coveredCentavos(bill.id));
  }
  function balanceOf(bill) {
    if (!bill) return 0;
    return toPesos(toCentavos(bill.amount) - paidCentavos(bill.id) - coveredCentavos(bill.id));
  }

  // Status is DERIVED, never stored independently: an invoice cannot claim "Paid" while its
  // transactions say otherwise.
  function statusOf(bill) {
    if (!bill) return '';
    var bal = balanceOf(bill);
    var s = sums(bill.id);
    if (bal <= 0.005) return 'Paid';
    if (s.net > 0 || s.covered > 0) return 'Partial';
    return 'Pending';
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

  // ---- coverage and discounts ---------------------------------------------------------------
  // A payer taking part of the bill is NOT a payment. It is recorded as its own kind so that
  // "collected" (money the hospital actually received) never inflates by the PhilHealth or HMO
  // share, and the patient's own balance reflects the reduction.
  //
  // Every row needs a basis and a reference, because a discount without a reason is a leak.
  var COVERAGE_KINDS = ['coverage', 'discount', 'adjustment'];

  function recordCoverage(input) {
    input = input || {};
    var bill = billById(input.invoiceId);
    if (!bill) return { ok: false, error: 'Invoice not found.' };
    var kind = COVERAGE_KINDS.indexOf(input.kind) > -1 ? input.kind : 'coverage';
    var amount = Number(input.amount);
    if (!isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter an amount greater than zero.' };
    if (amount > balanceOf(bill) + 1e-9) {
      return { ok: false, error: 'That is more than the outstanding balance of ' + peso(balanceOf(bill)) + '.' };
    }
    if (!String(input.reference || '').trim()) {
      return { ok: false, error: 'A ' + kind + ' needs a reference (case rate, LOA number, or authorisation).' };
    }
    if (!String(input.payer || '').trim()) {
      return { ok: false, error: 'Record who is covering this amount.' };
    }
    var rows = all();
    var tx = {
      id: nextId(rows), kind: kind,
      invoiceId: bill.id, patientId: bill.pt,
      method: input.payer,
      reference: String(input.reference).trim(),
      amount: toCentavos(amount),
      at: new Date().toISOString(),
      cashier: actorName(),
      status: 'posted',
      notes: String(input.notes || '').trim(),
      basis: String(input.basis || '').trim(),
      seeded: false
    };
    rows.push(tx);
    save(rows);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actorName(), role: roleLabel(),
        what: (kind === 'discount' ? 'Discount applied' : kind === 'coverage' ? 'Coverage applied' : 'Adjustment applied') +
          ' \u2014 ' + peso(amount) + ' from ' + tx.method + ' on ' + bill.id + ' (' + tx.reference + ')' +
          (tx.basis ? ' \u00b7 ' + tx.basis : ''),
        entity: 'invoice:' + bill.id, before: peso(balanceOf(bill) + amount), after: peso(balanceOf(bill))
      });
    }
    return { ok: true, transaction: tx, balance: balanceOf(bill) };
  }

  // ---- aggregates ---------------------------------------------------------------------------
  // Every figure is a filter over the ledger, so no screen can disagree with another.
  // `collected` is money received. `covered` is what a payer took off the bill. They are never
  // added together, because a PhilHealth case rate is not a collection.
  function totals(filter) {
    filter = filter || {};
    var list = bills().filter(function (b) {
      if (filter.type && b.type !== filter.type) return false;
      if (filter.dept && b.dept !== filter.dept) return false;
      if (filter.from && new Date(b.date) < new Date(filter.from)) return false;
      return true;
    });
    var billedC = 0, collectedC = 0, coveredC = 0;
    list.forEach(function (b) {
      billedC += toCentavos(b.amount);
      var s = sums(b.id);
      collectedC += s.net;
      coveredC += s.covered;
    });
    return {
      invoices: list.length,
      billed: toPesos(billedC),
      collected: toPesos(collectedC),
      covered: toPesos(coveredC),
      outstanding: toPesos(billedC - collectedC - coveredC),
      rate: billedC ? Math.round((collectedC / billedC) * 100) : 0
    };
  }

  // Payment-method distribution counts MONEY RECEIVED only. Coverage rows carry a payer name in
  // `method`, so including them here would list Maxicare as a payment channel.
  function byMethod() {
    var map = {};
    settled(all()).forEach(function (t) {
      if (t.kind !== 'payment' && t.kind !== 'refund') return;
      var k = t.method || 'Unspecified';
      map[k] = (map[k] || 0) + (t.kind === 'refund' ? -t.amount : t.amount);
    });
    return Object.keys(map).map(function (k) { return { method: k, amount: toPesos(map[k]) }; })
      .sort(function (a, b) { return b.amount - a.amount; });
  }

  // Payer mix: who took money off the bill, and how much.
  function byPayer() {
    var map = {};
    settled(all()).forEach(function (t) {
      if (COVERAGE_KINDS.indexOf(t.kind) < 0) return;
      var k = (t.method || 'Unspecified') + (t.kind === 'discount' ? ' (discount)' : '');
      map[k] = (map[k] || 0) + t.amount;
    });
    return Object.keys(map).map(function (k) { return { payer: k, amount: toPesos(map[k]) }; })
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
    recordCoverage: recordCoverage, COVERAGE_KINDS: COVERAGE_KINDS, sums: sums,
    coveredOf: coveredOf, totals: totals, byMethod: byMethod, byPayer: byPayer
  };
})();
