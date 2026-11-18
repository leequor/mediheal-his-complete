// Charge master (M12).
//
// WHY THIS EXISTS
// M11 let clinical work become a charge, but every price was either a constant inside a module
// (`lab.js` CATALOG) or a number written into a screen. There was nowhere to answer "what does a
// consultation cost, and since when?" — and no way to change a price without silently rewriting
// what past charges were worth.
//
// WHAT THIS IS
// An effective-dated price list for the services that had no price list: consultations, room and
// board, and nursing. Laboratory prices stay in `lab.js` CATALOG, which is already a catalogue with
// a price per test; adding a second copy here would create two sources for one number.
//
// PRICE SNAPSHOT
// A charge never reads this table again after it is raised. `charges.add()` copies the resolved
// price into the charge row (`priceSnapshot`). Changing a tariff here therefore cannot move a
// historical charge — it only changes the next one.
//
// EFFECTIVE DATES
// A code may have several rows. `priceFor(code, date)` returns the latest row whose
// `effectiveFrom` is on or before that date. A row dated in the future is a *proposed* price and is
// returned only when the requested date reaches it. Nothing is ever deleted: a price that stopped
// applying gets a successor row, it does not lose its history.
//
// STORAGE: `mh_tariffs` (array). Synthetic demonstration prices, not a real hospital price list.
(function () {
  var KEY = 'mh_tariffs';

  var CATEGORIES = {
    consultation: 'Consultation',
    room: 'Room and board',
    nursing: 'Nursing',
    procedure: 'Procedure'
  };

  // Consultation fees are the per-department consultant rates already printed in
  // `data-departments.js` ("Senior consultant, ₱1,500/consult"). They are not new numbers.
  var SEED = [
    { code: 'CONS-CARD', category: 'consultation', description: 'Consultation \u2014 Cardiology', price: 1500, unit: 'visit', effectiveFrom: '2026-01-01' },
    { code: 'CONS-NEURO', category: 'consultation', description: 'Consultation \u2014 Neurology', price: 1600, unit: 'visit', effectiveFrom: '2026-01-01' },
    { code: 'CONS-ORTHO', category: 'consultation', description: 'Consultation \u2014 Orthopaedics', price: 1700, unit: 'visit', effectiveFrom: '2026-01-01' },
    { code: 'CONS-OBGYN', category: 'consultation', description: 'Consultation \u2014 OB-GYN', price: 1600, unit: 'visit', effectiveFrom: '2026-01-01' },
    { code: 'CONS-MED', category: 'consultation', description: 'Consultation \u2014 General Medicine', price: 1600, unit: 'visit', effectiveFrom: '2026-01-01' },
    { code: 'CONS-GEN', category: 'consultation', description: 'Consultation \u2014 outpatient', price: 1200, unit: 'visit', effectiveFrom: '2026-01-01' },
    // A proposed successor. It is returned only for a date on or after 2027-01-01, so it proves the
    // effective-date mechanism without moving a single number on today's screens.
    { code: 'CONS-CARD', category: 'consultation', description: 'Consultation \u2014 Cardiology', price: 1650, unit: 'visit', effectiveFrom: '2027-01-01', proposed: true },

    // Room and board. Private matches the "Room charges (3 days) 3 x 2,800" line already on
    // invoice BL-8801, so the demo's own history and this table agree.
    { code: 'ROOM-PRIVATE', category: 'room', description: 'Private room and board', price: 2800, unit: 'day', effectiveFrom: '2026-01-01' },
    { code: 'ROOM-SEMI', category: 'room', description: 'Semi-private room and board', price: 2000, unit: 'day', effectiveFrom: '2026-01-01' },
    { code: 'ROOM-WARD', category: 'room', description: 'Ward bed and board', price: 1200, unit: 'day', effectiveFrom: '2026-01-01' },

    { code: 'NURSE-DAY', category: 'nursing', description: 'Nursing care \u2014 per inpatient day', price: 600, unit: 'day', effectiveFrom: '2026-01-01' }
  ];

  function read() {
    var rows = HIS.store.get(KEY, null);
    if (!Array.isArray(rows) || !rows.length) {
      rows = SEED.map(function (r) { return JSON.parse(JSON.stringify(r)); });
      HIS.store.set(KEY, rows);
    }
    return rows;
  }
  function save(rows) { HIS.store.set(KEY, rows); return rows; }
  function all() { return read().slice(); }

  function today() { return new Date(); }

  // Latest row for a code that is in force on `onDate`.
  function priceFor(code, onDate) {
    var when = onDate ? new Date(onDate) : today();
    if (isNaN(when)) return null;
    var rows = read().filter(function (r) {
      return r.code === code && new Date(r.effectiveFrom).getTime() <= when.getTime();
    });
    rows.sort(function (a, b) { return new Date(b.effectiveFrom) - new Date(a.effectiveFrom); });
    return rows[0] || null;
  }

  // What a caller should use before raising a charge. Never invent a price: a missing tariff is a
  // configuration gap and is reported as one.
  function quote(code, onDate) {
    var t = priceFor(code, onDate);
    if (!t) return { ok: false, error: 'No tariff is configured for ' + code + '. Configure the price before billing it.', code: code };
    return { ok: true, tariff: t, price: t.price, code: t.code, description: t.description, unit: t.unit, effectiveFrom: t.effectiveFrom };
  }

  // Current price per code, one row each — what an administration screen lists.
  function current(onDate) {
    var byCode = {};
    read().forEach(function (r) { byCode[r.code] = true; });
    return Object.keys(byCode).map(function (c) { return priceFor(c, onDate); })
      .filter(Boolean)
      .sort(function (a, b) { return a.category === b.category ? a.code.localeCompare(b.code) : a.category.localeCompare(b.category); });
  }

  function history(code) {
    return read().filter(function (r) { return r.code === code; })
      .sort(function (a, b) { return new Date(a.effectiveFrom) - new Date(b.effectiveFrom); });
  }

  // Add a new effective-dated price. The previous row is left untouched, so a charge raised last
  // month keeps the price it was raised at.
  function setPrice(input) {
    input = input || {};
    var code = String(input.code || '').trim().toUpperCase();
    if (!code) return { ok: false, error: 'A tariff needs a code.' };
    if (!CATEGORIES[input.category]) return { ok: false, error: 'Choose a tariff category.' };
    var price = Number(input.price);
    if (!(price >= 0)) return { ok: false, error: 'Enter a price of zero or more.' };
    if (!input.effectiveFrom) return { ok: false, error: 'A price change needs an effective date.' };
    var rows = read();
    var clash = rows.filter(function (r) { return r.code === code && r.effectiveFrom === input.effectiveFrom; })[0];
    if (clash) return { ok: false, error: 'That code already has a price effective ' + input.effectiveFrom + '.' };
    var row = {
      code: code, category: input.category,
      description: String(input.description || code).trim(),
      price: Math.round(price * 100) / 100,
      unit: input.unit || 'unit',
      effectiveFrom: input.effectiveFrom,
      proposed: !!input.proposed,
      addedBy: actor(), addedAt: new Date().toISOString()
    };
    rows.push(row);
    save(rows);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Tariff ' + code + ' set to ' + peso(row.price) + ' from ' + row.effectiveFrom +
          ' (previous charges keep their snapshot)',
        entity: 'tariff:' + code, before: '\u2014', after: String(row.price)
      });
    }
    return { ok: true, tariff: row };
  }

  // The tariff code for a department's consultation. Falls back to the generic outpatient rate
  // rather than inventing a department price.
  function consultationCode(dept) {
    var d = String(dept || '').toLowerCase();
    if (/cardio/.test(d)) return 'CONS-CARD';
    if (/neuro/.test(d)) return 'CONS-NEURO';
    if (/ortho/.test(d)) return 'CONS-ORTHO';
    if (/ob|gyn/.test(d)) return 'CONS-OBGYN';
    if (/medicine/.test(d)) return 'CONS-MED';
    return 'CONS-GEN';
  }

  // Bed type -> room-and-board code. The bed type is the only input, so a transfer between bed
  // types changes the rate for the next billable day and nothing else.
  var ROOM_CODES = { Private: 'ROOM-PRIVATE', 'Semi-private': 'ROOM-SEMI', Ward: 'ROOM-WARD' };
  function roomCode(bedType) { return ROOM_CODES[bedType] || null; }

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

  HIS.tariffs = {
    KEY: KEY, CATEGORIES: CATEGORIES, ROOM_CODES: ROOM_CODES,
    all: all, current: current, history: history,
    priceFor: priceFor, quote: quote, setPrice: setPrice,
    consultationCode: consultationCode, roomCode: roomCode
  };
})();
