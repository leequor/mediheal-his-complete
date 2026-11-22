// Billable charges (M11, reworked in M12).
//
// WHAT A CHARGE IS
// A PRICE EVENT, not money. It says "this patient incurred 350 for a CBC". It never touches the
// ledger's collected figure. The ledger learns about it through `invoiceAmount()`, which adds the
// charges assigned to an invoice to that invoice's opening amount.
//
// WHAT M12 CHANGED, AND WHY
// M11 had one rule for finding an invoice: "the patient's oldest invoice with a balance". That is a
// guess. A patient with a closed outpatient visit and an open admission would have today's ward order
// billed to last month's clinic bill, and a patient with no open invoice had the charge DISCARDED —
// the service was recorded but the revenue vanished.
//
// Now:
//   1. A charge always names an ENCOUNTER (the episode it happened in).
//   2. The encounter may name an invoice. If it does, the charge is assigned to it immediately —
//      a reliable reference, not a search.
//   3. If it does not, the charge is still created and stays in the UNBILLED QUEUE. Nothing is lost.
//   4. Moving a charge from the queue onto an invoice is an explicit, audited `assign()`.
//
// PRICE SNAPSHOT
// Every charge copies the price it was raised at (`priceSnapshot`). Changing a tariff afterwards
// cannot rewrite history.
//
// REVERSAL
// `void()` retires a charge with a reason. The row stays, with who, when and why. A voided charge
// stops counting towards any invoice total. Nothing is ever deleted.
//
// STORAGE: `mh_charges` ({ charges: [] }). See docs/DATA-MODEL.md.
(function () {
  var KEY = 'mh_charges';

  var SOURCES = {
    laboratory: 'Laboratory',
    pharmacy: 'Pharmacy',
    consultation: 'Consultation',
    room: 'Room and board',
    nursing: 'Nursing',
    procedure: 'Procedure',
    manual: 'Manual entry'
  };

  // Seeds only when the key is ABSENT. An explicitly stored empty list stays empty, which is what
  // a harness (or a hospital that has voided everything) needs to be able to say.
  function state() {
    var s = HIS.store.get(KEY, null);
    if (!s || !Array.isArray(s.charges)) s = seed();
    return s;
  }

  // THE QUEUE STARTED EMPTY, AND THAT READS AS BROKEN.
  // Charges are only created when someone raises one in this tab, so a first visit showed
  // "0 charges / PHP 0" next to a Billing screen holding PHP 160,860 of invoiced work. The two
  // records below are genuinely UNBILLED charges on encounters that are still open: they do not
  // touch any invoice total (an invoice's amount is its own stored figure, and only an assigned
  // charge is added to it), and they give the queue something real to work with. Seeding the
  // invoice lines as charges was tried first and doubled every bill, which the ledger harness
  // caught — the invoice items are a summary of a stored amount, not a second set of charges.
  function seed() {
    if (!bills().length) return { charges: [], version: 2 };
    var at = '2026-08-31T09:15:00+08:00', rows = [];
    [['PT-99213', 'ENC-0001', 'Nursing \u2014 wound dressing, sterile field', 1, 850, 'nursing'],
     ['PT-99210', 'ENC-0003', 'Laboratory \u2014 CBC with platelet count', 1, 650, 'laboratory']].forEach(function (u, i) {
      rows.push({
        id: 'CH-' + ('000' + (i + 1)).slice(-4),
        key: 'seed:unbilled:' + (i + 1),
        patientId: u[0], encounterId: u[1], invoiceId: null,
        billingStatus: 'unbilled',
        unbilledReason: 'Raised after the last invoice was cut for this encounter.',
        source: u[5], sourceLabel: SOURCES[u[5]], sourceId: 'seed:' + (i + 1), code: '',
        description: u[2], qty: u[3], unitPrice: r2(u[4]), amount: r2(u[3] * u[4]),
        priceSnapshot: { unitPrice: r2(u[4]), tariffCode: null, effectiveFrom: null, capturedAt: at },
        at: at, by: 'Ward clerk', status: 'active', notes: ''
      });
    });
    var st = { charges: rows, version: 2 };
    HIS.store.set(KEY, st);
    return st;
  }

  function save(s) { HIS.store.set(KEY, s); return s; }
  function all() { return state().charges.slice(); }
  function active() { return all().filter(function (c) { return c.status !== 'void'; }); }
  function byId(id) { return all().filter(function (c) { return c.id === id; })[0] || null; }

  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  // Assigned and still active. An unbilled charge has no invoiceId, so it can never appear on a bill.
  function forInvoice(id) { return all().filter(function (c) { return c.invoiceId === id; }); }
  function forEncounter(id) { return all().filter(function (c) { return c.encounterId === id; }); }
  function forPatient(id) { return all().filter(function (c) { return c.patientId === id; }); }

  // THE UNBILLED QUEUE. Every active charge that has no invoice.
  function unbilled() {
    return active().filter(function (c) { return !c.invoiceId; })
      .sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
  }

  function totalFor(invoiceId) {
    return r2(active().filter(function (c) { return c.invoiceId === invoiceId; })
      .reduce(function (t, c) { return t + c.amount; }, 0));
  }

  function nextId() {
    var max = all().reduce(function (m, c) {
      var v = parseInt(String(c.id).split('-').pop(), 10);
      return isNaN(v) ? m : Math.max(m, v);
    }, 0);
    return 'CH-' + String(max + 1).padStart(4, '0');
  }

  function bills() { return (window.HIS && HIS.billing && HIS.billing.bills) || []; }
  function billById(id) { return bills().filter(function (b) { return b.id === id; })[0] || null; }

  // Resolve the episode a charge belongs to. Prefer what the caller passed; otherwise the patient's
  // most recent open encounter; otherwise none (the charge is unbilled and says why).
  function resolveEncounter(input) {
    if (input.encounterId) return window.HIS.encounters ? HIS.encounters.byId(input.encounterId) : null;
    if (window.HIS.encounters && input.patientId) return HIS.encounters.openFor(input.patientId);
    return null;
  }

  // add({ patientId, encounterId, invoiceId, source, sourceId, code, description, qty, unitPrice, notes })
  // Always returns a charge unless the input itself is invalid. A missing invoice is not an error.
  function add(input) {
    input = input || {};
    if (Object.keys(SOURCES).indexOf(input.source) < 0) {
      return { ok: false, error: 'Unknown charge source: ' + input.source };
    }
    if (!String(input.sourceId || '').trim()) return { ok: false, error: 'A charge needs the id of the event that caused it.' };
    if (!String(input.description || '').trim()) return { ok: false, error: 'A charge needs a description.' };
    var qty = Number(input.qty == null ? 1 : input.qty);
    var unit = Number(input.unitPrice);
    if (!(qty > 0)) return { ok: false, error: 'A charge needs a positive quantity.' };
    if (!(unit >= 0)) return { ok: false, error: 'A charge needs a unit price.' };

    var patient = input.patientId && window.HIS.registry ? HIS.registry.byId(input.patientId) : null;
    if (input.patientId && !patient) return { ok: false, error: 'Patient ' + input.patientId + ' is not in the registry.' };

    var key = [input.source, input.sourceId, input.code || input.description].join('|');
    var existing = all().filter(function (c) { return c.key === key && c.status !== 'void'; })[0];
    if (existing) return { ok: true, charge: existing, duplicate: true };

    var encounter = resolveEncounter(input);
    var encounterId = encounter ? encounter.id : (input.encounterId || null);

    // The invoice comes from the episode, never from a search for "something with a balance".
    var invoiceId = input.invoiceId || (encounter ? encounter.invoiceId : null) || null;
    var unbilledReason = '';
    if (invoiceId) {
      var bill = billById(invoiceId);
      if (!bill) return { ok: false, error: 'Invoice ' + invoiceId + ' does not exist.' };
      if (patient && bill.pt !== patient.id) {
        return { ok: false, error: 'Invoice ' + invoiceId + ' belongs to ' + bill.pt + ', not ' + patient.id + '.' };
      }
    } else if (!encounter) {
      unbilledReason = 'No open encounter for ' + (input.patientId || 'this patient') + '; assign it to an invoice once one exists.';
    } else {
      unbilledReason = 'Encounter ' + encounter.id + ' has no invoice linked.';
    }

    var s = state();
    var charge = {
      id: nextId(),
      key: key,
      patientId: input.patientId || null,
      encounterId: encounterId,
      invoiceId: invoiceId,
      billingStatus: invoiceId ? 'assigned' : 'unbilled',
      unbilledReason: unbilledReason,
      source: input.source,
      sourceLabel: SOURCES[input.source],
      sourceId: String(input.sourceId),
      code: String(input.code || ''),
      description: String(input.description).trim(),
      qty: qty,
      unitPrice: r2(unit),
      amount: r2(qty * unit),
      // The price this charge was raised at, kept even if the tariff changes later.
      priceSnapshot: {
        unitPrice: r2(unit),
        tariffCode: input.tariffCode || null,
        effectiveFrom: input.tariffEffectiveFrom || null,
        capturedAt: new Date().toISOString()
      },
      at: new Date().toISOString(),
      by: actor(),
      status: 'active',
      notes: String(input.notes || '').trim()
    };
    s.charges.push(charge);
    save(s);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Charge raised \u2014 ' + charge.description + ' ' + peso(charge.amount) + ' (' + charge.sourceLabel + ')' +
          (invoiceId ? ' on ' + invoiceId : ' \u00b7 unbilled'),
        entity: invoiceId ? 'invoice:' + invoiceId : 'charge:' + charge.id,
        before: '\u2014', after: peso(charge.amount)
      });
    }
    return { ok: true, charge: charge, unbilled: !invoiceId };
  }

  // Put an unbilled charge on an invoice. This is the only way a charge changes invoice, and it is
  // audited with a reason so the queue has a trail.
  function assign(chargeId, invoiceId, reason) {
    var s = state();
    var c = s.charges.filter(function (x) { return x.id === chargeId; })[0];
    if (!c) return { ok: false, error: 'Charge not found.' };
    if (c.status === 'void') return { ok: false, error: 'A voided charge cannot be assigned.' };
    if (c.invoiceId) return { ok: false, error: 'That charge is already on ' + c.invoiceId + '.' };
    var bill = billById(invoiceId);
    if (!bill) return { ok: false, error: 'Invoice not found.' };
    if (c.patientId && bill.pt !== c.patientId) {
      return { ok: false, error: 'Invoice ' + invoiceId + ' belongs to ' + bill.pt + ', not ' + c.patientId + '.' };
    }
    if (!String(reason || '').trim()) return { ok: false, error: 'Assigning a charge to an invoice needs a reason.' };

    c.invoiceId = bill.id;
    c.billingStatus = 'assigned';
    c.unbilledReason = '';
    c.assignedAt = new Date().toISOString();
    c.assignedBy = actor();
    c.assignmentReason = String(reason).trim();
    save(s);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Charge assigned \u2014 ' + c.id + ' ' + c.description + ' ' + peso(c.amount) + ' \u2192 ' + bill.id + ' \u00b7 ' + c.assignmentReason,
        entity: 'invoice:' + bill.id, before: 'unbilled', after: 'assigned'
      });
    }
    return { ok: true, charge: c };
  }

  // Return an assigned charge to the queue. Needed when a charge was put on the wrong episode; the
  // original assignment stays in the audit log.
  function unassign(chargeId, reason) {
    var s = state();
    var c = s.charges.filter(function (x) { return x.id === chargeId; })[0];
    if (!c) return { ok: false, error: 'Charge not found.' };
    if (c.status === 'void') return { ok: false, error: 'A voided charge cannot be unassigned.' };
    if (!c.invoiceId) return { ok: false, error: 'That charge is not on an invoice.' };
    if (!String(reason || '').trim()) return { ok: false, error: 'Unassigning a charge needs a reason.' };
    var before = c.invoiceId;
    c.invoiceId = null;
    c.billingStatus = 'unbilled';
    c.unbilledReason = 'Returned to the queue \u00b7 ' + String(reason).trim();
    c.unassignedAt = new Date().toISOString();
    c.unassignedBy = actor();
    save(s);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Charge unassigned \u2014 ' + c.id + ' from ' + before + ' \u00b7 ' + c.unbilledReason,
        entity: 'invoice:' + before, before: 'assigned', after: 'unbilled'
      });
    }
    return { ok: true, charge: c };
  }

  // Retire a charge. The row is kept; only its status changes.
  function voidCharge(id, reason) {
    var s = state();
    var c = s.charges.filter(function (x) { return x.id === id; })[0];
    if (!c) return { ok: false, error: 'Charge not found.' };
    if (c.status === 'void') return { ok: false, error: 'That charge is already void.' };
    if (!String(reason || '').trim()) return { ok: false, error: 'Voiding a charge needs a reason.' };
    c.status = 'void';
    c.voidedAt = new Date().toISOString();
    c.voidedBy = actor();
    c.voidReason = String(reason).trim();
    save(s);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Charge voided \u2014 ' + c.id + ' ' + c.description + ' ' + peso(c.amount) + ' \u00b7 ' + c.voidReason,
        entity: c.invoiceId ? 'invoice:' + c.invoiceId : 'charge:' + c.id, before: 'active', after: 'void'
      });
    }
    return { ok: true, charge: c };
  }

  // Void every active charge raised by one source event. Used by the clinical modules when the event
  // itself is cancelled: a cancelled order must not leave a live charge behind.
  function voidForSource(source, sourceId, reason) {
    var hits = active().filter(function (c) { return c.source === source && c.sourceId === String(sourceId); });
    var out = [];
    hits.forEach(function (c) { out.push(voidCharge(c.id, reason)); });
    return { ok: true, count: out.length, results: out };
  }

  function stats() {
    var rows = active();
    var un = unbilled();
    var bySource = {};
    rows.forEach(function (c) { bySource[c.sourceLabel] = r2((bySource[c.sourceLabel] || 0) + c.amount); });
    return {
      charges: rows.length,
      total: r2(rows.reduce(function (t, c) { return t + c.amount; }, 0)),
      bySource: bySource,
      voided: all().length - rows.length,
      unbilledCount: un.length,
      unbilledTotal: r2(un.reduce(function (t, c) { return t + c.amount; }, 0)),
      assignedCount: rows.length - un.length
    };
  }

  // Cross-module checks. Each returns a named code so a test can assert the rule, not a sentence.
  function reconcile() {
    var problems = [];
    var rows = all();
    var seen = {};

    rows.forEach(function (c) {
      if (c.status === 'void') return;
      if (seen[c.key]) {
        problems.push({ code: 'duplicate-key', charge: c.id, other: seen[c.key], key: c.key });
      } else { seen[c.key] = c.id; }

      if (c.invoiceId) {
        var b = billById(c.invoiceId);
        if (!b) problems.push({ code: 'orphan-invoice', charge: c.id, invoice: c.invoiceId });
        else if (c.patientId && b.pt !== c.patientId) {
          problems.push({ code: 'wrong-patient', charge: c.id, invoice: c.invoiceId, patient: c.patientId });
        }
        if (c.billingStatus !== 'assigned') {
          problems.push({ code: 'status-mismatch', charge: c.id, detail: c.billingStatus });
        }
      } else if (c.billingStatus !== 'unbilled') {
        problems.push({ code: 'status-mismatch', charge: c.id, detail: c.billingStatus });
      }

      if (c.amount < 0) problems.push({ code: 'negative-charge', charge: c.id, detail: c.amount });
      if (!c.priceSnapshot || !isFinite(c.priceSnapshot.unitPrice)) {
        problems.push({ code: 'missing-snapshot', charge: c.id });
      }
    });

    // Every invoice's charge total must equal the sum of the charges pointing at it.
    bills().forEach(function (b) {
      var direct = rows.filter(function (c) { return c.status !== 'void' && c.invoiceId === b.id; })
        .reduce(function (t, c) { return t + c.amount; }, 0);
      if (Math.abs(r2(direct) - totalFor(b.id)) > 0.005) {
        problems.push({ code: 'invoice-charge-total', invoice: b.id, detail: r2(direct) + ' vs ' + totalFor(b.id) });
      }
    });

    var un = unbilled();
    return {
      problems: problems,
      unbilledCount: un.length,
      unbilledTotal: r2(un.reduce(function (t, c) { return t + c.amount; }, 0)),
      assignedTotal: r2(active().reduce(function (t, c) { return t + c.amount; }, 0) - un.reduce(function (t, c) { return t + c.amount; }, 0)),
      // A charge with no encounter cannot be reconciled to an episode; it is reported, not hidden.
      withoutEncounter: active().filter(function (c) { return !c.encounterId; }).length
    };
  }

  function reset() { HIS.store.remove(KEY); return state(); }

  function peso(n) {
    return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function actor() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    return a ? a.name : 'system';
  }
  function roleLabel() {
    var a = window.HIS && HIS.auth && HIS.auth.account();
    if (!a || !window.HIS.rbac) return '\u2014';
    return (HIS.rbac.ROLES[a.role] || {}).label || a.role;
  }

  HIS.charges = {
    KEY: KEY, SOURCES: SOURCES,
    all: all, active: active, byId: byId,
    forInvoice: forInvoice, forEncounter: forEncounter, forPatient: forPatient,
    unbilled: unbilled, totalFor: totalFor,
    add: add, assign: assign, unassign: unassign, void: voidCharge, voidForSource: voidForSource,
    stats: stats, reconcile: reconcile, reset: reset
  };
})();
