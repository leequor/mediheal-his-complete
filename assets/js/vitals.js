// Vital signs are clinical observations, so they are recorded, never inferred. Before this module the
// consultation screen and the nursing sheet both derived BP / HR / temperature / SpO2 from the patient
// ID, which meant a patient registered one minute ago already had a blood pressure. A patient with no
// observation now shows "Not recorded" everywhere, and only a reading saved by a nurse fills it in.
//
//   HIS.vitals.record(patientId, { bp, hr, temp, spo2, weight, note })   -> { ok, reading }
//   HIS.vitals.latest(patientId)                                        -> reading | null
//   HIS.vitals.list(patientId)                                          -> newest first
//   HIS.vitals.all()                                                    -> every reading
//
// Demo patients keep the readings the Figma frames show, because those frames were drawn with them.
// They are seeded once, marked `seeded: true`, and never generated for anyone else.
(function () {
  var KEY = 'mh_vitals';

  // Seeded observations for the records that were drawn in Figma. Explicit numbers on purpose: an
  // arithmetic rule over the patient id is exactly the fabrication this module exists to stop.
  var SEED = [
    { patientId: 'PT-99213', bp: '128/82', hr: '88', temp: '36.8', spo2: '97', weight: '64', at: '2026-08-31T06:00:00+08:00', by: 'Andrea Santos, RN' },
    { patientId: 'PT-99213', bp: '126/80', hr: '86', temp: '36.7', spo2: '98', weight: '64', at: '2026-08-31T10:00:00+08:00', by: 'Andrea Santos, RN' },
    { patientId: 'PT-99208', bp: '118/74', hr: '80', temp: '36.6', spo2: '98', weight: '58', at: '2026-08-31T06:05:00+08:00', by: 'Andrea Santos, RN' },
    { patientId: 'PT-99215', bp: '132/86', hr: '92', temp: '37.9', spo2: '96', weight: '71', at: '2026-08-31T07:40:00+08:00', by: 'Rina Delos Reyes, RN' },
    { patientId: 'PT-99210', bp: '140/90', hr: '96', temp: '36.9', spo2: '95', weight: '83', at: '2026-08-31T08:20:00+08:00', by: 'Rina Delos Reyes, RN' }
  ];

  function all() {
    var rows = HIS.store.get(KEY, null);
    if (!Array.isArray(rows)) {
      rows = SEED.map(function (r) { var c = {}; Object.keys(r).forEach(function (k) { c[k] = r[k]; }); c.seeded = true; return c; });
      HIS.store.set(KEY, rows);
    }
    return rows.filter(function (r) { return r && r.patientId; });
  }

  function list(patientId) {
    return all().filter(function (r) { return r.patientId === patientId; })
      .slice().sort(function (a, b) { return String(b.at || '').localeCompare(String(a.at || '')); });
  }

  function latest(patientId) { return list(patientId)[0] || null; }

  // Accepts "128/82" or "128 / 82" or 128/82 as a number pair. Anything unreadable is refused rather
  // than stored as a half reading.
  function parseBp(bp) {
    if (bp === null || bp === undefined || bp === '') return null;
    var m = String(bp).match(/^\s*(\d{2,3})\s*[\/\u2044]\s*(\d{2,3})\s*$/);
    if (!m) return null;
    var sys = Number(m[1]), dia = Number(m[2]);
    if (!(sys >= 50 && sys <= 300 && dia >= 20 && dia <= 200 && sys > dia)) return null;
    return sys + '/' + dia;
  }

  function num(v, min, max) {
    if (v === null || v === undefined || String(v).trim() === '') return null;
    var clean = String(v).trim().replace(/\s*(bpm|°?C|%|kg)\s*$/i, '').trim();
    if (!/^\d+(\.\d+)?$/.test(clean)) return null;
    var n = Number(clean);
    if (!isFinite(n)) return null;
    return (n >= min && n <= max) ? String(n) : null;
  }

  function record(patientId, input) {
    var v = input || {};
    if (!HIS.registry || !HIS.registry.byId(patientId)) return { ok: false, error: 'A vital sign needs a registered patient.' };
    if (!HIS.rbac.can('nursing')) return { ok: false, error: 'Only nursing staff can record observations.' };
    var bp = parseBp(String(v.bp || '').replace(/\s*mmHg\s*$/i, ''));
    var hr = num(v.hr, 20, 260);
    var temp = num(v.temp, 30, 45);
    var spo2 = num(v.spo2, 50, 100);
    var weight = num(v.weight, 1, 500);
    var invalid = [['bp', bp, 'blood pressure'], ['hr', hr, 'heart rate (20–260)'], ['temp', temp, 'temperature (30–45 °C)'], ['spo2', spo2, 'SpO2 (50–100%)'], ['weight', weight, 'weight (1–500 kg)']].filter(function (x) { return v[x[0]] != null && String(v[x[0]]).trim() && !x[1]; });
    if (invalid.length) return { ok: false, error: 'Check ' + invalid.map(function (x) { return x[2]; }).join(', ') + '.' };
    if (!bp && !hr && !temp && !spo2 && !weight) {
      return { ok: false, error: 'Enter at least one reading (blood pressure looks like 120/80).' };
    }
    var reading = {
      patientId: patientId, bp: bp, hr: hr, temp: temp, spo2: spo2, weight: weight,
      note: String(v.note || '').trim().slice(0, 200),
      at: v.at || new Date().toISOString(),
      by: (HIS.auth && HIS.auth.account() || {}).name || 'Staff'
    };
    var rows = all();
    rows.push(reading);
    if (!HIS.store.set(KEY, rows)) return { ok: false, error: 'The observation could not be saved. Please retry.' };
    if (window.HIS.audit) {
      try {
        HIS.audit.append({
          who: reading.by, role: 'Nurse', what: 'Vital signs recorded for ' + patientId,
          entity: 'patient:' + patientId, before: null,
          after: [bp && 'BP ' + bp, hr && 'HR ' + hr, temp && temp + ' C', spo2 && 'SpO2 ' + spo2].filter(Boolean).join(', ')
        });
      } catch (e) { /* audit is optional */ }
    }
    return { ok: true, reading: reading };
  }

  function summary(patientId) {
    var r = latest(patientId);
    if (!r) return null;
    var parts = [];
    if (r.bp) parts.push('BP ' + r.bp + ' mmHg');
    if (r.hr) parts.push('HR ' + r.hr + ' bpm');
    if (r.temp) parts.push(r.temp + ' \u00b0C');
    if (r.spo2) parts.push('SpO\u2082 ' + r.spo2 + '%');
    if (r.weight) parts.push(r.weight + ' kg');
    return { reading: r, text: parts.join(' \u00b7 ') };
  }

  function notes(patientId) { return HIS.store.get('mh_nursing_notes', []).filter(function (n) { return n.patientId === patientId; }); }
  function note(patientId, input) {
    input = input || {};
    if (!HIS.rbac.can('nursing')) return { ok: false, error: 'Only nursing staff can record a nursing note.' };
    if (!HIS.registry.byId(patientId)) return { ok: false, error: 'Patient not found.' };
    if (!String(input.body || '').trim()) return { ok: false, error: 'Write the progress note before saving.' };
    var actor = (HIS.auth.account() || {}).name || 'Staff';
    var rows = HIS.store.get('mh_nursing_notes', []);
    var row = Object.assign({}, input, { patientId: patientId, by: actor, at: new Date().toISOString() });
    rows.push(row);
    if (!HIS.store.set('mh_nursing_notes', rows)) return { ok: false, error: 'The note could not be saved. Please retry.' };
    HIS.audit.append({ who: actor, role: HIS.rbac.current().label, what: 'Nursing progress note recorded', entity: 'patient:' + patientId, after: row.body });
    return { ok: true, note: row };
  }
  function administer(patientId, input, medications) {
    input = input || {}; medications = medications || [];
    if (!HIS.rbac.can('nursing') || !HIS.registry.byId(patientId)) return { ok: false, error: 'A nursing account and registered patient are required.' };
    var drug = String(input.drug || '').trim().toLowerCase();
    var index = medications.findIndex(function (m) { return /^due/i.test(m[1]) && m[0].split(' · ')[0].toLowerCase() === drug.replace(/\s+tablets?$/i, ''); });
    if (index < 0) return { ok: false, error: 'Choose a medicine and dose currently due on this patient’s medication record.' };
    var ordered = medications[index][0], strength = ordered.match(/\d+(?:\.\d+)?\s*(?:mg|mcg|g|mL)\b/i), entered = String(input.dose || '').match(/\d+(?:\.\d+)?\s*(?:mg|mcg|g|mL)\b/i);
    if (strength && (!entered || strength[0].replace(/\s/g, '').toLowerCase() !== entered[0].replace(/\s/g, '').toLowerCase())) return { ok: false, error: 'The recorded dose must match the ordered strength.' };
    var scheduled = ordered.split(' · ')[1];
    if (scheduled && scheduled !== String(input.scheduled || '').trim()) return { ok: false, error: 'Select the time due on the medication record.' };
    var rows = HIS.store.get('mh_med_administrations', []);
    var key = patientId + '|' + medications[index][0] + '|' + HIS.fmtShort(HIS.today);
    if (rows.some(function (r) { return r.key === key; })) return { ok: false, error: 'This scheduled dose has already been recorded.' };
    var row = Object.assign({}, input, { key: key, patientId: patientId, by: (HIS.auth.account() || {}).name || 'Staff', at: new Date().toISOString() });
    rows.push(row);
    if (!HIS.store.set('mh_med_administrations', rows)) return { ok: false, error: 'The dose could not be saved. Please retry.' };
    HIS.audit.append({ who: row.by, role: HIS.rbac.current().label, what: 'Medication administered', entity: 'patient:' + patientId, after: row.drug + ' · ' + row.dose });
    return { ok: true, administration: row, index: index };
  }
  HIS.nursingRecords = { notes: notes, note: note, administer: administer };
  HIS.vitals = { KEY: KEY, all: all, list: list, latest: latest, record: record, summary: summary, parseBp: parseBp, seed: SEED };
})();
