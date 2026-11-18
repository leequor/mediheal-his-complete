// Billable charges (M11).
//
// WHY THIS EXISTS
// Clinical work never reached an invoice. A laboratory order, a dispensed drug and a consultation
// were all recorded, but the invoice total was a number written by hand in `data-billing.js`. The
// hospital's revenue loop stopped at the ward: nothing ordered, given or done became billable.
//
// WHAT A CHARGE IS
// A charge is a PRICE EVENT, not money. It says "this patient incurred ₱350 for a CBC". It is not a
// payment and never touches the ledger's collected figure. The ledger learns about it only through
// `invoiceAmount()`, which adds charges to the invoice's opening amount so the balance owed grows.
//
// IDEMPOTENCY
// A charge is keyed on (source, sourceId, code). Re-saving an order, re-rendering a screen or
// re-running a dispense therefore cannot bill the same event twice. `void()` retires a charge with a
// reason and removes it from the total; the row stays for the audit trail.
//
// NOT MODELLED
// No charge master with effective dates, no price tiers per payer, no VAT treatment per line, no
// credit notes, no refunds of charges. `data-billing.js` keeps the invoice's opening amount; charges
// are added on top of it.
(function () {
  var KEY = 'mh_charges';

  var SOURCES = {
    laboratory: 'Laboratory',
    pharmacy: 'Pharmacy',
    consultation: 'Consultation',
    room: 'Room and board',
    nursing: 'Nursing',
    manual: 'Manual entry'
  };

  function state() {
    var s = HIS.store.get(KEY, null);
    if (!s || !Array.isArray(s.charges)) s = { charges: [], version: 1 };
    return s;
  }
  function save(s) { HIS.store.set(KEY, s); return s; }
  function all() { return state().charges.slice(); }
  function active() { return all().filter(function (c) { return c.status !== 'void'; }); }
  function forInvoice(id) { return all().filter(function (c) { return c.invoiceId === id; }); }

  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

  // What the active charges on an invoice add up to.
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

  // The invoice a new charge should land on: the patient's oldest invoice that still has a balance.
  // Returns null when the patient has nothing open, and the caller then records nothing — a charge
  // against a settled invoice would reopen it and misstate what is owed.
  function openInvoiceFor(patientId) {
    var bills = (window.HIS && HIS.billing && HIS.billing.bills) || [];
    var mine = bills.filter(function (b) { return b.pt === patientId; });
    var open = mine.filter(function (b) {
      if (window.HIS && HIS.ledger) return HIS.ledger.balanceOf(b) > 0.005;
      return b.status !== 'Paid';
    });
    return open[0] || null;
  }

  // add({ invoiceId, patientId, source, sourceId, code, description, qty, unitPrice })
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

    var key = [input.source, input.sourceId, input.code || input.description].join('|');
    var existing = all().filter(function (c) { return c.key === key && c.status !== 'void'; })[0];
    if (existing) return { ok: true, charge: existing, duplicate: true };

    var invoiceId = input.invoiceId || null;
    if (!invoiceId) {
      var bill = openInvoiceFor(input.patientId);
      if (!bill) {
        return { ok: false, error: 'No open invoice for ' + (input.patientId || 'this patient') + '; the charge was not recorded.' };
      }
      invoiceId = bill.id;
    }

    var s = state();
    var charge = {
      id: nextId(),
      key: key,
      invoiceId: invoiceId,
      patientId: input.patientId || null,
      source: input.source,
      sourceLabel: SOURCES[input.source],
      sourceId: String(input.sourceId),
      code: String(input.code || ''),
      description: String(input.description).trim(),
      qty: qty,
      unitPrice: r2(unit),
      amount: r2(qty * unit),
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
        what: 'Charge raised \u2014 ' + charge.description + ' ' + peso(charge.amount) + ' on ' + invoiceId +
          ' (' + charge.sourceLabel + ')',
        entity: 'invoice:' + invoiceId, before: '\u2014', after: peso(charge.amount)
      });
    }
    return { ok: true, charge: charge };
  }

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
        entity: 'invoice:' + c.invoiceId, before: 'active', after: 'void'
      });
    }
    return { ok: true, charge: c };
  }

  function stats() {
    var rows = active();
    var bySource = {};
    rows.forEach(function (c) { bySource[c.sourceLabel] = r2((bySource[c.sourceLabel] || 0) + c.amount); });
    return {
      charges: rows.length,
      total: r2(rows.reduce(function (t, c) { return t + c.amount; }, 0)),
      bySource: bySource,
      voided: all().length - rows.length
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
    all: all, active: active, forInvoice: forInvoice, totalFor: totalFor,
    openInvoiceFor: openInvoiceFor, add: add, void: voidCharge,
    stats: stats, reset: reset
  };
})();
