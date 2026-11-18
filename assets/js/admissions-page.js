// Admissions screen (M12). Uses the admin screen format established in M2 and reused by Claims in
// M10: KPI strip, card + toolbar + table, action modal from the .ac-* shell. No new geometry beyond
// the bed-board tiles, which are a grid of the same bordered white card.
//
// The screen only offers the one action a status allows, so it cannot present a step the store would
// refuse: an active admission can be charged, transferred or discharged; a discharged one can only be
// reopened if the bed is still free.
(function () {
  var stage = document.getElementById('stage');
  var esc = HIS.kit.esc;
  var q = '', statusFilter = 'active';
  // The board opens on one ward. All 172 beds at once is three screens of tiles and buries the
  // admission records underneath it; the ward selector is the control for looking wider.
  var wardFilter = (HIS.admissions.wards()[0] || {}).ward || 'all';

  function peso(n) {
    return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function when(iso) {
    if (!iso) return '\u2014';
    var d = new Date(iso);
    if (isNaN(d)) return '\u2014';
    return d.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function day(iso) {
    if (!iso) return '\u2014';
    var d = new Date(iso);
    if (isNaN(d)) return '\u2014';
    return d.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' });
  }
  function patientName(id) {
    var p = HIS.registry && HIS.registry.byId(id);
    return p ? p.name : id;
  }
  function nights(a) {
    return HIS.admissions.billableDates(a).length;
  }
  // Length of stay and how much of it has been charged. A legacy admission's nights sit inside its
  // invoice's opening amount, so it reports that instead of a misleading zero.
  function stayCell(a) {
    var days = HIS.admissions.stayDays(a);
    var posted = HIS.admissions.postedRoomCharges(a);
    var sub = a.legacyBilledThrough
      ? 'in opening bill'
      : posted + ' room charge' + (posted === 1 ? '' : 's') + ' posted';
    return "<span class='ad-who'><b>" + days + ' day' + (days === 1 ? '' : 's') + '</b><small>' + esc(sub) + '</small></span>';
  }
  function statusPill(s) {
    return "<span class='badge " + (s === 'active' ? 'in' : 'ok') + "'>" + (s === 'active' ? 'Admitted' : 'Discharged') + '</span>';
  }

  function visible() {
    var needle = q.trim().toLowerCase();
    // The ward selector belongs to the bed board; filtering the admission records by it too made a
    // second active admission silently disappear from the list.
    return HIS.admissions.all().filter(function (a) {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (!needle) return true;
      return (a.id + ' ' + a.patientId + ' ' + patientName(a.patientId) + ' ' + a.diagnosis + ' ' + a.bedLabel + ' ' + a.attending)
        .toLowerCase().indexOf(needle) > -1;
    }).sort(function (a, b) {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
      return new Date(b.admittedAt) - new Date(a.admittedAt);
    });
  }

  function bedTile(b) {
    var cls = b.status === 'occupied' ? 'occupied' : b.status === 'cleaning' ? 'cleaning' : b.status === 'maintenance' ? 'maintenance' : '';
    var sub = b.status === 'occupied' ? patientName(b.patientId) : b.status === 'cleaning' ? 'Cleaning' : b.status === 'maintenance' ? 'Maintenance' : b.type;
    return "<button class='bd-bed " + cls + "' data-bed='" + esc(b.id) + "' aria-label='Bed " + esc(b.label) + ', ' + esc(b.status) + "'>" +
      '<b>' + esc(b.label) + '</b><small>' + esc(sub) + '</small></button>';
  }

  function bedBoard() {
    var list = HIS.admissions.bedBoard(wardFilter === 'all' ? null : wardFilter);
    var occ = list.filter(function (b) { return b.status === 'occupied'; }).length;
    return "<div class='ad-card' style='margin-bottom:24px'>" +
      "<div class='ad-bar'><h2>Bed board</h2><span class='ad-count'>" + occ + ' of ' + list.length + ' occupied</span>' +
      "<select class='ad-sel' id='adWard' aria-label='Filter beds by ward'>" +
      "<option value='all'" + (wardFilter === 'all' ? ' selected' : '') + '>All wards</option>' +
      HIS.admissions.wards().map(function (w) {
        return "<option value='" + esc(w.ward) + "'" + (wardFilter === w.ward ? ' selected' : '') + '>' + esc(w.ward) + ' (' + w.beds + ')</option>';
      }).join('') + '</select></div>' +
      "<div class='bd-grid'>" + (list.length ? list.map(bedTile).join('') : "<div class='ad-empty'><b>No beds</b>No ward has been configured.</div>") + '</div>' +
      "<div class='bd-legend'>" +
      "<span class='bd-key'><span class='bd-dot'></span>Available</span>" +
      "<span class='bd-key'><span class='bd-dot occupied'></span>Occupied</span>" +
      "<span class='bd-key'><span class='bd-dot cleaning'></span>Cleaning</span>" +
      "<span class='bd-key'><span class='bd-dot maintenance'></span>Maintenance</span>" +
      '<span>Select a bed to admit, move or change its state. The board scrolls when a ward has more beds than fit.</span></div></div>';
  }

  function actionFor(a) {
    if (a.status === 'active') {
      return "<button class='ad-btn ghost' data-act='accrue' data-id='" + esc(a.id) + "'>Post charges</button>" +
        "<button class='ad-btn ghost' data-act='transfer' data-id='" + esc(a.id) + "'>Transfer</button>" +
        "<button class='ad-btn' data-act='discharge' data-id='" + esc(a.id) + "'>Discharge</button>";
    }
    return "<button class='ad-btn ghost' data-act='reopen' data-id='" + esc(a.id) + "'>Reopen</button>";
  }

  function render() {
    var st = HIS.admissions.stats();
    var list = visible();

    stage.innerHTML =
      "<h1 class='ad-title'>Admissions</h1>" +
      "<p class='ad-sub'>Admission, bed assignment, transfer, daily room-and-board accrual and discharge. Bed occupancy is derived from the active admission that names the bed.</p>" +
      "<div class='ad-body'>" +

      "<div class='ad-kpis'>" +
      "<div class='ad-kpi'><div class='l'>Active inpatients</div><div class='v'>" + st.active + "</div><div class='d'>Currently admitted</div></div>" +
      "<div class='ad-kpi'><div class='l'>Beds occupied</div><div class='v'>" + st.occupied + "</div><div class='d'>" + st.rate + '% of ' + st.beds + ' configured</div></div>' +
      "<div class='ad-kpi g'><div class='l'>Beds available</div><div class='v'>" + st.available + "</div><div class='d'>" + st.outOfService + ' out of service</div></div>' +
      "<div class='ad-kpi'><div class='l'>Discharged</div><div class='v'>" + st.discharged + "</div><div class='d'>Closed episodes on file</div></div>" +
      '</div>' +

      bedBoard() +

      "<div class='ad-card'>" +
      "<div class='ad-bar'>" +
      "<h2>Admission records</h2><span class='ad-count'>" + list.length + ' of ' + st.total + '</span>' +
      "<label class='ad-search'>" + svg('search', 16) + "<input id='adQ' type='search' placeholder='Search patient, bed or diagnosis' aria-label='Search admissions' value='" + esc(q) + "'></label>" +
      "<select class='ad-sel' id='adStatus' aria-label='Filter by status'>" +
      "<option value='active'" + (statusFilter === 'active' ? ' selected' : '') + '>Admitted</option>' +
      "<option value='discharged'" + (statusFilter === 'discharged' ? ' selected' : '') + '>Discharged</option>' +
      "<option value='all'" + (statusFilter === 'all' ? ' selected' : '') + '>All records</option>' +
      '</select>' +
      "<button class='ad-btn' id='adNew' type='button'>+ Admit patient</button>" +
      '</div>' +
      "<div class='ad-th ad-g-adm'><span>Admission</span><span>Patient</span><span>Location</span><span>Admitted</span><span>Stay</span><span>Diagnosis</span><span></span></div>" +
      (list.length ? list.map(function (a) {
        return "<div class='ad-tr ad-g-adm'>" +
          "<span class='ad-who'><b>" + esc(a.id) + '</b><small>' + esc(a.attending || '\u2014') + '</small></span>' +
          "<span class='ad-who'><b>" + esc(patientName(a.patientId)) + '</b><small>' + esc(a.patientId + ' \u00b7 ' + a.dept) + '</small></span>' +
          "<span class='ad-who'><b>" + esc(a.bedLabel) + ' \u00b7 ' + esc(a.bedType) + '</b><small>' + esc(a.ward) + '</small></span>' +
          "<span class='mu'>" + esc(when(a.admittedAt)) + (a.discharge ? '<br>' + statusPill(a.status) : '') + '</span>' +
          stayCell(a) +
          "<span class='mu'>" + esc(a.diagnosis) + '</span>' +
          "<span style='text-align:right;white-space:nowrap'>" + actionFor(a) + '</span></div>';
      }).join('') : "<div class='ad-empty'><b>No admission records match</b>Clear the search or change the filter.</div>") +
      '</div>' +

      "<div class='ad-note'><b>Daily billing rule.</b> A calendar day is billable when the patient was in the bed at 12:00 Asia/Manila on that day: " +
      'admitted before noon bills that day, discharged before noon does not, and the rate is the bed occupied at that cutoff. ' +
      'Daily charges are posted as an explicit, audited action, and each day is charged once. ' +
      'Admissions already billed through their invoice opening balance are not charged a second time.</div>' +
      '</div>';

    document.getElementById('adQ').oninput = function (e) {
      q = e.target.value; render();
      var f = document.getElementById('adQ'); f.focus(); f.setSelectionRange(f.value.length, f.value.length);
    };
    document.getElementById('adStatus').onchange = function (e) { statusFilter = e.target.value; render(); };
    document.getElementById('adWard').onchange = function (e) { wardFilter = e.target.value; render(); };
    document.getElementById('adNew').onclick = function () { admitModal(document.getElementById('adNew')); };

    stage.querySelectorAll('[data-bed]').forEach(function (b) {
      b.onclick = function () { bedModal(b.dataset.bed, b); };
    });
    stage.querySelectorAll('[data-act]').forEach(function (b) {
      b.onclick = function () {
        var a = HIS.admissions.byId(b.dataset.id);
        if (b.dataset.act === 'accrue') return accrue(a, b);
        if (b.dataset.act === 'transfer') return transferModal(a, b);
        if (b.dataset.act === 'discharge') return dischargeModal(a, b);
        if (b.dataset.act === 'reopen') return reopenModal(a, b);
      };
    });
  }

  // ---- modal shell (same geometry as the Accounts editor and the Laboratory dialogs) -------------
  function modal(opts) {
    var bg = document.createElement('div');
    bg.className = 'ac-bg';
    bg.innerHTML =
      "<form class='ac-m' role='dialog' aria-modal='true' aria-labelledby='mdTitle'>" +
      "<h3 id='mdTitle'>" + esc(opts.title) + '</h3>' +
      "<p class='ac-s'>" + esc(opts.sub || '') + '</p>' +
      opts.body +
      "<div class='ac-err' id='mdErr' role='alert'></div>" +
      "<div class='ac-a'><button type='button' class='mbtn out' data-x>Cancel</button>" +
      "<button type='submit' class='mbtn'>" + esc(opts.ok || 'Save') + '</button></div></form>';
    document.body.appendChild(bg);
    var opener = opts.trigger || document.activeElement;
    function close() {
      bg.remove();
      document.removeEventListener('keydown', escKey);
      if (opener && document.contains(opener) && typeof opener.focus === 'function') opener.focus();
    }
    function escKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', escKey);
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    bg.querySelector('[data-x]').onclick = close;
    bg.querySelector('form').onsubmit = function (ev) {
      ev.preventDefault();
      var v = Object.fromEntries(new FormData(ev.target).entries());
      var err = opts.onSubmit(v, bg.querySelector('#mdErr'), bg);
      if (!err) { close(); render(); }
    };
    var first = bg.querySelector('input,select,textarea');
    if (first) first.focus();
    if (opts.after) opts.after(bg);
    return { close: close, el: bg };
  }

  function toast(msg) { HIS.kit.toast(msg); }

  // ---- admit -----------------------------------------------------------------------------------
  function admitModal(trigger) {
    var patients = (HIS.registry ? HIS.registry.all() : []).filter(function (p) {
      return !HIS.admissions.activeForPatient(p.id);
    });
    if (!patients.length) { toast('Every patient already has an active admission.'); return; }
    var wards = HIS.admissions.wards().filter(function (w) { return w.beds > 0; });

    modal({
      title: 'Admit a patient',
      sub: 'The admission opens an encounter, occupies the bed and starts the daily accrual.',
      ok: 'Admit patient', trigger: trigger,
      body:
        "<div class='ac-f'><label for='adPt'>Patient</label><select id='adPt' name='patientId'>" +
        patients.map(function (p) { return "<option value='" + esc(p.id) + "'>" + esc(p.id + ' \u00b7 ' + p.name) + '</option>'; }).join('') + '</select></div>' +
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='adWardIn'>Ward</label><select id='adWardIn' name='ward'>" +
        wards.map(function (w) { return "<option value='" + esc(w.ward) + "'>" + esc(w.ward) + '</option>'; }).join('') + '</select></div>' +
        "<div class='ac-f'><label for='adBedIn'>Bed</label><select id='adBedIn' name='bedId'></select></div>" +
        '</div>' +
        "<div class='ac-f'><label for='adDx'>Admission diagnosis or documented reason</label><input id='adDx' name='diagnosis' placeholder='e.g. community-acquired pneumonia' required></div>" +
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='adAt'>Admitted at</label><input id='adAt' name='admittedAt' type='datetime-local'></div>" +
        "<div class='ac-f'><label for='adAtt'>Attending physician</label><input id='adAtt' name='attending' value='" + esc((HIS.registry.all()[0] || {}).doctor || '') + "'></div>" +
        '</div>' +
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='adPayer'>Payer</label><select id='adPayer' name='payerType'>" +
        [['self', 'Self-pay'], ['philhealth', 'PhilHealth'], ['hmo', 'HMO']].map(function (o) { return "<option value='" + o[0] + "'>" + o[1] + '</option>'; }).join('') + '</select></div>' +
        "<div class='ac-f'><label for='adRef'>Payer reference</label><input id='adRef' name='payerRef' placeholder='Member ID, LOA or case number'></div>" +
        '</div>' +
        "<p class='ac-hint'>The room-and-board rate comes from the configured tariff for the bed type: private " +
        peso((HIS.tariffs.quote('ROOM-PRIVATE') || {}).price) + ', semi-private ' + peso((HIS.tariffs.quote('ROOM-SEMI') || {}).price) +
        ', ward ' + peso((HIS.tariffs.quote('ROOM-WARD') || {}).price) + ' per billable day.</p>',
      after: function (bg) {
        var ward = bg.querySelector('#adWardIn'), bed = bg.querySelector('#adBedIn'), at = bg.querySelector('#adAt');
        function fill() {
          var free = HIS.admissions.bedBoard(ward.value).filter(function (b) { return b.status === 'available'; });
          bed.innerHTML = free.length
            ? free.map(function (b) { return "<option value='" + esc(b.id) + "'>" + esc(b.label + ' \u00b7 ' + b.type) + '</option>'; }).join('')
            : "<option value=''>No available bed in this ward</option>";
        }
        // Defaults to the demo's declared today, not the wall clock: the whole application shows
        // 31 August 2026, and an admission dated three months later would break every stay figure.
        var now = HIS.admissions.clock();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        at.value = now.toISOString().slice(0, 16);
        ward.onchange = fill; fill();
      },
      onSubmit: function (v, err) {
        var r = HIS.admissions.admit({
          patientId: v.patientId, bedId: v.bedId, attending: v.attending,
          diagnosis: v.diagnosis, payer: { type: v.payerType, reference: v.payerRef },
          admittedAt: v.admittedAt ? new Date(v.admittedAt).toISOString() : undefined
        });
        if (!r.ok) { err.textContent = r.error; return true; }
        // Day one is posted immediately so the admission is never financially invisible.
        var fin = HIS.admissions.accrue(r.admission.id);
        toast(r.admission.id + ' \u00b7 ' + patientName(r.admission.patientId) + ' admitted to ' + r.admission.bedLabel +
          (fin.posted.length ? ' \u00b7 ' + fin.posted.length + ' charge(s) posted' : ' \u00b7 no day is billable yet'));
        return false;
      }
    });
  }

  // ---- bed -------------------------------------------------------------------------------------
  function bedModal(bedId, trigger) {
    var b = HIS.admissions.bedView(bedId);
    if (!b) return;
    if (b.status === 'occupied') {
      var a = HIS.admissions.byId(b.admissionId);
      modal({
        title: 'Bed ' + b.label, sub: b.ward + ' \u00b7 ' + b.type + ' \u00b7 occupied', ok: 'Close', trigger: trigger,
        body: "<div class='ad-kv'>" +
          [['Admission', a.id], ['Patient', patientName(a.patientId) + ' \u00b7 ' + a.patientId],
           ['Attending', a.attending], ['Admitted', when(a.admittedAt)],
           ['Diagnosis', a.diagnosis], ['Billable days', String(nights(a))]]
            .map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('') + '</div>',
        onSubmit: function () { return false; }
      });
      return;
    }
    modal({
      title: 'Bed ' + b.label, sub: b.ward + ' \u00b7 ' + b.type + ' \u00b7 ' + b.status, ok: 'Update bed', trigger: trigger,
      body: "<div class='ac-f'><label for='bdSt'>Bed state</label><select id='bdSt' name='status'>" +
        [['available', 'Available'], ['cleaning', 'Cleaning'], ['maintenance', 'Maintenance']]
          .map(function (o) { return "<option value='" + o[0] + "'" + (b.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
        "<div class='ac-f'><label for='bdNote'>Note (optional)</label><input id='bdNote' name='note' value='" + esc(b.note || '') + "'></div>",
      onSubmit: function (v, err) {
        var r = HIS.admissions.setBedState(bedId, v.status, v.note);
        if (!r.ok) { err.textContent = r.error; return true; }
        toast('Bed ' + b.label + ' is now ' + v.status + '.');
        return false;
      }
    });
  }

  // ---- accrue ----------------------------------------------------------------------------------
  function accrue(a, trigger) {
    var r = HIS.admissions.accrue(a.id);
    if (!r.ok) { toast(r.error); return; }
    if (!r.dates.length) { toast('No billable day has reached its noon cutoff yet.'); return; }
    if (!r.posted.length) {
      toast('Every billable day for ' + a.id + ' is already posted (' + r.skipped.length + ' line(s) skipped).');
      return;
    }
    toast(r.posted.length + ' charge(s) posted for ' + a.id + ' \u00b7 ' + peso(r.total));
    render();
  }

  // ---- transfer --------------------------------------------------------------------------------
  function transferModal(a, trigger) {
    var free = HIS.admissions.bedBoard().filter(function (b) {
      return b.status === 'available' && b.id !== a.bedId;
    });
    if (!free.length) { toast('No bed is free to transfer into.'); return; }
    modal({
      title: 'Transfer patient', sub: a.id + ' \u00b7 ' + patientName(a.patientId) + ' \u00b7 now in ' + a.bedLabel, ok: 'Transfer', trigger: trigger,
      body: "<div class='ac-f'><label for='trBed'>Destination bed</label><select id='trBed' name='bedId'>" +
        free.map(function (b) { return "<option value='" + esc(b.id) + "'>" + esc(b.label + ' \u00b7 ' + b.type + ' \u00b7 ' + b.ward) + '</option>'; }).join('') + '</select></div>' +
        "<div class='ac-f'><label for='trWhy'>Reason</label><input id='trWhy' name='reason' placeholder='e.g. step-down to ward bed' required></div>" +
        "<p class='ac-hint'>The bed occupied at each day's noon cutoff sets that day's rate, so a transfer after noon changes the rate from the next day. " +
        'The original assignment stays in the transfer history.</p>',
      onSubmit: function (v, err) {
        var r = HIS.admissions.transfer(a.id, { bedId: v.bedId, reason: v.reason });
        if (!r.ok) { err.textContent = r.error; return true; }
        toast(a.id + ' transferred to ' + r.admission.bedLabel + '.');
        return false;
      }
    });
  }

  // ---- discharge -------------------------------------------------------------------------------
  function dischargeModal(a, trigger) {
    var due = HIS.admissions.billableDates(a);
    var enc = a.encounterId && HIS.charges ? HIS.charges.forEncounter(a.encounterId) : [];
    var unbilled = enc.filter(function (c) { return c.status !== 'void' && !c.invoiceId; });
    var invoiceId = a.encounterId && HIS.encounters ? HIS.encounters.invoiceOf(a.encounterId) : null;
    var bill = invoiceId ? HIS.billing.byId(invoiceId) : null;

    modal({
      title: 'Discharge patient', sub: a.id + ' \u00b7 ' + patientName(a.patientId) + ' \u00b7 bed ' + a.bedLabel, ok: 'Discharge', trigger: trigger,
      body:
        "<div class='ac-row'>" +
        "<div class='ac-f'><label for='dcDisp'>Disposition</label><select id='dcDisp' name='disposition'>" +
        HIS.admissions.DISPOSITIONS.map(function (d) { return '<option>' + esc(d) + '</option>'; }).join('') + '</select></div>' +
        "<div class='ac-f'><label for='dcAt'>Discharge date and time</label><input id='dcAt' name='at' type='datetime-local'></div>" +
        '</div>' +
        "<div class='ac-f'><label for='dcSum'>Discharge summary</label><input id='dcSum' name='summary' placeholder='Course in hospital, condition on discharge, follow-up' required></div>" +
        "<div class='ac-f'><label for='dcNote'>Note (optional)</label><input id='dcNote' name='note'></div>" +
        "<div class='ad-sum'><b>Final charge review.</b> " + due.length + ' billable day(s) on this admission. ' +
        (unbilled.length
          ? '<span class="r">' + unbilled.length + ' charge(s) totalling ' + peso(unbilled.reduce(function (t, c) { return t + c.amount; }, 0)) + ' are still unbilled.</span> Assign them before the patient leaves.'
          : '<span class="g">Every charge on this episode is on an invoice.</span>') +
        (bill ? ' Invoice ' + bill.id + ' balance ' + peso(HIS.ledger.balanceOf(bill)) + '.' : ' No invoice is linked to this episode.') +
        '</div>',
      onSubmit: function (v, err) {
        var at = v.at ? new Date(v.at).toISOString() : undefined;
        var r = HIS.admissions.discharge(a.id, { disposition: v.disposition, summary: v.summary, note: v.note, at: at });
        if (!r.ok) { err.textContent = r.error; return true; }
        toast(a.id + ' discharged \u00b7 bed ' + a.bedLabel + ' released' +
          (r.unbilledCount ? ' \u00b7 ' + r.unbilledCount + ' charge(s) still unbilled' : ''));
        return false;
      }
    });
  }

  function reopenModal(a, trigger) {
    modal({
      title: 'Reopen discharge', sub: a.id + ' \u00b7 ' + patientName(a.patientId) + ' \u00b7 discharged ' + when(a.discharge && a.discharge.at), ok: 'Reopen', trigger: trigger,
      body: "<div class='ac-f'><label for='roWhy'>Reason</label><input id='roWhy' name='reason' placeholder='Why the discharge is being reversed' required></div>" +
        "<p class='ac-hint'>The original discharge stays on the record. The bed is re-occupied only if nobody else has taken it.</p>",
      onSubmit: function (v, err) {
        var r = HIS.admissions.cancelDischarge(a.id, v.reason);
        if (!r.ok) { err.textContent = r.error; return true; }
        toast(a.id + ' reopened \u00b7 bed ' + a.bedLabel + ' re-occupied.');
        return false;
      }
    });
  }

  // Local svg helper: the admin shell icon set is not loaded on this page.
  function svg(name, size) {
    var paths = { search: "<circle cx='11' cy='11' r='7'/><path d='m20 20-3.5-3.5'/>" };
    return "<svg width='" + size + "' height='" + size + "' viewBox='0 0 24 24' fill='none' stroke='#8a97a6' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>" + (paths[name] || '') + '</svg>';
  }

  render();
})();
