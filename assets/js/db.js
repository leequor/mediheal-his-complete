// Supabase adapter (assets/js/db.js).
//
// The site is a static demonstration with no build step, and every module already reads and writes
// through ONE boundary: `HIS.store` (assets/js/store.js). This file uses that boundary instead of
// touching 60 modules. It wraps `HIS.store.set`, mirrors each write to Postgres, and hydrates the
// local stores from Postgres once per tab at sign-in.
//
// Three rules it must never break:
//
//  1. The demonstration still works with no network, no config and no account. Every function here
//     degrades to a no-op, so `window.MEDIHEAL_SUPABASE` empty (the committed default) means the app
//     behaves exactly as before.
//  2. Nothing secret is stored: only the anon/publishable key is used, and identity comes from
//     Supabase anonymous sign-in, so RLS in 0001_init.sql is what protects the rows.
//  3. Row-level data goes to typed tables, documents to `module_state`, history to append-only
//     `audit_log`. Account credentials never leave the browser.
//
// Status is observable through HIS.db.status() for the Settings screen or a smoke test.
(function () {
  var CFG = window.MEDIHEAL_SUPABASE || {};
  var url = String(CFG.url || '').trim();
  var key = String(CFG.key || '').trim();
  var configured = !!(url && key && /^https?:\/\//.test(url));
  var client = null;
  var uid = null;
  var ready = false;
  var busy = false;
  var error = null;
  var pending = {};              // key -> true, work waiting for a connection
  var pushed = {};               // key -> { id: JSON string } of what the server already has
  var timers = {};
  var rawSet = null;             // the unwrapped HIS.store.set, used for hydration

  // ---- what maps where ---------------------------------------------------------------------
  // Arrays of records go to their own table. `cols` copies the few fields a report or an index
  // needs; `data` always carries the whole record, so nothing is lost if a column is not listed.
  var ROW_KEYS = {
    mh_patients: { table: 'patients', cols: function (r) { return { id: r.id, name: r.name, last_name: r.last || null, dob: isoOrNull(r.dob), mobile: r.mobile || null, type: r.type || null, dept: r.dept || null, status: r.status || null, attention: !!r.attention }; } },
    mh_regs_extra: { table: 'registrations', cols: function (r) { var d = r.details || {}; return { id: r.id, name: r.name, dob: d.dob || r.dob || null, mobile: d.phone || r.mobile || null, type: r.type || null, status: r.status || null }; } },
    mh_appts_extra: { table: 'appointments', cols: function (r) { return { id: r.id, patient_id: r.pt || r.patientId || null, doctor: r.doctor || null, dept: r.dept || null, status: r.status || null }; } },
    mh_encounters: { table: 'encounters', cols: function (r) { return { id: r.id, patient_id: r.patientId || r.pt || null, kind: r.kind || r.type || null, status: r.status || null, opened_at: isoOrNull(r.openedAt), closed_at: isoOrNull(r.closedAt) }; } },
    mh_charges: { table: 'charges', cols: function (r) { return { id: r.id, encounter_id: r.encounterId || null, patient_id: r.patientId || null, invoice_id: r.invoiceId || null, code: r.code || null, description: r.description || null, amount: pesos(r.amount), status: r.status || null, posted_at: isoOrNull(r.postedAt || r.at) }; } },
    mh_invoices: { table: 'invoices', cols: function (r) { return { id: r.id, patient_id: r.pt || r.patientId || null, status: r.status || null, amount: pesos(r.amount) }; } },
    // Ledger amounts are centavos in the app (HIS.ledger.toCentavos); the column is pesos.
    mh_tx: { table: 'ledger_transactions', cols: function (r) { return { id: r.id, invoice_id: r.invoiceId || null, patient_id: r.patientId || null, kind: r.kind || null, method: r.method || null, reference: r.reference || null, amount: pesos(r.amount, true), status: r.status || null, posted_at: isoOrNull(r.at), idempotency_key: r.idempotencyKey || null }; } },
    mh_admissions: { table: 'admissions', cols: function (r) { return { id: r.id, patient_id: r.patientId || r.pt || null, ward: r.ward || null, bed: r.bed || null, status: r.status || null, admitted_at: isoOrNull(r.admittedAt), discharged_at: isoOrNull(r.dischargedAt) }; } },
    mh_lab: { table: 'lab_orders', cols: function (r) { return { id: r.id, patient_id: r.patientId || r.pt || null, panel: r.panel || r.test || null, status: r.status || null, released_at: isoOrNull(r.releasedAt) }; } },
    mh_rx: { table: 'prescriptions', cols: function (r) { return { id: r.id, patient_id: r.patientId || r.pt || null, status: r.status || null }; } },
    mh_stock: { table: 'stock_batches', cols: function (r) { return { id: r.id, drug: r.drug || r.name || null, batch: r.batch || null, expires_on: isoOrNull(r.expiry || r.expires), qty: qty(r.qty) }; } },
    mh_personnel: { table: 'personnel', cols: function (r) { return { id: r.id, name: r.name || null, role: r.role || null, dept: r.dept || null, status: r.status || null }; } },
    mh_guardians: { table: 'guardians', cols: function (r) { return { id: r.id, patient_id: r.patientId || null }; } }
  };

  // Documents: the owning module insists on its own shape, so the whole value is stored verbatim.
  var DOC_KEYS = ['mh_claims', 'mh_tariffs', 'mh_bed_state', 'mh_attendance_period', 'mh_attendance_state',
    'mh_payroll_runs', 'mh_payroll_corrections', 'mh_thirteenth', 'mh_treatment_state', 'mh_nursing_state',
    'mh_consult_state', 'mh_notif_read', 'mh_profile_edits', 'mh_profile_requests', 'mh_patient_requests'];

  // Never leaves the browser: account passwords are demo strings and have no business in a database.
  var LOCAL_ONLY = ['mh_accounts', 'mh_session', 'mh_session_tab'];

  function isoOrNull(v) { if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  function pesos(n, centavos) { var v = Number(n); if (!isFinite(v)) return null; return centavos ? Math.round(v) / 100 : v; }
  function qty(n) { var v = Number(n); return isFinite(v) ? Math.round(v) : null; }

  function status() {
    return { configured: configured, ready: ready, uid: uid, mode: client ? (ready ? 'connected' : 'connecting') : 'local', pending: Object.keys(pending).length, error: error };
  }

  // ---- mirroring ---------------------------------------------------------------------------
  function store() { return window.HIS && HIS.store; }

  function schedule(k) {
    pending[k] = true;
    clearTimeout(timers[k]);
    timers[k] = setTimeout(function () { flush(k); }, 500);
  }

  function flush(k) {
    if (!client || !uid) return Promise.resolve(false);
    var keys = k ? [k] : Object.keys(pending);
    if (!keys.length) return Promise.resolve(true);
    var jobs = keys.map(function (name) { return pushKey(name); });
    return Promise.all(jobs).then(function () { ready = true; return true; }).catch(function (e) { error = e && e.message || String(e); return false; });
  }

  function pushKey(name) {
    if (LOCAL_ONLY.indexOf(name) > -1) { delete pending[name]; return Promise.resolve(); }
    var s = store();
    var value = s.get(name, undefined);
    if (value === undefined) { delete pending[name]; return Promise.resolve(); }

    if (name === 'mh_audit') return pushAudit(Array.isArray(value) ? value : []);

    var spec = ROW_KEYS[name];
    if (spec) return pushRows(name, spec, Array.isArray(value) ? value : []);

    if (DOC_KEYS.indexOf(name) > -1) {
      return client.from('module_state').upsert({ owner_id: uid, key: name, payload: value, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,key' })
        .then(function (r) { if (r.error) throw r.error; delete pending[name]; });
    }
    delete pending[name];
    return Promise.resolve();
  }

  function pushRows(name, spec, rows) {
    var seen = pushed[name] || (pushed[name] = {});
    var upserts = [], keep = {};
    rows.forEach(function (r) {
      if (!r || !r.id) return;
      var payload = Object.assign({ owner_id: uid }, spec.cols(r), { data: r });
      var sig = JSON.stringify(payload.data);
      keep[r.id] = sig;
      if (seen[r.id] === sig) return;
      upserts.push(payload);
      seen[r.id] = sig;
    });
    var gone = Object.keys(seen).filter(function (id) { return !keep[id]; });
    gone.forEach(function (id) { delete seen[id]; });

    var work = [];
    if (upserts.length) work.push(client.from(spec.table).upsert(upserts, { onConflict: 'owner_id,id' }).then(function (r) { if (r.error) throw r.error; }));
    if (gone.length) work.push(client.from(spec.table).delete().eq('owner_id', uid).in('id', gone).then(function (r) { if (r.error) throw r.error; }));
    return Promise.all(work).then(function () { delete pending[name]; });
  }

  // Audit rows are history: insert the ones the server does not have yet, never update them.
  function pushAudit(rows) {
    var seen = pushed.mh_audit || (pushed.mh_audit = {});
    var fresh = [];
    rows.forEach(function (r, i) {
      var ref = r.id || r.rowRef || (String(r.at || '') + '|' + String(r.what || '') + '|' + i);
      if (seen[ref]) return;
      seen[ref] = 1;
      fresh.push({ owner_id: uid, row_ref: ref, at: isoOrNull(r.at) || new Date().toISOString(), actor: r.who || r.actor || null, role: r.role || null, action: r.what || r.action || null, entity: r.entity || null, before: r.before == null ? null : String(r.before), after: r.after == null ? null : String(r.after), data: r });
    });
    if (!fresh.length) { delete pending.mh_audit; return Promise.resolve(); }
    return client.from('audit_log').insert(fresh).then(function (r) { if (r.error) throw r.error; delete pending.mh_audit; });
  }

  // ---- hydration ---------------------------------------------------------------------------
  // Once per tab, at sign-in: pull what the server has for this identity into the local stores,
  // using the raw setter so the pull is not immediately mirrored back.
  function hydrate(rawSet) {
    var s = store();
    var jobs = Object.keys(ROW_KEYS).map(function (name) {
      var spec = ROW_KEYS[name];
      return client.from(spec.table).select('data').eq('owner_id', uid).then(function (res) {
        if (res.error) throw res.error;
        var rows = (res.data || []).map(function (r) { return r.data; }).filter(Boolean);
        if (!rows.length) return;
        var seen = pushed[name] || (pushed[name] = {});
        rows.forEach(function (r) { if (r && r.id) seen[r.id] = JSON.stringify(r); });
        rawSet(name, rows);
      });
    });
    jobs.push(client.from('module_state').select('key,payload').eq('owner_id', uid).then(function (res) {
      if (res.error) throw res.error;
      (res.data || []).forEach(function (r) { if (r && r.key) rawSet(r.key, r.payload); });
    }));
    jobs.push(client.from('audit_log').select('data').eq('owner_id', uid).order('id', { ascending: true }).limit(500).then(function (res) {
      if (res.error) throw res.error;
      var rows = (res.data || []).map(function (r) { return r.data; }).filter(Boolean);
      if (!rows.length) return;
      rows.forEach(function (r, i) { pushed.mh_audit = pushed.mh_audit || {}; pushed.mh_audit[r.id || i] = 1; });
      rawSet('mh_audit', rows);
    }));
    return Promise.all(jobs);
  }

  // ---- bootstrap ---------------------------------------------------------------------------
  // Called at sign-in, and safe to call twice. Resolves to the status object, never rejects.
  function bootstrap() {
    if (!configured) return Promise.resolve(status());
    if (ready) return Promise.resolve(status());
    if (busy) return Promise.resolve(status());
    busy = true;

    if (!window.supabase || !window.supabase.createClient) {
      error = 'Supabase client script not loaded';
      busy = false;
      return Promise.resolve(status());
    }
    try { client = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }); }
    catch (e) { error = 'Client rejected the configuration'; busy = false; client = null; return Promise.resolve(status()); }

    var seq = client.auth.getSession ? client.auth.getSession() : Promise.resolve({ data: {} });
    return seq.then(function (res) {
      var session = res && res.data && res.data.session;
      if (session) return { data: { user: session.user } };
      return client.auth.signInAnonymously();
    }).then(function (res) {
      var user = res && res.data && res.data.user;
      if (!user) throw new Error(res && res.error && res.error.message || 'no anonymous session');
      uid = user.id;
      return hydrate(rawSet);
    }).then(function () {
      ready = true; busy = false;
      // Everything already in this tab existed before the server did: mirror it up once.
      Object.keys(store().KEY).forEach(function (k) { schedule(store().KEY[k]); });
      return status();
    }).catch(function (e) {
      error = e && e.message || String(e); ready = false; busy = false;
      return status();
    });
  }

  // ---- install -----------------------------------------------------------------------------
  var s = store();
  if (s) {
    rawSet = s.set;
    s.set = function (k, v) {
      var ok = rawSet.apply(s, arguments);
      if (ok && configured && LOCAL_ONLY.indexOf(k) < 0) {
        if (ready) schedule(k); else pending[k] = true;
      }
      return ok;
    };
  }

  window.HIS = window.HIS || {};
  window.HIS.db = {
    configured: configured,
    bootstrap: bootstrap,
    flush: function () { return flush(); },
    status: status,
    // Diagnostics only: the anon client holds no secret, and the check script needs to read back
    // what the browser just wrote. Never used by the application.
    client: function () { return client; }
  };

  if (window.addEventListener) {
    window.addEventListener('online', function () { if (ready) flush(); });
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && ready) flush(); });
  }
})();
