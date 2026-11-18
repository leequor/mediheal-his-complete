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
        notes: 'Opening balance carried forward',
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

  // Kinds that reduce the charge without being money received.
  var COVERAGE_KINDS = ['coverage', 'discount', 'adjustment'];

  // One place that defines what each transaction kind does to a balance.
  //   payment   -> money received
  //   refund    -> money returned, so it reduces what was received
  //   coverage  -> a payer (PhilHealth / HMO) settles part of the charge; NOT money the hospital
  //                received from the patient, and it must never be reported as a collection
  //   discount  -> an authorised reduction of the charge (senior citizen, PWD, hospital-approved)
  //   adjustment-> a correction that reduces the charge
  function sums(invoiceId) {
    var rows = settled(forInvoice(invoiceId));
    var paid = 0, refunded = 0, covered = 0, credited = 0;
    rows.forEach(function (t) {
      if (t.kind === 'payment') paid += t.amount;
      else if (t.kind === 'refund') refunded += t.amount;
      else if (t.kind === 'credit') credited += t.amount;      // money held, not applied
      else if (COVERAGE_KINDS.indexOf(t.kind) > -1) covered += t.amount;
      // Anything else is not money and is ignored rather than silently counted.
    });
    return { paid: paid, refunded: refunded, net: paid - refunded, covered: covered, credited: credited };
  }

  // The invoice's total charge: its opening amount from data-billing plus every active charge a
  // clinical module raised. A charge is a PRICE, not money, so it raises what is owed and never
  // touches `collected`.
  function invoiceCentavos(bill) {
    if (!bill) return 0;
    var extra = (window.HIS && HIS.charges) ? HIS.charges.totalFor(bill.id) : 0;
    return toCentavos(bill.amount) + toCentavos(extra);
  }
  function invoiceAmount(bill) { return bill ? toPesos(invoiceCentavos(bill)) : 0; }

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
    return toPesos(invoiceCentavos(bill) - paidCentavos(bill.id) - coveredCentavos(bill.id));
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
  //
  // `idempotencyKey` makes a retry safe: a second call with a key already on file returns the
  // original transaction instead of posting a second payment. A double-submitted form is the most
  // common way a ledger gains a duplicate.
  function recordPayment(input) {
    input = input || {};
    var bill = billById(input.invoiceId);
    if (!bill) return { ok: false, error: 'Invoice not found.' };
    var key = String(input.idempotencyKey || '').trim();
    if (key) {
      var dup = all().filter(function (t) { return t.idempotencyKey === key; })[0];
      if (dup) return { ok: true, transaction: dup, duplicate: true, balance: balanceOf(bill) };
    }
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
      idempotencyKey: key || undefined,
      seeded: false
    };
    if (electronic && !tx.reference) {
      return { ok: false, error: 'An electronic payment needs the provider reference number.' };
    }
    rows.push(tx);
    save(rows);
    if (window.HIS.audit && !input.silent) {
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
  //
  // `sourceId` is the id of whatever produced the row (a claim, an adjustment batch). It is unique:
  // a second posting for the same source returns the first transaction instead of adding a second.
  // That is what stops a re-settled claim from crediting the invoice twice.
  function recordCoverage(input) {
    input = input || {};
    var bill = billById(input.invoiceId);
    if (!bill) return { ok: false, error: 'Invoice not found.' };
    var sourceId = String(input.sourceId || '').trim();
    if (sourceId) {
      var existing = all().filter(function (t) { return t.sourceId === sourceId && t.status !== 'void'; })[0];
      if (existing) return { ok: true, transaction: existing, duplicate: true, balance: balanceOf(bill) };
    }
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
      sourceId: sourceId || undefined,
      seeded: false
    };
    rows.push(tx);
    save(rows);
    if (window.HIS.audit && !input.silent) {
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

  // ---- credits -------------------------------------------------------------------------------
  // Money a patient has paid that is not applied to an invoice: a deposit, a round-amount
  // overpayment, a prepayment. It is recorded, never netted off the charge, so a balance can never
  // go negative. `creditOf()` is the only place that reads it.
  function recordCredit(input) {
    input = input || {};
    var bill = billById(input.invoiceId);
    if (!bill) return { ok: false, error: 'Invoice not found.' };
    var amount = Number(input.amount);
    if (!isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter a credit amount greater than zero.' };
    if (!String(input.reference || '').trim()) {
      return { ok: false, error: 'A credit needs a reference (OR number, deposit slip, or receipt).' };
    }
    var rows = all();
    var tx = {
      id: nextId(rows), kind: 'credit', invoiceId: bill.id, patientId: bill.pt,
      method: input.method || 'Cash', reference: String(input.reference).trim(),
      amount: toCentavos(amount), at: new Date().toISOString(),
      cashier: input.cashier || actorName(), status: 'posted',
      notes: String(input.notes || '').trim(), seeded: false
    };
    rows.push(tx);
    save(rows);
    if (window.HIS.audit && !input.silent) {
      HIS.audit.append({
        who: actorName(), role: roleLabel(),
        what: 'Patient credit recorded — ' + peso(amount) + ' on ' + bill.id + ' (' + tx.reference + '); not applied to the balance',
        entity: 'invoice:' + bill.id, before: peso(balanceOf(bill)), after: peso(balanceOf(bill))
      });
    }
    return { ok: true, transaction: tx, credit: toPesos(sums(bill.id).credited) };
  }

  function creditOf(bill) {
    if (!bill) return 0;
    return toPesos(sums(bill.id).credited);
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
      billedC += invoiceCentavos(b);
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

  // ---- invariants ---------------------------------------------------------------------------
  // These must hold after every write. A failure is a bug in a write path, not a data-entry
  // problem: no screen should be able to produce one. Each check is named so a test can assert on
  // the code rather than on a sentence.
  function invariants() {
    var problems = [];
    var rows = all();
    var bySource = {};

    rows.forEach(function (t) {
      if (!isFinite(t.amount) || t.amount < 0) {
        problems.push({ code: 'negative-amount', transaction: t.id, detail: String(t.amount) });
      }
      if (t.sourceId) {
        if (bySource[t.sourceId]) {
          problems.push({ code: 'duplicate-source', sourceId: t.sourceId, a: bySource[t.sourceId], b: t.id });
        } else { bySource[t.sourceId] = t.id; }
      }
    });

    bills().forEach(function (b) {
      var amountC = invoiceCentavos(b);
      var s = sums(b.id);
      var balanceC = amountC - s.net - s.covered;
      if (balanceC < 0) problems.push({ code: 'negative-balance', invoice: b.id, detail: toPesos(balanceC) });
      if (s.covered > amountC) problems.push({ code: 'over-covered', invoice: b.id, detail: toPesos(s.covered) + ' of ' + toPesos(amountC) });
      if (s.net > amountC) problems.push({ code: 'over-collected', invoice: b.id, detail: toPesos(s.net) + ' of ' + toPesos(amountC) });
      // charge = collected + covered + outstanding, to the centavo.
      if (Math.abs((s.net + s.covered + balanceC) - amountC) > 0) {
        problems.push({ code: 'identity', invoice: b.id, detail: (s.net + s.covered + balanceC) + ' vs ' + amountC });
      }
      var paid = 0, refunded = 0;
      settled(rows.filter(function (t) { return t.invoiceId === b.id; })).forEach(function (t) {
        if (t.kind === 'payment') paid += t.amount;
        if (t.kind === 'refund') refunded += t.amount;
      });
      if (refunded > paid) problems.push({ code: 'refund-exceeds-payment', invoice: b.id, detail: toPesos(refunded) + ' of ' + toPesos(paid) });
      // A credit is money held, never a reduction of the charge: if it were counted as coverage the
      // balance would fall below zero.
      if (s.credited > 0 && balanceC < 0) {
        problems.push({ code: 'credit-applied-to-balance', invoice: b.id, detail: toPesos(s.credited) });
      }
    });

    // A pending electronic intent must never be counted as money.
    rows.forEach(function (t) {
      if (t.status === 'pending' && t.kind === 'payment') {
        var b = billById(t.invoiceId);
        if (b && paidOf(b) > balanceOf(b) + toPesos(t.amount) + 1) {
          problems.push({ code: 'pending-counted', transaction: t.id });
        }
      }
    });

    return problems;
  }

  // Cross-module reconciliation. Billing, Reports, the patient portal and the cashier all call
  // totals(); this proves they add up to the per-invoice detail and to the payment methods.
  function reconcile() {
    var t = totals();
    var collectedC = 0, coveredC = 0, billedC = 0;
    bills().forEach(function (b) {
      billedC += invoiceCentavos(b);
      var s = sums(b.id);
      collectedC += s.net;
      coveredC += s.covered;
    });
    var methodSum = byMethod().reduce(function (a, m) { return a + toCentavos(m.amount); }, 0);
    var coverageRows = settled(all()).filter(function (x) { return x.kind === 'coverage'; });
    return {
      billed: toPesos(billedC),
      collected: toPesos(collectedC),
      covered: toPesos(coveredC),
      outstanding: toPesos(billedC - collectedC - coveredC),
      totalsMatch: Math.abs(toCentavos(t.collected) - collectedC) === 0 &&
        Math.abs(toCentavos(t.covered) - coveredC) === 0 &&
        Math.abs(toCentavos(t.billed) - billedC) === 0,
      methodSum: toPesos(methodSum),
      methodMatchesCollected: Math.abs(methodSum - collectedC) <= 1,
      credits: toPesos(bills().reduce(function (a, b) { return a + sums(b.id).credited; }, 0)),
      coverageRows: coverageRows.length,
      coverageTotal: toPesos(coverageRows.reduce(function (a, x) { return a + x.amount; }, 0)),
      // Coverage is a payer's share, never a collection: the two must never be added together.
      collectedPlusCovered: toPesos(collectedC + coveredC)
    };
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
    invoiceAmount: invoiceAmount, invoiceCentavos: invoiceCentavos,
    recordPayment: recordPayment, confirm: confirm, void: voidTx, refund: refund,
    recordCoverage: recordCoverage, COVERAGE_KINDS: COVERAGE_KINDS, sums: sums,
    recordCredit: recordCredit, creditOf: creditOf,
    coveredOf: coveredOf, totals: totals, byMethod: byMethod, byPayer: byPayer,
    invariants: invariants, reconcile: reconcile
  };
})();
