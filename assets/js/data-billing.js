// Billing data from Figma 351:847 (session 8). Only BL-8801 has line items in the main frame; the others come from the Recent Bills rows.
// `type` (Inpatient/Outpatient) is NOT in the main frame: ESTIMATED (8801 has room charges so Inpatient). Totals for the other bills are ESTIMATED (single summary row).
//
// M12: the invoice table is now PERSISTENT. It used to be a literal array, which meant an invoice
// could never be created — a charge with no open invoice had nowhere to go and was discarded. The
// four seeded invoices are unchanged and are written to `mh_invoices` on first read, so every figure
// on every screen stays exactly where it was. `HIS.billing.bills` remains the same array-shaped
// property the rest of the application already reads.
//
// STORAGE: `mh_invoices`. Synthetic records only.
window.HIS = window.HIS || {};
(function () {
  var KEY = 'mh_invoices';

  var SEED = [
    { id: 'BL-8801', name: 'Isabel Geliz Ramos', full: 'Isabel Geliz V. Ramos', pt: 'PT-99213', dept: 'Cardiology', date: 'Aug 29, 2026', status: 'Partial', amount: 17360, type: 'Inpatient',
      items: [['Consultation \u2014 Dr. L. Laureta', 1, 1500, 1500], ['ECG \u2014 12-lead', 1, 600, 600], ['Echocardiogram', 1, 3200, 3200], ['Room and board \u2014 private, 3 days', 3, 2800, 8400], ['Nursing care \u2014 3 days', 3, 600, 1800]],
      subtotal: 15500, vat: 1860, paid: 10000 },
    { id: 'BL-8800', name: 'Maria Santos', full: 'Maria Santos', pt: 'PT-99215', dept: 'OB-GYN', date: 'Aug 29, 2026', status: 'Paid', amount: 4200, type: 'Outpatient' },
    { id: 'BL-8799', name: 'Rilaneh M. Acabal', full: 'Rilaneh Marie L. Acabal', pt: 'PT-99212', dept: 'Orthopedics', date: 'Aug 28, 2026', status: 'Paid', amount: 86500, type: 'Inpatient' },
    { id: 'BL-8798', name: 'Eleanor Whitfield', full: 'Eleanor Whitfield', pt: 'PT-99211', dept: 'Neurology', date: 'Aug 27, 2026', status: 'Pending', amount: 52800, type: 'Outpatient' }
  ];

  function seed() {
    var rows = JSON.parse(JSON.stringify(SEED));
    if (window.HIS.store) HIS.store.set(KEY, rows);
    return rows;
  }

  function all() {
    if (!window.HIS.store) return SEED.slice();
    var rows = HIS.store.get(KEY, null);
    if (!Array.isArray(rows) || !rows.length) return seed();
    return rows;
  }
  function save(rows) { if (window.HIS.store) HIS.store.set(KEY, rows); return rows; }
  function byId(id) { return all().filter(function (b) { return b.id === id; })[0] || null; }
  function forPatient(patientId) { return all().filter(function (b) { return b.pt === patientId; }); }

  function nextId() {
    var max = all().reduce(function (m, b) {
      var v = parseInt(String(b.id).replace(/\D/g, ''), 10);
      return isNaN(v) ? m : Math.max(m, v);
    }, 8800);
    return 'BL-' + (max + 1);
  }

  // Open a bill for a patient. The opening amount is zero by default: the value of the invoice comes
  // from the charges assigned to it, which is what keeps `invoiceAmount()` the single definition of
  // an invoice total. An opening amount is only used when migrating a balance that already exists.
  function create(input) {
    input = input || {};
    var p = window.HIS.registry && HIS.registry.byId(input.patientId);
    if (!p) return { ok: false, error: 'Choose a patient.' };
    var amount = Number(input.amount || 0);
    if (!isFinite(amount) || amount < 0) return { ok: false, error: 'An opening amount cannot be negative.' };
    var rows = all();
    var id = nextId();
    var now = new Date();
    var b = {
      id: id,
      name: p.name,
      full: p.name,
      pt: p.id,
      dept: input.dept || p.dept || '\u2014',
      date: now.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }),
      status: 'Pending',
      amount: Math.round(amount * 100) / 100,
      type: input.type || p.type || 'Outpatient',
      encounterId: input.encounterId || null,
      notes: String(input.notes || '').trim(),
      source: 'created',
      createdAt: now.toISOString(),
      createdBy: actor()
    };
    rows.push(b);
    save(rows);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Invoice opened \u2014 ' + id + ' for ' + p.name + ' (' + p.id + ')' +
          (b.encounterId ? ' \u00b7 encounter ' + b.encounterId : ''),
        entity: 'invoice:' + id, before: null, after: String(b.amount)
      });
    }
    return { ok: true, bill: b };
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

  var api = {
    KEY: KEY,
    stats: [['Total billed (Aug)', '\u20b1482K', ''], ['Collected', '\u20b1395K', 'g'], ['Outstanding', '\u20b187K', 'r'], ['Bills today', '12', '']],
    all: all, byId: byId, forPatient: forPatient, create: create, nextId: nextId
  };

  // `bills` stays a property, not a function, so no reader has to change.
  Object.defineProperty(api, 'bills', {
    configurable: true, enumerable: true,
    get: function () { return all(); }
  });

  HIS.billing = api;
})();
