// Admissions, beds, transfers and discharge (M12).
//
// WHY THIS EXISTS
// `Patient` already carried `ward`, `bed` and `admittedAt`, and the Billing screen had a cosmetic
// "Final statement" button — but there was no admission record, no bed board, no way to move a
// patient between beds, no room-and-board accrual and no discharge. An inpatient could not actually
// be admitted, and a bed could be occupied by two people without anything noticing.
//
// WHAT IS MODELLED
//   admission  one inpatient episode: who, where, why, from when, until when.
//   bed        a configured bed with a type. Occupancy is DERIVED from the active admission that
//              names it — there is no second `occupied` flag that can disagree.
//   transfer   a movement between beds, recorded as history, never as an overwrite.
//   accrual    room-and-board and nursing charges per billable day, idempotent per (admission, day).
//   discharge  a controlled close: final accrual, bed release, encounter completion, billing review.
//
// THE DAILY BILLING CUTOFF — the one rule everything else follows
// A calendar day is billable when the patient was in the bed at **12:00 Asia/Manila** on that day.
//   - admitted at or before noon  -> that day is billable
//   - admitted after noon         -> billing starts the next day
//   - discharged after noon       -> that day is billable
//   - discharged at or before noon-> that day is not
// The rate is the rate of the bed occupied at that cutoff, so a transfer after noon changes the
// rate from the next day and a posted day never has to be re-priced.
// Days already covered by an invoice's opening amount (`legacyBilledThrough`) are never re-charged.
//
// STORAGE: `mh_admissions`, `mh_bed_state`. Synthetic records only.
(function () {
  var AKEY = 'mh_admissions';
  var SKEY = 'mh_bed_state';

  // Configured bed inventory. `split` is explicit, not derived: the demo has to keep the two beds
  // the patient registry already names (C-204, N-112) at the type their invoices imply, so the
  // blocks are stated rather than calculated. Order within a ward is private, then semi, then ward.
  var WARDS = [
    { dept: 'Cardiology', ward: 'Cardiology Ward', prefix: 'C', start: 201, beds: 40, split: { private: 4, semi: 12, ward: 24 } },
    { dept: 'Neurology', ward: 'Neurology Ward', prefix: 'N', start: 101, beds: 24, split: { private: 4, semi: 9, ward: 11 } },
    { dept: 'Orthopaedics', ward: 'Orthopaedics Ward', prefix: 'O', start: 301, beds: 30, split: { private: 4, semi: 10, ward: 16 } },
    { dept: 'OB-GYN', ward: 'OB-GYN Ward', prefix: 'G', start: 401, beds: 36, split: { private: 4, semi: 12, ward: 20 } },
    { dept: 'General Medicine', ward: 'General Medicine Ward', prefix: 'M', start: 501, beds: 30, split: { private: 4, semi: 10, ward: 16 } },
    { dept: 'Nursing', ward: 'Nursing Ward', prefix: 'W', start: 601, beds: 12, split: { private: 0, semi: 4, ward: 8 } }
  ];

  var DISPOSITIONS = ['Discharged home', 'Discharged to another facility', 'Transferred to another ward', 'Against medical advice', 'Deceased'];

  // The two episodes the demo already shows. Room and board for them is already inside the opening
  // amount of their invoices, so `legacyBilledThrough` stops the accrual from billing the same
  // nights twice.
  var SEED = [
    { id: 'ADM-0001', patientId: 'PT-99213', encounterId: 'ENC-0001', status: 'active',
      admittedAt: '2026-08-29T09:10:00+08:00', attending: 'Dr. Laurice Laureta', dept: 'Cardiology',
      ward: 'Cardiology Ward', bedId: 'BED-C-204', bedLabel: 'C-204', bedType: 'Private',
      diagnosis: 'Unstable angina', reason: 'Chest pain with ST depression on ECG',
      payer: { type: 'philhealth', reference: '12-345678901-2' },
      transfers: [], legacyBilledThrough: '2026-08-31',
      discharge: null, createdBy: 'Joel Aquino', createdAt: '2026-08-29T09:10:00+08:00' },
    { id: 'ADM-0002', patientId: 'PT-99211', encounterId: 'ENC-0002', status: 'active',
      admittedAt: '2026-08-30T23:05:00+08:00', attending: 'Dr. Jeremias Esperanza', dept: 'Neurology',
      ward: 'Neurology Ward', bedId: 'BED-N-112', bedLabel: 'N-112', bedType: 'Semi-private',
      diagnosis: 'Migraine with aura', reason: 'Intractable headache, failed outpatient analgesia',
      payer: { type: 'hmo', reference: 'PC-8812034' },
      transfers: [], legacyBilledThrough: '2026-08-31',
      discharge: null, createdBy: 'Joel Aquino', createdAt: '2026-08-30T23:05:00+08:00' }
  ];

  // Beds taken out of service for a reason that is not a patient.
  var SEED_BED_STATE = {
    'BED-C-205': { status: 'cleaning', since: '2026-08-31T07:00:00+08:00', note: 'Terminal clean after discharge' },
    'BED-N-105': { status: 'cleaning', since: '2026-08-31T08:30:00+08:00', note: 'Terminal clean after discharge' },
    'BED-O-315': { status: 'maintenance', since: '2026-08-30T14:00:00+08:00', note: 'Bed rail repair' }
  };

  // ---- bed inventory ---------------------------------------------------------------------------
  function typeAt(split, index) {
    if (index < split.private) return 'Private';
    if (index < split.private + split.semi) return 'Semi-private';
    return 'Ward';
  }

  function buildBeds() {
    var out = [];
    WARDS.forEach(function (w) {
      for (var i = 0; i < w.beds; i++) {
        var label = w.prefix + '-' + (w.start + i);
        out.push({
          id: 'BED-' + label, label: label, ward: w.ward, dept: w.dept,
          type: typeAt(w.split, i)
        });
      }
    });
    return out;
  }
  var BEDS = buildBeds();
  var BED_BY_ID = {};
  BEDS.forEach(function (b) { BED_BY_ID[b.id] = b; });

  function read() {
    var rows = HIS.store.get(AKEY, null);
    if (!Array.isArray(rows) || !rows.length) {
      rows = SEED.map(function (r) { return JSON.parse(JSON.stringify(r)); });
      HIS.store.set(AKEY, rows);
    }
    return rows;
  }
  function save(rows) { HIS.store.set(AKEY, rows); return rows; }
  function bedState() {
    var s = HIS.store.get(SKEY, null);
    if (!s || typeof s !== 'object') { s = JSON.parse(JSON.stringify(SEED_BED_STATE)); HIS.store.set(SKEY, s); }
    return s;
  }
  function saveBedState(s) { HIS.store.set(SKEY, s); return s; }

  function all() { return read().slice(); }
  function byId(id) { return read().filter(function (a) { return a.id === id; })[0] || null; }
  function active() { return all().filter(function (a) { return a.status === 'active'; }); }
  function forPatient(patientId) { return all().filter(function (a) { return a.patientId === patientId; }); }
  function activeForPatient(patientId) {
    return active().filter(function (a) { return a.patientId === patientId; })[0] || null;
  }

  // ---- beds ------------------------------------------------------------------------------------
  function beds() { return BEDS.slice(); }
  function bedById(id) { return BED_BY_ID[id] || null; }
  function wards() { return WARDS.map(function (w) { return { ward: w.ward, dept: w.dept, beds: w.beds }; }); }
  function bedsFor(ward) { return BEDS.filter(function (b) { return b.ward === ward; }); }

  // Occupancy is derived: a bed is occupied when an ACTIVE admission names it. One source of truth.
  function occupantOf(bedId) {
    return active().filter(function (a) { return a.bedId === bedId; })[0] || null;
  }

  function bedStatus(bedId) {
    if (occupantOf(bedId)) return 'occupied';
    var s = bedState()[bedId];
    return s ? s.status : 'available';
  }

  function bedView(bedId) {
    var b = bedById(bedId);
    if (!b) return null;
    var occ = occupantOf(bedId);
    var st = bedState()[bedId];
    return {
      id: b.id, label: b.label, ward: b.ward, dept: b.dept, type: b.type,
      status: occ ? 'occupied' : (st ? st.status : 'available'),
      admissionId: occ ? occ.id : null,
      patientId: occ ? occ.patientId : null,
      note: !occ && st ? st.note : ''
    };
  }

  function bedBoard(ward) {
    var list = ward ? bedsFor(ward) : BEDS;
    return list.map(function (b) { return bedView(b.id); });
  }

  function occupancy() {
    var total = BEDS.length;
    var occ = BEDS.filter(function (b) { return !!occupantOf(b.id); }).length;
    var out = BEDS.filter(function (b) {
      var st = bedState()[b.id];
      return !occupantOf(b.id) && st && st.status !== 'available';
    }).length;
    return {
      total: total, occupied: occ, available: total - occ - out, outOfService: out,
      rate: total ? Math.round((occ / total) * 100) : 0
    };
  }

  function firstFreeBed(ward, type) {
    var list = bedsFor(ward).filter(function (b) {
      if (bedStatus(b.id) !== 'available') return false;
      return !type || b.type === type;
    });
    return list[0] || null;
  }

  function setBedState(bedId, status, note) {
    if (!bedById(bedId)) return { ok: false, error: 'Bed not found.' };
    if (occupantOf(bedId)) return { ok: false, error: 'That bed is occupied. Transfer or discharge the patient first.' };
    if (['available', 'cleaning', 'maintenance'].indexOf(status) < 0) return { ok: false, error: 'Unknown bed state.' };
    var s = bedState();
    if (status === 'available') delete s[bedId];
    else s[bedId] = { status: status, since: new Date().toISOString(), note: String(note || '').trim() };
    saveBedState(s);
    audit('Bed ' + (bedById(bedId).label) + ' set to ' + status + (note ? ' \u00b7 ' + note : ''), 'bed:' + bedId, '\u2014', status);
    return { ok: true };
  }

  // ---- admission -------------------------------------------------------------------------------
  function nextId(rows) {
    var max = rows.reduce(function (m, a) {
      var v = parseInt(String(a.id).split('-').pop(), 10);
      return isNaN(v) ? m : Math.max(m, v);
    }, 0);
    return 'ADM-' + String(max + 1).padStart(4, '0');
  }

  function admit(input) {
    input = input || {};
    var p = window.HIS.registry && HIS.registry.byId(input.patientId);
    if (!p) return { ok: false, error: 'Choose a patient.' };
    if (!String(input.diagnosis || '').trim()) return { ok: false, error: 'An admission needs a documented reason or diagnosis.' };
    if (!input.bedId) return { ok: false, error: 'Assign a bed before admitting the patient.' };
    var bed = bedById(input.bedId);
    if (!bed) return { ok: false, error: 'Bed not found.' };

    // One active inpatient episode per patient. A readmission is a new record after discharge.
    var existing = activeForPatient(p.id);
    if (existing) {
      return { ok: false, error: p.name + ' already has an active admission (' + existing.id + ', bed ' + existing.bedLabel + ').' };
    }
    var occupant = occupantOf(bed.id);
    if (occupant) {
      return { ok: false, error: 'Bed ' + bed.label + ' is occupied by ' + occupant.patientId + ' (' + occupant.id + ').' };
    }
    if (bedStatus(bed.id) !== 'available') {
      return { ok: false, error: 'Bed ' + bed.label + ' is ' + bedStatus(bed.id) + ' and cannot be assigned.' };
    }

    var at = input.admittedAt || clock().toISOString();
    if (!isFinite(Date.parse(at))) return { ok: false, error: 'Enter a valid admission date.' };
    var rows = read();

    // The encounter is opened first so the admission can point at it and every later charge has an
    // episode to belong to.
    var enc = null;
    if (window.HIS.encounters) {
      var e = HIS.encounters.open({
        patientId: p.id, kind: 'inpatient', dept: bed.dept,
        provider: input.attending || p.doctor || '',
        admittedAt: at, notes: String(input.diagnosis).trim()
      });
      if (e.ok) enc = e.encounter;
      else if (e.encounter) enc = e.encounter; // already open — reuse rather than fail the admission
    }

    var a = {
      id: nextId(rows), patientId: p.id, encounterId: enc ? enc.id : null, status: 'active',
      admittedAt: at,
      attending: String(input.attending || p.doctor || '').trim(),
      dept: bed.dept, ward: bed.ward,
      bedId: bed.id, bedLabel: bed.label, bedType: bed.type,
      diagnosis: String(input.diagnosis).trim(),
      reason: String(input.reason || '').trim(),
      payer: input.payer || { type: 'self', reference: '' },
      transfers: [], legacyBilledThrough: null,
      discharge: null, createdBy: actor(), createdAt: new Date().toISOString()
    };
    rows.push(a);
    save(rows);
    if (enc && window.HIS.encounters) HIS.encounters.attachAdmission(enc.id, a.id);

    // The registry carries the patient's current location; keep it true so Registration agrees.
    if (window.HIS.registry) {
      HIS.registry.update(p.id, {
        type: 'Inpatient', status: 'Admitted', dept: bed.dept, doctor: a.attending || p.doctor,
        ward: bed.ward, bed: bed.label, admittedAt: at
      });
    }
    audit('Patient admitted \u2014 ' + a.id + ' \u00b7 ' + p.name + ' (' + p.id + ') to ' + bed.ward + ' bed ' + bed.label, 'admission:' + a.id, null, 'active');
    return { ok: true, admission: a };
  }

  // ---- transfers -------------------------------------------------------------------------------
  // Which bed the patient was in at an instant.
  //
  // The fallback for "before any transfer" must be the bed they were ADMITTED to, not the bed they
  // are in now: `admission.bedId` is overwritten by every transfer, so using it as the base made a
  // later re-accrual price the earlier days at the destination rate. The admitting bed is
  // `transfers[0].from` once a transfer exists.
  function bedAt(admission, when) {
    if (!admission) return null;
    var t = new Date(when).getTime();
    var tr = admission.transfers || [];
    var base = tr.length
      ? tr[0].from
      : { bedId: admission.bedId, bedLabel: admission.bedLabel, bedType: admission.bedType, ward: admission.ward };
    var seg = { bedId: base.bedId, bedLabel: base.bedLabel, bedType: base.bedType, ward: base.ward };
    tr.forEach(function (x) {
      if (new Date(x.at).getTime() <= t) {
        seg = { bedId: x.to.bedId, bedLabel: x.to.bedLabel, bedType: x.to.bedType, ward: x.to.ward };
      }
    });
    return seg;
  }

  function transfer(admissionId, input) {
    input = input || {};
    var rows = read();
    var a = rows.filter(function (x) { return x.id === admissionId; })[0];
    if (!a) return { ok: false, error: 'Admission not found.' };
    if (a.status !== 'active') return { ok: false, error: 'Only an active admission can be transferred.' };
    if (!input.bedId) return { ok: false, error: 'Choose the destination bed.' };
    if (input.bedId === a.bedId) return { ok: false, error: 'The patient is already in that bed.' };
    if (!String(input.reason || '').trim()) return { ok: false, error: 'A transfer needs a reason.' };
    var to = bedById(input.bedId);
    if (!to) return { ok: false, error: 'Bed not found.' };
    var occ = occupantOf(to.id);
    if (occ) return { ok: false, error: 'Bed ' + to.label + ' is occupied by ' + occ.patientId + '.' };
    if (bedStatus(to.id) !== 'available') return { ok: false, error: 'Bed ' + to.label + ' is ' + bedStatus(to.id) + '.' };

    var at = input.at || new Date().toISOString();
    if (!isFinite(Date.parse(at)) || Date.parse(at) < Date.parse(a.admittedAt)) return { ok: false, error: 'Enter a valid transfer date on or after admission.' };
    a.transfers = (a.transfers || []).concat([{
      at: at,
      from: { bedId: a.bedId, bedLabel: a.bedLabel, bedType: a.bedType, ward: a.ward },
      to: { bedId: to.id, bedLabel: to.label, bedType: to.type, ward: to.ward },
      by: actor(), reason: String(input.reason).trim(), note: String(input.note || '').trim()
    }]);
    a.bedId = to.id; a.bedLabel = to.label; a.bedType = to.type; a.ward = to.ward; a.dept = to.dept;
    if (input.attending) a.attending = String(input.attending).trim();
    save(rows);

    if (window.HIS.registry) HIS.registry.update(a.patientId, { ward: to.ward, bed: to.label, dept: to.dept, doctor: a.attending });
    audit('Patient transferred \u2014 ' + a.id + ' ' + a.patientId + ' ' + a.transfers[a.transfers.length - 1].from.bedLabel +
      ' \u2192 ' + to.label + ' \u00b7 ' + String(input.reason).trim(), 'admission:' + a.id, a.transfers[a.transfers.length - 1].from.bedLabel, to.label);
    return { ok: true, admission: a };
  }

  // ---- daily accrual ---------------------------------------------------------------------------
  // 12:00 Asia/Manila on a YYYY-MM-DD date.
  function cutoffOf(dateStr) { return new Date(dateStr + 'T12:00:00+08:00'); }
  // ---- the clock -------------------------------------------------------------------------------
  // The demo declares its own "today" (`HIS.today`, 31 August 2026) and every screen shows that date.
  // Using the wall clock here would date a new admission three months after the ward round that
  // produced it, and would report a seeded two-night stay as seventy-eight nights. One calendar, one
  // answer: the demo clock, pinned to 14:00 so it sits after the morning's seeded activity and after
  // the noon billing cutoff.
  function clock() {
    if (!(window.HIS && HIS.today)) return new Date();
    var d = new Date(HIS.today);
    d.setHours(14, 0, 0, 0);
    return d;
  }

  function dateKey(d) {
    // Manila-local calendar date for an instant. Unreadable input (a legacy or damaged record) is
    // reported as no date rather than thrown: one bad row must not blank the page around it.
    var t = new Date(d).getTime();
    if (!isFinite(t)) return '';
    var x = new Date(t + 8 * 3600 * 1000);
    return x.toISOString().slice(0, 10);
  }

  // Calendar days from admission to discharge (or to the demo's today). This is the length of stay,
  // not the number of days that were charged — a legacy admission's nights are already inside its
  // invoice's opening amount and are deliberately not re-posted.
  function stayDays(a) {
    if (!a || !a.admittedAt) return 0;
    var start = dateKey(a.admittedAt);
    var end = a.discharge && a.discharge.at ? dateKey(a.discharge.at) : dateKey(clock());
    var n = 0, d = start, guard = 0;
    while (d < end && guard < 400) { n++; d = addDays(d, 1); guard++; }
    return n + 1; // inclusive of both the arrival and the last day on the ward
  }

  // Room-and-board lines actually posted for this admission.
  function postedRoomCharges(a) {
    if (!a || !window.HIS.charges) return 0;
    return HIS.charges.forEncounter(a.encounterId).filter(function (c) {
      return c.source === 'room' && c.status !== 'void';
    }).length;
  }
  function addDays(dateStr, n) {
    var d = new Date(dateStr + 'T00:00:00+08:00');
    d.setDate(d.getDate() + n);
    return dateKey(d);
  }

  // The dates this admission is billable for, given what has happened by `asOf`.
  //
  // The admission day is ALWAYS billable — a patient who arrives at four in the afternoon still
  // occupies the bed that night, and a first-day charge is the convention this demo states. Every
  // later day follows the noon cutoff: billable if the patient was still in the bed at 12:00, and
  // the discharge day counts only when the patient left after noon.
  function billableDates(admission, asOf) {
    if (!admission || !admission.admittedAt) return [];
    var now = asOf ? new Date(asOf) : clock();
    var start = dateKey(admission.admittedAt);
    var end = admission.discharge && admission.discharge.at ? dateKey(admission.discharge.at) : dateKey(now);
    var out = [];
    var guard = 0;
    for (var d = start; d <= end && guard < 400; d = addDays(d, 1), guard++) {
      if (admission.legacyBilledThrough && d <= admission.legacyBilledThrough) continue;
      if (d === start) { out.push(d); continue; }
      var c = cutoffOf(d);
      if (admission.discharge && admission.discharge.at && new Date(admission.discharge.at).getTime() <= c.getTime()) continue; // left before noon
      if (!admission.discharge && c.getTime() > now.getTime()) continue;              // cutoff not reached yet
      out.push(d);
    }
    return out;
  }

  // The instant whose bed sets that day's rate: noon, except on an admission day that started after
  // noon, where the admitting bed is the one the patient actually occupied.
  function rateInstant(admission, dateStr) {
    var c = cutoffOf(dateStr);
    var admAt = new Date(admission.admittedAt);
    if (dateKey(admission.admittedAt) === dateStr && admAt.getTime() > c.getTime()) return admAt;
    return c;
  }

  function dailyKey(prefix, dateStr) { return prefix + ':' + dateStr; }

  // Post the configured daily charges for every billable day that has none. Idempotent: the charge
  // key is (source, admissionId, code-with-date), so re-running posts nothing twice.
  function accrue(admissionId, opts) {
    opts = opts || {};
    var a = byId(admissionId);
    if (!a) return { ok: false, error: 'Admission not found.' };
    if (!window.HIS.charges || !window.HIS.tariffs) return { ok: false, error: 'Charge engine unavailable.' };

    var dates = billableDates(a, opts.asOf);
    var posted = [], skipped = [], missing = [];

    dates.forEach(function (d) {
      var c = rateInstant(a, d);
      var seg = bedAt(a, c);
      var roomCode = HIS.tariffs.roomCode(seg.bedType);
      if (!roomCode) { missing.push({ date: d, why: 'No room tariff for bed type ' + seg.bedType }); return; }
      var q = HIS.tariffs.quote(roomCode, c);
      if (!q.ok) { missing.push({ date: d, why: q.error }); return; }

      var room = HIS.charges.add({
        patientId: a.patientId, encounterId: a.encounterId,
        source: 'room', sourceId: a.id, code: dailyKey('R&B', d),
        description: 'Room and board \u00b7 ' + seg.bedType + ' ' + seg.bedLabel + ' \u00b7 ' + d,
        qty: 1, unitPrice: q.price, tariffCode: roomCode, tariffEffectiveFrom: q.effectiveFrom
      });
      if (!room.ok) { missing.push({ date: d, why: room.error }); return; }
      if (room.duplicate) skipped.push({ date: d, code: roomCode });
      else posted.push(room.charge);

      if (opts.nursing !== false) {
        var nq = HIS.tariffs.quote('NURSE-DAY', c);
        if (nq.ok) {
          var nur = HIS.charges.add({
            patientId: a.patientId, encounterId: a.encounterId,
            source: 'nursing', sourceId: a.id, code: dailyKey('NURSE', d),
            description: 'Nursing care \u00b7 inpatient day \u00b7 ' + d,
            qty: 1, unitPrice: nq.price, tariffCode: 'NURSE-DAY', tariffEffectiveFrom: nq.effectiveFrom
          });
          if (nur.ok && !nur.duplicate) posted.push(nur.charge);
          else if (nur.ok) skipped.push({ date: d, code: 'NURSE-DAY' });
        }
      }
    });

    if (posted.length) {
      audit('Daily charges posted \u2014 ' + a.id + ' \u00b7 ' + posted.length + ' line(s) \u00b7 ' +
        peso(posted.reduce(function (t, c) { return t + c.amount; }, 0)), 'admission:' + a.id, '\u2014', String(posted.length));
    }
    return {
      ok: true, posted: posted, skipped: skipped, missing: missing,
      dates: dates,
      total: Math.round(posted.reduce(function (t, c) { return t + c.amount; }, 0) * 100) / 100
    };
  }

  // ---- discharge -------------------------------------------------------------------------------
  function discharge(admissionId, input) {
    input = input || {};
    var rows = read();
    var a = rows.filter(function (x) { return x.id === admissionId; })[0];
    if (!a) return { ok: false, error: 'Admission not found.' };
    if (a.status !== 'active') return { ok: false, error: 'That admission is already ' + a.status + '.' };
    if (!String(input.disposition || '').trim()) return { ok: false, error: 'Record a discharge disposition.' };
    if (DISPOSITIONS.indexOf(input.disposition) < 0) return { ok: false, error: 'Choose a valid discharge disposition.' };
    if (!String(input.summary || '').trim()) return { ok: false, error: 'A discharge needs a summary.' };

    var at = input.at || clock().toISOString();
    if (!isFinite(Date.parse(at))) return { ok: false, error: 'Enter a valid discharge date.' };
    if (new Date(at).getTime() < new Date(a.admittedAt).getTime()) {
      return { ok: false, error: 'The discharge time cannot be before the admission time.' };
    }

    // Close the money side first, so the final statement cannot be short by one day.
    a.discharge = { at: at, by: actor(), disposition: String(input.disposition).trim(), summary: String(input.summary).trim(), note: String(input.note || '').trim() };
    a.status = 'discharged';
    save(rows);

    var fin = accrue(admissionId, { asOf: at });

    // Release the bed: occupancy is derived, so marking the admission discharged is the release.
    // The bed goes to cleaning so it cannot be reassigned while it is still dirty.
    var s = bedState();
    s[a.bedId] = { status: 'cleaning', since: at, note: 'Terminal clean after ' + a.id };
    saveBedState(s);

    if (window.HIS.registry) {
      HIS.registry.update(a.patientId, { status: 'Discharged', ward: null, bed: null, admittedAt: null });
    }
    if (window.HIS.encounters && a.encounterId) {
      HIS.encounters.complete(a.encounterId, { disposition: String(input.disposition).trim() });
    }

    var enc = a.encounterId && window.HIS.charges ? HIS.charges.forEncounter(a.encounterId) : [];
    var unbilled = enc.filter(function (c) { return c.status !== 'void' && !c.invoiceId; });
    var bill = a.encounterId && window.HIS.encounters ? HIS.encounters.byId(a.encounterId) : null;
    var invoice = bill && bill.invoiceId && window.HIS.ledger ? HIS.billing.bills.filter(function (b) { return b.id === bill.invoiceId; })[0] : null;

    audit('Patient discharged \u2014 ' + a.id + ' \u00b7 ' + a.patientId + ' \u00b7 ' + a.discharge.disposition +
      ' \u00b7 bed ' + a.bedLabel + ' released', 'admission:' + a.id, 'active', 'discharged');

    return {
      ok: true, admission: a,
      accrual: fin,
      unbilledCount: unbilled.length,
      unbilledTotal: Math.round(unbilled.reduce(function (t, c) { return t + c.amount; }, 0) * 100) / 100,
      invoiceId: invoice ? invoice.id : null,
      balance: invoice ? HIS.ledger.balanceOf(invoice) : 0
    };
  }

  // Reverse a discharge that was recorded in error. The bed is re-occupied only if it is still free;
  // the original discharge stays in the record.
  function cancelDischarge(admissionId, reason) {
    var rows = read();
    var a = rows.filter(function (x) { return x.id === admissionId; })[0];
    if (!a) return { ok: false, error: 'Admission not found.' };
    if (a.status !== 'discharged') return { ok: false, error: 'Only a discharged admission can be reopened.' };
    if (!String(reason || '').trim()) return { ok: false, error: 'Reopening a discharge needs a reason.' };
    if (bedStatus(a.bedId) === 'occupied') {
      return { ok: false, error: 'Bed ' + a.bedLabel + ' has since been given to another patient.' };
    }
    a.dischargeHistory = (a.dischargeHistory || []).concat([Object.assign({}, a.discharge, { reversedAt: new Date().toISOString(), reversedBy: actor(), reverseReason: String(reason).trim() })]);
    a.discharge = null;
    a.status = 'active';
    save(rows);
    var s = bedState();
    delete s[a.bedId];
    saveBedState(s);
    if (window.HIS.registry) HIS.registry.update(a.patientId, { status: 'Admitted', ward: a.ward, bed: a.bedLabel, admittedAt: a.admittedAt });
    audit('Discharge reversed \u2014 ' + a.id + ' \u00b7 ' + String(reason).trim(), 'admission:' + a.id, 'discharged', 'active');
    return { ok: true, admission: a };
  }

  function stats() {
    var rows = all(), occ = occupancy();
    return {
      active: rows.filter(function (a) { return a.status === 'active'; }).length,
      discharged: rows.filter(function (a) { return a.status === 'discharged'; }).length,
      total: rows.length,
      beds: occ.total, occupied: occ.occupied, available: occ.available,
      outOfService: occ.outOfService, rate: occ.rate,
      todayAdmissions: rows.filter(function (a) { return dateKey(a.admittedAt) === dateKey(clock()); }).length
    };
  }

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
  function audit(what, entity, before, after) {
    if (!window.HIS.audit) return;
    HIS.audit.append({ who: actor(), role: roleLabel(), what: what, entity: entity, before: before, after: after });
  }

  HIS.admissions = {
    AKEY: AKEY, SKEY: SKEY, WARDS: WARDS, DISPOSITIONS: DISPOSITIONS,
    all: all, byId: byId, active: active, forPatient: forPatient, activeForPatient: activeForPatient,
    beds: beds, bedById: bedById, bedsFor: bedsFor, wards: wards, bedView: bedView, bedBoard: bedBoard,
    bedStatus: bedStatus, occupantOf: occupantOf, occupancy: occupancy, firstFreeBed: firstFreeBed,
    setBedState: setBedState,
    admit: admit, transfer: transfer, accrue: accrue, discharge: discharge, cancelDischarge: cancelDischarge,
    billableDates: billableDates, bedAt: bedAt, stayDays: stayDays, postedRoomCharges: postedRoomCharges,
    clock: clock, stats: stats
  };
})();
