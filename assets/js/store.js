// Shared state layer (session 23, Phase 0 of docs/IMPROVEMENT-PLAN.md). One place for every
// `mh_*` localStorage key: a safe typed read with a fallback, a write that never throws, a tiny
// pub/sub, a whole-store snapshot and a reset. Key names and value shapes are UNCHANGED, so data
// saved by earlier sessions keeps working (backward compatible).
// `mh_regs_extra` and `mh_appts_extra` belong to the OWNER: reset() leaves them alone unless
// called with { includeOwner: true }.
(function () {
  var KEYS = {
    registrations: 'mh_regs_extra',   // owner
    appointments: 'mh_appts_extra',   // owner
    profileEdits: 'mh_profile_edits',
    treatment: 'mh_treatment_state',
    nursing: 'mh_nursing_state',
    consultation: 'mh_consult_state',
    notifRead: 'mh_notif_read',
    attendance: 'mh_attendance_state',
    audit: 'mh_audit',
    // M3: the active role is no longer stored — it is resolved from the signed-in account record
    // in `mh_accounts` (see assets/js/auth.js). `mh_role` from M1 is intentionally not read any more.
    accounts: 'mh_accounts',
    // M5: the portal's private account store, reset code and session are GONE. The portal signs in
    // through HIS.auth against `mh_accounts` like every other screen, and resolves the patient
    // through `account.patientId`. The old keys are deleted on first portal load (see portal.js).
    patients: 'mh_patients',
    guardians: 'mh_guardians',
    transactions: 'mh_tx',
    profileRequests: 'mh_profile_requests',
    // M10: the pay-period attendance register (one record per employee per day), the payroll runs
    // (with version history), the claim lifecycle and the 13th-month register.
    attendancePeriod: 'mh_attendance_period',
    payrollRuns: 'mh_payroll_runs',
    payrollCorrections: 'mh_payroll_corrections',
    claims: 'mh_claims',
    thirteenth: 'mh_thirteenth',
    // M12: the invoice table became writable (an invoice can now be opened for an episode), the
    // charge master, the encounter episodes, and the admission/bed records.
    invoices: 'mh_invoices',
    tariffs: 'mh_tariffs',
    encounters: 'mh_encounters',
    charges: 'mh_charges',
    admissions: 'mh_admissions',
    bedState: 'mh_bed_state'
  };
  var VERSION = 1;
  var subs = {};

  // Missing key, unparseable JSON or a stored `null` all return the fallback.
  function get(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); emit(key, value); return true; }
    catch (e) { return false; } // storage blocked: the caller keeps the change in memory
  }
  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* nothing to do */ }
    emit(key, undefined);
  }
  // Read-modify-write in one call: update('mh_x', [], rows => { rows.push(r); return rows; })
  function update(key, fallback, fn) { var v = fn(get(key, fallback)); set(key, v); return v; }
  function on(key, fn) { (subs[key] = subs[key] || []).push(fn); }
  function emit(key, value) { (subs[key] || []).forEach(function (fn) { fn(value); }); }
  function names() { return KEYS; }
  function list() { return Object.keys(KEYS).map(function (k) { return KEYS[k]; }); }
  function snapshot() {
    var out = {};
    Object.keys(KEYS).forEach(function (k) {
      var v = get(KEYS[k], undefined);
      if (v !== undefined) out[KEYS[k]] = v;
    });
    return out;
  }
  function reset(opts) {
    var owner = opts && opts.includeOwner;
    Object.keys(KEYS).forEach(function (k) {
      if (!owner && (k === 'registrations' || k === 'appointments')) return;
      remove(KEYS[k]);
    });
  }

  HIS.store = {
    version: VERSION, KEY: KEYS,
    get: get, set: set, remove: remove, update: update, on: on,
    names: names, list: list, snapshot: snapshot, reset: reset
  };
})();