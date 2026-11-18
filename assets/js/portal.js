// Patient portal (M5). Signed-in experience over the SHARED hospital records.
//
// WHAT CHANGED FROM THE M3 PORTAL
// M3 kept a private account store (`mh_portal_accounts`) with no link to any patient row, so the
// portal could not show a single real record: the signed-in state was a name and an email. M5
// deletes that store. Sign-in now goes through HIS.auth — the same account table the staff console
// uses — and every view resolves through `account.patientId` (or an authorised guardian link) into
// HIS.registry. There is one patient identity in the application, not two.
//
// DEMONSTRATION ONLY. Client-side session, synthetic records, no server. docs/AUTH.md.
(function () {
  var S = HIS.store, A = HIS.audit;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return HIS.kit.esc(s); };
  var peso = function (n) { return HIS.ledger ? HIS.ledger.peso(n) : '\u20b1' + n; };

  var PUBLIC = ['landing', 'signup', 'signin', 'forgot'];
  var PRIVATE = ['home', 'appts', 'medical', 'billing', 'docs', 'me'];
  var VIEWS = PUBLIC.concat(PRIVATE);
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var SUBJECT = 'pt_subject';   // which linked patient the session is viewing (guardian switching)

  var strong = function (v) { return v.length >= 12 && /[A-Za-z]/.test(v) && /\d/.test(v); };

  // ---- session --------------------------------------------------------------------------------
  // The portal shares HIS.auth. A staff account cannot open the portal: this screen shows one
  // patient's clinical record, so a nurse or cashier signing in here would be a data leak.
  function sessionAccount() {
    var a = HIS.auth.account();
    if (!a) return null;
    if (a.role !== 'patient') return null;
    return a;
  }

  // Everyone this account may view: itself plus every ACTIVE guardian link.
  function subjects() {
    var a = sessionAccount();
    if (!a) return [];
    var out = [];
    var own = a.patientId ? HIS.registry.byId(a.patientId) : null;
    if (own) out.push({ patient: own, via: 'self', link: null });
    HIS.registry.dependentsOf(a.id).forEach(function (p) {
      if (own && p.id === own.id) return;
      var link = HIS.registry.guardianRowsFor(p.id).filter(function (g) {
        return g.accountId === a.id && g.status === 'active';
      })[0];
      out.push({ patient: p, via: 'guardian', link: link });
    });
    return out;
  }

  function subjectId() {
    try { return sessionStorage.getItem(SUBJECT) || null; } catch (e) { return null; }
  }
  function setSubject(id) {
    try { sessionStorage.setItem(SUBJECT, id); } catch (e) { /* private mode */ }
  }

  function current() {
    var list = subjects();
    if (!list.length) return null;
    var id = subjectId();
    return list.filter(function (s) { return s.patient.id === id; })[0] || list[0];
  }

  // ---- formatting -----------------------------------------------------------------------------
  function initials(name) {
    var w = String(name || '').replace(/^(Dr\.|Atty\.)\s*/, '').split(/\s+/).filter(Boolean);
    if (!w.length) return '--';
    // first + last, so 'Isabel Geliz V. Ramos' is IR rather than IG.
    return (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase();
  }
  // '1 invoice(s)' reads like an unfilled placeholder.
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function money(n) { return peso(n); }
  function manilaDate(iso, withTime) {
    if (!iso) return '\u2014';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    var o = { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' };
    if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return d.toLocaleString('en-PH', o).replace(',', ' \u00b7');
  }
  function badge(text, kind) { return "<span class='pt-badge " + (kind || 'off') + "'>" + esc(text) + '</span>'; }
  function statusBadge(status) {
    var map = {
      Confirmed: 'ok', Completed: 'info', Cancelled: 'err', Pending: 'warn',
      Paid: 'ok', Partial: 'warn',
      Admitted: 'info', Waiting: 'warn', 'In Consultation': 'warn', Discharged: 'off',
      Verified: 'ok', 'Not checked': 'off', Approved: 'ok', 'Not requested': 'off', None: 'off'
    };
    return badge(status, map[status] || 'off');
  }
  function empty(title, sub) {
    return "<div class='pt-empty'><b>" + esc(title) + '</b>' + esc(sub || '') + '</div>';
  }
  function block(title, body, action) {
    return "<section class='pt-block'><div class='pt-block-h'><h2>" + esc(title) + '</h2>' +
      (action || '') + "</div><div class='pt-block-b'>" + body + '</div></section>';
  }
  function greeting() {
    var h = Number(new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila', hour: '2-digit', hour12: false }));
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  // ---- shared data reads ----------------------------------------------------------------------
  function consultFor(id) { return ((HIS.consult && HIS.consult.pts) || []).filter(function (p) { return p.id === id; })[0] || null; }
  function planFor(id) { return ((HIS.treatment && HIS.treatment.plans) || []).filter(function (p) { return p.id === id; })[0] || null; }
  function nursingFor(id) { return ((HIS.nursing && HIS.nursing.pts) || []).filter(function (p) { return p.id === id; })[0] || null; }
  function labFor(id) { return (window.HIS.lab ? HIS.lab.forPatient(id) : []); }

  function invoiceSummary(patientId) {
    var bills = HIS.registry.invoicesFor(patientId);
    var billed = 0, paid = 0;
    bills.forEach(function (b) {
      billed += Number(HIS.ledger.invoiceAmount(b)) || 0;
      paid += HIS.ledger.paidOf(b);
    });
    return { bills: bills, billed: billed, paid: paid, balance: Math.round((billed - paid) * 100) / 100 };
  }

  // ---- views ----------------------------------------------------------------------------------
  var R = {};

  R.home = function (ctx) {
    var p = ctx.patient;
    var appts = HIS.registry.appointmentsFor(p.id);
    var up = appts.filter(function (a) { return a.status === 'Confirmed' || a.status === 'Pending'; });
    var inv = invoiceSummary(p.id);
    var plan = planFor(p.id);
    var meds = plan && plan.f && plan.f.meds && plan.f.meds !== 'None scheduled' ? plan.f.meds.split(',') : [];
    var labs = labFor(p.id).filter(function (o) { return o.status === 'Validated'; });

    var h = "<h1 class='pt-h1'>" + greeting() + ', ' + esc(String(p.first || p.name).split(' ')[0]) + '</h1>';
    h += "<p class='pt-sub'>" + esc(p.id) + ' \u00b7 ' + esc(p.type) + ' \u00b7 ' + esc(p.dept || 'Unassigned department') +
      (ctx.via === 'guardian' ? ' \u00b7 viewing as ' + esc(ctx.link.relationship.toLowerCase()) : '') + '</p>';
    h += "<div class='pt-banner'><span><b>Sample records.</b> All information shown here is fictitious. " +
      'This portal reads the same browser storage as the staff console, so it does not sync between devices.</span></div>';

    h += "<div class='pt-cards'>";
    h += "<div class='pt-card'><span class='l'>Next appointment</span><span class='n'>" +
      (up.length ? esc(up[0].when.split('\u2022')[0].trim()) : '\u2014') + '</span><span class="s">' +
      (up.length ? esc(up[0].kind + ' \u00b7 ' + up[0].doctor) : 'Nothing scheduled') + '</span></div>';
    h += "<div class='pt-card'><span class='l'>Outstanding balance</span><span class='n" + (inv.balance > 0 ? ' bad' : ' ok') + "'>" +
      money(inv.balance) + '</span><span class="s">' + (inv.bills.length ? plural(inv.bills.length, 'invoice') + ' on file' : 'No invoices') + '</span></div>';
    h += "<div class='pt-card'><span class='l'>Active medications</span><span class='n'>" + meds.length +
      '</span><span class="s">' + (meds.length ? esc(meds.slice(0, 2).join(', ')) : 'None prescribed') + '</span></div>';
    h += "<div class='pt-card'><span class='l'>Results available</span><span class='n'>" + labs.length +
      '</span><span class="s">' + (labs.length ? 'Validated by the laboratory' : 'Nothing released yet') + '</span></div>';
    h += '</div>';

    var upBody = up.length ? up.slice(0, 3).map(function (a) {
      return "<div class='pt-item'><div class='t'>" + esc(a.kind) + "</div><div class='m'>" + esc(a.when) +
        ' \u00b7 ' + esc(a.doctor) + "</div><div class='r'>" + statusBadge(a.status) + '</div></div>';
    }).join('') : empty('No upcoming appointments', 'Contact the front desk to book one.');
    h += block('Upcoming appointments', upBody, "<a class='pt-link' href='#appts'>View all</a>");

    var c = consultFor(p.id);
    if (c && c.rec) {
      var dx = plan && plan.f ? plan.f.pdx : null;
      h += block('Latest consultation', "<div class='pt-kv'>" +
        '<div><dt>Date</dt><dd>' + esc(c.rec.upd || 'Aug 31, 2026') + '</dd></div>' +
        '<div><dt>Attending doctor</dt><dd>' + esc(c.rec.s3 ? (c.rec.s3[0] || [])[1] : '\u2014') + '</dd></div>' +
        '<div><dt>Chief complaint</dt><dd>' + esc(c.cc || '\u2014') + '</dd></div>' +
        '<div><dt>Working diagnosis</dt><dd>' + esc(dx || 'Recorded after consultation') + '</dd></div>' +
        '</div>', "<a class='pt-link' href='#medical'>Medical record</a>");
    }

    if (ctx.all.length > 1) {
      h += block('People you can view', ctx.all.map(function (s) {
        return "<div class='pt-dep'><div><b>" + esc(s.patient.name) + '</b><small>' + esc(s.patient.id) +
          ' \u00b7 ' + esc(s.via === 'self' ? 'You' : (s.link.relationship || 'Dependent')) + '</small></div>' +
          (s.patient.id === p.id ? badge('Viewing', 'info')
            : "<button class='pt-btn sm' data-subject='" + esc(s.patient.id) + "'>View</button>") + '</div>';
      }).join(''));
    }
    return h;
  };

  R.appts = function (ctx) {
    var p = ctx.patient;
    var all = HIS.registry.appointmentsFor(p.id);
    var mode = ctx.ui.apptMode || 'all';
    var shown = all.filter(function (a) {
      if (mode === 'up') return a.status === 'Confirmed' || a.status === 'Pending';
      if (mode === 'past') return a.status === 'Completed' || a.status === 'Cancelled';
      return true;
    });

    var h = "<h1 class='pt-h1'>My appointments</h1><p class='pt-sub'>" + esc(p.name) + ' \u00b7 ' + esc(p.id) + '</p>';
    h += "<div class='pt-toolbar'><div class='pt-seg'>" +
      [['all', 'All'], ['up', 'Upcoming'], ['past', 'Past']].map(function (m) {
        return "<button data-apptmode='" + m[0] + "'" + (mode === m[0] ? " class='on'" : '') + '>' + m[1] + '</button>';
      }).join('') + '</div></div>';

    if (!shown.length) {
      h += block('Appointments', empty('Nothing here', 'No appointments match this filter.'));
      return h;
    }

    var rows = shown.map(function (a) {
      return '<tr><td>' + esc(a.when) + '</td><td>' + esc(a.kind) + '</td><td>' + esc(a.doctor) +
        '</td><td>' + statusBadge(a.status) + '</td></tr>';
    }).join('');
    h += "<section class='pt-block'><div class='pt-block-h'><h2>Appointment history</h2>" +
      "<span class='pt-badge info'>" + plural(shown.length, 'record') + '</span></div>' +
      "<table class='pt-tbl'><thead><tr><th>When</th><th>Type</th><th>Doctor</th><th>Status</th></tr></thead><tbody>" +
      rows + '</tbody></table></section>';

    h += "<div class='pt-banner'><span>To book, reschedule or cancel, contact the front desk at " +
      esc((HIS.contact && HIS.contact.phone) || '+63 2 8888 0000') +
      '. Online self-booking is not available — please contact the front desk.</span></div>';
    return h;
  };

  R.medical = function (ctx) {
    var p = ctx.patient;
    var c = consultFor(p.id), plan = planFor(p.id), nurse = nursingFor(p.id);
    // Only a VALIDATED result may be shown to the patient. An entered draft is the laboratory's
    // working copy; releasing it would show a number nobody has checked.
    var labs = labFor(p.id).filter(function (o) { return o.status === 'Validated'; });

    var h = "<h1 class='pt-h1'>My medical record</h1><p class='pt-sub'>" + esc(p.name) + ' \u00b7 ' + esc(p.id) +
      ' \u00b7 ' + esc(p.bloodType || '\u2014') + ' \u00b7 allergy: ' + esc(p.allergies || 'None recorded') + '</p>';
    h += "<div class='pt-banner'><span><b>Read-only.</b> These are the same records your care team sees. " +
      'Nothing here is written for the portal: if a section is empty, no record exists yet.</span></div>';

    if (c && c.rec) {
      var s1 = c.rec.s1 || [], s2 = c.rec.s2 || [], s3 = c.rec.s3 || [];
      var kv = function (rows) {
        return rows.map(function (r) { return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>'; }).join('');
      };
      h += block('Consultation \u00b7 ' + (c.rec.upd || ''), "<div class='pt-kv'>" + kv(s1) + '</div>' +
        "<div class='pt-block-h' style='border-top:1px solid var(--line-pt)'><h2>Vital signs</h2></div>" +
        "<div class='pt-kv'>" + kv(s2) + '</div>' +
        "<div class='pt-block-h' style='border-top:1px solid var(--line-pt)'><h2>Visit</h2></div>" +
        "<div class='pt-kv'>" + kv(s3) + '</div>');
    } else {
      h += block('Consultations', empty('No consultation on file', 'A consultation record appears here once a doctor completes one.'));
    }

    if (plan && plan.f) {
      h += block('Treatment plan', "<div class='pt-kv'>" +
        '<div><dt>Primary diagnosis</dt><dd>' + esc(plan.f.pdx) + '</dd></div>' +
        '<div><dt>Started</dt><dd>' + esc(plan.f.started) + '</dd></div>' +
        '<div><dt>Goal</dt><dd>' + esc(plan.f.goal) + '</dd></div>' +
        '<div><dt>Duration</dt><dd>' + esc(plan.f.duration) + '</dd></div>' +
        '<div><dt>Monitoring</dt><dd>' + esc(plan.f.monitoring) + '</dd></div>' +
        '<div><dt>Next review</dt><dd>' + esc(plan.f.review) + '</dd></div>' +
        '</div>');
    }

    var rx = (window.HIS.pharmacy && HIS.pharmacy.forPatient) ? HIS.pharmacy.forPatient(p.id) : [];
    var rxBody;
    if (rx.length) {
      rxBody = "<table class='pt-tbl'><thead><tr><th>Medication</th><th>Dosage</th><th>Status</th><th>Ordered</th></tr></thead><tbody>" +
        rx.map(function (r) {
          return '<tr><td>' + esc(r.drug) + '</td><td>' + esc(r.dosage || '\u2014') + '</td><td>' +
            badge(r.status, r.status === 'Dispensed' ? 'ok' : r.status === 'Rejected' ? 'err' : 'warn') +
            '</td><td>' + esc(manilaDate(r.orderedAt)) + '</td></tr>';
        }).join('') + '</tbody></table>';
    } else if (plan && plan.f && plan.f.meds && plan.f.meds !== 'None scheduled') {
      rxBody = plan.f.meds.split(',').map(function (m) {
        return "<div class='pt-item'><div class='t'>" + esc(m.trim()) + "</div><div class='m'>From the treatment plan \u00b7 no pharmacy order raised</div>" +
          "<div class='r'>" + badge('Planned', 'off') + '</div></div>';
      }).join('');
    } else {
      rxBody = empty('No prescriptions', 'Medication ordered by a doctor appears here.');
    }
    h += block('Prescriptions', rxBody);

    if (nurse && nurse.rec && nurse.rec.meds) {
      h += block('Medication administration', "<table class='pt-tbl'><thead><tr><th>Medication</th><th>Recorded</th></tr></thead><tbody>" +
        nurse.rec.meds.map(function (m) { return '<tr><td>' + esc(m[0]) + '</td><td>' + esc(m[1]) + '</td></tr>'; }).join('') +
        '</tbody></table>');
    }

    var labBody;
    if (!window.HIS.lab) {
      labBody = empty('Laboratory module not available', 'This build has no laboratory store.');
    } else if (!labs.length) {
      labBody = empty('No laboratory results', 'A result appears here only after a medical technologist validates it.');
    } else {
      // The lab record nests the reading under `result`; reading o.value here would silently show
      // blanks, which is how a portal and a laboratory drift apart.
      labBody = "<table class='pt-tbl'><thead><tr><th>Test</th><th>Result</th><th>Reference</th><th>Flag</th><th>Validated</th></tr></thead><tbody>" +
        labs.map(function (o) {
          var r = o.result || {};
          return '<tr><td>' + esc(o.test) + '</td><td>' + esc(r.value || '\u2014') + ' ' + esc(r.unit || '') +
            '</td><td>' + esc(r.reference || '\u2014') + '</td><td>' +
            badge(r.flag || 'Normal', r.flag === 'Critical' ? 'err' : r.flag === 'Abnormal' ? 'warn' : 'ok') +
            '</td><td>' + esc(manilaDate(o.validatedAt)) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    h += block('Laboratory results', labBody);
    return h;
  };

  R.billing = function (ctx) {
    var p = ctx.patient;
    var inv = invoiceSummary(p.id);
    var bills = inv.bills;

    var h = "<h1 class='pt-h1'>Billing</h1><p class='pt-sub'>" + esc(p.name) + ' \u00b7 ' + esc(p.id) + '</p>';
    h += "<div class='pt-cards'>" +
      "<div class='pt-card'><span class='l'>Total billed</span><span class='n'>" + money(inv.billed) + '</span><span class="s">' + plural(bills.length, 'invoice') + '</span></div>' +
      "<div class='pt-card'><span class='l'>Paid</span><span class='n ok'>" + money(inv.paid) + '</span><span class="s">Across all invoices</span></div>' +
      "<div class='pt-card'><span class='l'>Balance due</span><span class='n" + (inv.balance > 0 ? ' bad' : ' ok') + "'>" + money(inv.balance) + '</span><span class="s">Settle at the cashier</span></div>' +
      "<div class='pt-card'><span class='l'>Coverage</span><span class='n'>" + esc(p.hmo && p.hmo.provider ? p.hmo.provider : '\u2014') + '</span><span class="s">' +
      esc(p.philhealth ? 'PhilHealth ' + p.philhealth.eligibility : 'PhilHealth not checked') + '</span></div>' +
      '</div>';

    if (!bills.length) {
      h += block('Invoices', empty('No invoices', 'Charges raised during a visit appear here.'));
      return h;
    }

    bills.forEach(function (b) {
      var paid = HIS.ledger.paidOf(b), bal = HIS.ledger.balanceOf(b), st = HIS.ledger.statusOf(b);
      var items = b.items || [];
      var body = "<table class='pt-tbl'><thead><tr><th>Charge</th><th class='num'>Qty</th><th class='num'>Rate</th><th class='num'>Amount</th></tr></thead><tbody>";
      if (items.length) {
        body += items.map(function (r) {
          return "<tr><td>" + esc(r[0]) + "</td><td class='num'>" + r[1] + "</td><td class='num'>" +
            Number(r[2]).toLocaleString('en-PH') + "</td><td class='num'>" + Number(r[3]).toLocaleString('en-PH') + '</td></tr>';
        }).join('');
      } else {
        body += "<tr><td>Summary charges (no itemised lines recorded for this invoice)</td><td class='num'>1</td><td class='num'>" +
          Number(HIS.ledger.invoiceAmount(b)).toLocaleString('en-PH') + "</td><td class='num'>" + Number(HIS.ledger.invoiceAmount(b)).toLocaleString('en-PH') + '</td></tr>';
      }
      body += "<tr><td colspan='3' class='num'><b>Total</b></td><td class='num'><b>" + money(HIS.ledger.invoiceAmount(b)) + '</b></td></tr>';
      body += "<tr><td colspan='3' class='num'>Paid</td><td class='num'>" + money(paid) + '</td></tr>';
      body += "<tr><td colspan='3' class='num'><b>Balance</b></td><td class='num'><b>" + money(bal) + '</b></td></tr>';
      body += '</tbody></table>';

      var txs = HIS.ledger.forInvoice(b.id);
      if (txs.length) {
        body += "<div class='pt-block-h' style='border-top:1px solid var(--line-pt)'><h2>Payment history</h2></div>" +
          "<table class='pt-tbl'><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class='num'>Amount</th><th>Status</th></tr></thead><tbody>" +
          txs.map(function (t) {
            return '<tr><td>' + esc(manilaDate(t.at, true)) + '</td><td>' + esc(t.method) + '</td><td>' + esc(t.reference || '\u2014') +
              "</td><td class='num'>" + money(HIS.ledger.toPesos(t.amount)) + '</td><td>' +
              badge(t.status === 'posted' ? 'Settled' : t.status === 'pending' ? 'Awaiting confirmation' : 'Void',
                t.status === 'posted' ? 'ok' : t.status === 'pending' ? 'warn' : 'off') + '</td></tr>';
          }).join('') + '</tbody></table>';
      }
      h += block('Invoice ' + b.id + ' \u00b7 ' + b.date + ' \u00b7 ' + b.dept,
        body, statusBadge(st) + " <button class='pt-btn sm' data-doc='statement:" + esc(b.id) + "'>Download</button>");
    });

    h += "<div class='pt-banner'><span><b>Payment instructions.</b> Settle at the cashier, or ask for a " +
      'GCash / Maya / QR Ph reference. Electronic payments recorded here are marked ' +
      '"awaiting confirmation" until a cashier verifies the provider reference — no gateway is connected.</span></div>';
    return h;
  };

  R.docs = function (ctx) {
    var p = ctx.patient;
    var appts = HIS.registry.appointmentsFor(p.id);
    var bills = HIS.registry.invoicesFor(p.id);

    var h = "<h1 class='pt-h1'>Documents</h1><p class='pt-sub'>" + esc(p.name) + ' \u00b7 ' + esc(p.id) + '</p>';
    h += "<div class='pt-banner'><span>Each tile generates a real PDF from the record it names. " +
      'Nothing is pre-generated: if a record does not exist, its tile is not offered.</span></div>';

    var tiles = [];
    appts.forEach(function (a, i) {
      tiles.push({ id: 'slip:' + i, title: 'Appointment slip', sub: a.when + ' \u00b7 ' + a.kind });
    });
    bills.forEach(function (b) {
      tiles.push({ id: 'statement:' + b.id, title: 'Statement ' + b.id, sub: money(HIS.ledger.invoiceAmount(b)) + ' \u00b7 ' + HIS.ledger.statusOf(b) });
      HIS.ledger.forInvoice(b.id).filter(function (t) { return t.status === 'posted'; }).forEach(function (t) {
        tiles.push({ id: 'receipt:' + t.id, title: 'Receipt ' + t.id, sub: money(HIS.ledger.toPesos(t.amount)) + ' \u00b7 ' + t.method });
      });
    });
    var plan = planFor(p.id);
    if (plan && plan.f) tiles.push({ id: 'plan', title: 'Treatment summary', sub: plan.f.pdx });

    if (!tiles.length) {
      h += block('Available documents', empty('No documents yet', 'Documents appear once you have an appointment, an invoice or a treatment plan.'));
      return h;
    }
    h += block('Available documents (' + tiles.length + ")", "<div class='pt-docs'>" +
      tiles.map(function (t) {
        return "<button class='pt-doc' data-doc='" + esc(t.id) + "'><i>PDF</i><b>" + esc(t.title) + '</b><span>' + esc(t.sub) + '</span></button>';
      }).join('') + '</div>');
    return h;
  };

  R.me = function (ctx) {
    var p = ctx.patient;
    var a = sessionAccount();
    var ad = p.address || {}, em = p.emergency || {}, ph = p.philhealth || {}, hm = p.hmo || {};

    var h = "<h1 class='pt-h1'>My profile</h1><p class='pt-sub'>" + esc(p.name) + ' \u00b7 ' + esc(p.id) + '</p>';
    h += "<div class='pt-banner'><span>Signed in as <b>" + esc(a.email) + '</b>. This record is owned by the hospital; ' +
      'changes go through a request so the audit trail stays intact.</span></div>';

    h += block('Patient details', "<div class='pt-kv'>" +
      '<div><dt>Full name</dt><dd>' + esc(p.name) + '</dd></div>' +
      '<div><dt>Date of birth</dt><dd>' + esc(p.dob) + ' (' + esc(p.age) + ' yrs)</dd></div>' +
      '<div><dt>Sex</dt><dd>' + esc(p.sex || '\u2014') + '</dd></div>' +
      '<div><dt>Civil status</dt><dd>' + esc(p.civil || '\u2014') + '</dd></div>' +
      '<div><dt>Mobile</dt><dd>' + esc(p.mobile || '\u2014') + '</dd></div>' +
      '<div><dt>Email</dt><dd>' + esc(p.email || '\u2014') + '</dd></div>' +
      '<div><dt>Blood type</dt><dd>' + esc(p.bloodType || '\u2014') + '</dd></div>' +
      '<div><dt>Allergies</dt><dd>' + esc(p.allergies || 'None recorded') + '</dd></div>' +
      '</div>');

    h += block('Address', "<div class='pt-kv'>" +
      '<div><dt>Street</dt><dd>' + esc(ad.street || '\u2014') + '</dd></div>' +
      '<div><dt>Barangay</dt><dd>' + esc(ad.barangay || '\u2014') + '</dd></div>' +
      '<div><dt>City / municipality</dt><dd>' + esc(ad.city || '\u2014') + '</dd></div>' +
      '<div><dt>Province</dt><dd>' + esc(ad.province || '\u2014') + '</dd></div>' +
      '<div><dt>Region</dt><dd>' + esc(ad.region || '\u2014') + '</dd></div>' +
      '<div><dt>Postal code</dt><dd>' + esc(ad.zip || '\u2014') + '</dd></div>' +
      '</div>');

    h += block('Emergency contact', "<div class='pt-kv'>" +
      '<div><dt>Name</dt><dd>' + esc(em.name || '\u2014') + '</dd></div>' +
      '<div><dt>Relationship</dt><dd>' + esc(em.relation || '\u2014') + '</dd></div>' +
      '<div><dt>Mobile</dt><dd>' + esc(em.mobile || '\u2014') + '</dd></div>' +
      '</div>');

    h += block('Coverage', "<div class='pt-kv'>" +
      '<div><dt>PhilHealth number</dt><dd>' + esc(ph.no || '\u2014') + '</dd></div>' +
      '<div><dt>Membership category</dt><dd>' + esc(ph.category || '\u2014') + '</dd></div>' +
      '<div><dt>Eligibility</dt><dd>' + statusBadge(ph.eligibility || 'Not checked') + '</dd></div>' +
      '<div><dt>Dependents</dt><dd>' + esc(ph.dependents != null ? ph.dependents : '\u2014') + '</dd></div>' +
      '<div><dt>HMO provider</dt><dd>' + esc(hm.provider || 'None') + '</dd></div>' +
      '<div><dt>HMO status</dt><dd>' + statusBadge(hm.status || 'None') + '</dd></div>' +
      '</div>');

    var deps = ctx.all.filter(function (s) { return s.via === 'guardian'; });
    if (deps.length) {
      h += block('People you are authorised to view', deps.map(function (s) {
        return "<div class='pt-dep'><div><b>" + esc(s.patient.name) + '</b><small>' + esc(s.patient.id) + ' \u00b7 ' +
          esc(s.link.relationship) + ' \u00b7 authorised ' + esc(manilaDate(s.link.authorizedAt)) + '</small></div>' +
          "<button class='pt-btn sm' data-subject='" + esc(s.patient.id) + "'>View record</button></div>";
      }).join(''));
    }

    h += block('Request a correction', "<div style='padding:4px 18px 16px'>" +
      "<label class='pt-label'>What needs changing?<textarea class='pt-input' id='pt-req' rows='3' placeholder='e.g. my mobile number changed to +63 917 000 0000'></textarea></label>" +
      "<p class='pt-error' id='pt-req-err' role='alert'></p>" +
      "<button class='pt-btn' type='button' id='pt-req-send'>Send request</button>" +
      "<p class='pt-muted pt-small' style='margin-top:10px'>Requests are recorded for staff review and appear in the audit log. " +
      'This environment cannot send email, so nothing is delivered — please check with registration on your next visit.</p></div>');
    return h;
  };

  // ---- document generation --------------------------------------------------------------------
  function buildDoc(id, ctx) {
    var p = ctx.patient, rows = [];
    var head = function (title) {
      rows.push(['MEDIHEAL MEDICAL CENTER', 14, 22]);
      rows.push(['Patient portal document - sample copy', 8, 18]);
      rows.push([title, 12, 26]);
      rows.push(['', 9, 8]);
      rows.push(['Patient: ' + p.name, 9, 14]);
      rows.push(['Patient ID: ' + p.id + '   DOB: ' + (p.dob || '-'), 9, 14]);
      rows.push(['Generated: ' + manilaDate(new Date().toISOString(), true) + ' (Asia/Manila)', 9, 20]);
    };

    if (id.indexOf('slip:') === 0) {
      var i = Number(id.split(':')[1]);
      var a = HIS.registry.appointmentsFor(p.id)[i];
      if (!a) return null;
      head('APPOINTMENT SLIP');
      rows.push(['When: ' + a.when, 10, 15]);
      rows.push(['Type: ' + a.kind, 10, 15]);
      rows.push(['Doctor: ' + a.doctor, 10, 15]);
      rows.push(['Status: ' + a.status, 10, 15]);
      rows.push(['', 9, 16]);
      rows.push(['Present this slip at the front desk 15 minutes before your appointment.', 9, 14]);
      return { rows: rows, name: 'appointment_' + p.id + '_' + i + '.pdf' };
    }

    if (id.indexOf('statement:') === 0) {
      var bid = id.split(':')[1];
      var b = HIS.registry.invoicesFor(p.id).filter(function (x) { return x.id === bid; })[0];
      if (!b) return null;
      head('STATEMENT OF ACCOUNT - ' + b.id);
      rows.push(['Invoice date: ' + b.date + '   Department: ' + b.dept, 9, 18]);
      rows.push(['', 9, 6]);
      (b.items || []).forEach(function (r) {
        rows.push([String(r[0]).slice(0, 62), 9, 13]);
        rows.push(['    ' + r[1] + ' x ' + Number(r[2]).toLocaleString('en-PH') + ' = PHP ' + Number(r[3]).toLocaleString('en-PH'), 9, 13]);
      });
      if (!(b.items || []).length) rows.push(['Summary charges - no itemised lines recorded', 9, 13]);
      rows.push(['', 9, 8]);
      rows.push(['TOTAL: PHP ' + Number(HIS.ledger.invoiceAmount(b)).toLocaleString('en-PH'), 10, 15]);
      rows.push(['PAID: PHP ' + HIS.ledger.paidOf(b).toLocaleString('en-PH'), 10, 15]);
      rows.push(['BALANCE: PHP ' + HIS.ledger.balanceOf(b).toLocaleString('en-PH'), 10, 18]);
      rows.push(['', 9, 10]);
      rows.push(['Transactions', 10, 15]);
      HIS.ledger.forInvoice(b.id).forEach(function (t) {
        rows.push([t.id + '  ' + manilaDate(t.at, true) + '  ' + t.method + '  PHP ' +
          HIS.ledger.toPesos(t.amount).toLocaleString('en-PH') + '  ' + t.status, 9, 13]);
      });
      return { rows: rows, name: 'statement_' + b.id + '.pdf' };
    }

    if (id.indexOf('receipt:') === 0) {
      var tid = id.split(':')[1];
      var t = HIS.ledger.all().filter(function (x) { return x.id === tid; })[0];
      if (!t) return null;
      head('OFFICIAL RECEIPT - ' + t.id);
      rows.push(['Invoice: ' + t.invoiceId, 10, 15]);
      rows.push(['Date: ' + manilaDate(t.at, true), 10, 15]);
      rows.push(['Method: ' + t.method, 10, 15]);
      rows.push(['Reference: ' + (t.reference || '-'), 10, 15]);
      rows.push(['', 9, 8]);
      rows.push(['AMOUNT RECEIVED: PHP ' + HIS.ledger.toPesos(t.amount).toLocaleString('en-PH'), 12, 20]);
      rows.push(['Received by: ' + (t.cashier || '-'), 10, 15]);
      rows.push(['Status: ' + t.status + (t.status === 'pending' ? ' (electronic - not yet confirmed)' : ''), 9, 18]);
      rows.push(['', 9, 10]);
      rows.push(['DEMONSTRATION COPY - not a valid official receipt.', 8, 13]);
      return { rows: rows, name: 'receipt_' + t.id + '.pdf' };
    }

    if (id === 'plan') {
      var plan = planFor(p.id);
      if (!plan || !plan.f) return null;
      head('TREATMENT SUMMARY');
      [['Primary diagnosis', plan.f.pdx], ['Started', plan.f.started], ['Goal', plan.f.goal],
       ['Duration', plan.f.duration], ['Medications', plan.f.meds], ['Procedures', plan.f.procs],
       ['Monitoring', plan.f.monitoring], ['Next review', plan.f.review]].forEach(function (r) {
        rows.push([r[0] + ':', 9, 13]);
        rows.push(['    ' + String(r[1] || '-'), 9, 15]);
      });
      return { rows: rows, name: 'treatment_' + p.id + '.pdf' };
    }
    return null;
  }

  // ---- render ---------------------------------------------------------------------------------
  var UI = { apptMode: 'all' };

  function paint() {
    var id = location.hash.slice(1);
    if (VIEWS.indexOf(id) < 0) id = sessionAccount() ? 'home' : 'landing';

    if (PRIVATE.indexOf(id) > -1 && !sessionAccount()) { location.replace('#signin'); return; }

    // The six signed-in views are sub-views rendered into #pt-stage, all inside the single
    // `#app` section. Toggling `.pt-view` by hash name left #app hidden, so the shell has to be
    // matched to the CONTAINER id, not to the route id.
    var container = PRIVATE.indexOf(id) > -1 ? 'app' : id;
    $$('.pt-view').forEach(function (v) { v.classList.toggle('on', v.id === container); });

    if (PUBLIC.indexOf(id) > -1) {
      if ((id === 'signin' || id === 'signup') && sessionAccount()) { location.replace('#home'); return; }
      if (id === 'signin') { var e = $('#pt-signin-error'); if (e) e.textContent = ''; }
      return;
    }

    var ctx = current();
    if (!ctx) {
      // Signed in but no patient record linked: a real state, stated rather than hidden.
      $('#pt-stage').innerHTML = "<h1 class='pt-h1'>No patient record linked</h1>" +
        "<p class='pt-sub'>Your account (" + esc(sessionAccount().email) + ') is not linked to a hospital patient record yet.</p>' +
        "<div class='pt-banner'><span>Ask registration to link it, or use the Super Administrator's Accounts screen. " +
        'Until then the portal has nothing it may show you — a blank record would be worse than saying so.</span></div>' +
        "<button class='pt-btn' type='button' id='pt-nolink-out'>Sign out</button>";
      var out = $('#pt-nolink-out');
      if (out) out.onclick = function () { HIS.auth.signOut(); location.hash = '#signin'; };
      return;
    }

    var acct = sessionAccount();
    $('#pt-who').textContent = acct.name;
    $('#pt-pid').textContent = ctx.patient.id + (ctx.via === 'guardian' ? ' \u00b7 ' + ctx.link.relationship : '');
    $('#pt-av').textContent = initials(ctx.patient.name);

    $$('.pt-nav a').forEach(function (a) { a.classList.toggle('on', a.dataset.nav === id); });

    var fn = R[id] || R.home;
    $('#pt-stage').innerHTML = fn({ patient: ctx.patient, via: ctx.via, link: ctx.link, all: subjects(), ui: UI });
    bindStage();
    window.scrollTo(0, 0);
  }

  function bindStage() {
    var stage = $('#pt-stage');
    stage.onclick = function (e) {
      var t = e.target.closest('[data-subject]');
      if (t) { setSubject(t.dataset.subject); paint(); return; }
      var m = e.target.closest('[data-apptmode]');
      if (m) { UI.apptMode = m.dataset.apptmode; paint(); return; }
      var d = e.target.closest('[data-doc]');
      if (d) { download(d.dataset.doc); return; }
      if (e.target.closest('#pt-req-send')) { sendRequest(); }
    };
  }

  function download(id) {
    var ctx = current();
    if (!ctx) return;
    var doc = buildDoc(id, ctx);
    if (!doc) { HIS.kit.toast('That document is no longer available.'); return; }
    HIS.pdf.save(doc.rows, doc.name);
    A.append({
      who: sessionAccount().name, role: 'Patient',
      what: 'Downloaded ' + id, entity: 'patient:' + ctx.patient.id, before: null, after: doc.name
    });
  }

  function sendRequest() {
    var ta = $('#pt-req'), err = $('#pt-req-err');
    var text = ta ? ta.value.trim() : '';
    if (err) err.textContent = '';
    if (text.length < 8) { if (err) err.textContent = 'Describe the change in a few words first.'; return; }
    var ctx = current();
    var rows = S.get('mh_profile_requests', []);
    if (!Array.isArray(rows)) rows = [];
    rows.push({
      id: 'PR-' + String(rows.length + 1).padStart(3, '0'),
      accountId: sessionAccount().id, patientId: ctx.patient.id,
      text: text, at: new Date().toISOString(), status: 'open'
    });
    S.set('mh_profile_requests', rows);
    A.append({
      who: sessionAccount().name, role: 'Patient',
      what: 'Profile correction requested \u2014 ' + text.slice(0, 80),
      entity: 'patient:' + ctx.patient.id, before: null, after: 'open'
    });
    if (ta) ta.value = '';
    HIS.kit.toast('Request recorded for staff review.');
  }

  // ---- sign-in / sign-up / recovery -----------------------------------------------------------
  function signIn(form) {
    var email = form.email.value, pw = form.password.value, keep = $('#pt-keep').checked;
    var err = $('#pt-signin-error');
    err.textContent = '';

    var r = HIS.auth.attempt(email, pw, keep);
    if (!r.ok) { err.textContent = r.message; return; }

    if (r.account.role !== 'patient') {
      // Do not let a staff account read a patient record. End the session — but do NOT end the
      // demonstration: `signOut()` restores the sample dataset, and a wrong sign-in here should
      // leave the visitor's work intact so they can go back to the staff console.
      HIS.auth.clear();
      err.innerHTML = 'That is a staff account. <a href="index.html">Sign in to the staff console</a> instead.';
      return;
    }
    if (!r.account.patientId) { location.hash = '#home'; return; }
    setSubject(r.account.patientId);
    location.hash = '#home';
  }

  function signUp(form) {
    var err = $('#pt-signup-error');
    err.textContent = '';
    var f = new FormData(form);
    var email = String(f.get('email') || '').trim().toLowerCase();
    var pw = String(f.get('password') || '');
    var first = String(f.get('first') || '').trim();
    var last = String(f.get('last') || '').trim();
    var dob = String(f.get('dob') || '');
    var mobile = String(f.get('mobile') || '').trim();

    if (!first || !last) { err.textContent = 'Enter your first and last name.'; return; }
    if (!EMAIL.test(email)) { err.textContent = 'Enter a valid email address.'; return; }
    if (!dob) { err.textContent = 'Enter your date of birth.'; return; }
    if (!strong(pw)) { err.textContent = 'Use at least 12 characters, including letters and numbers.'; return; }
    if (!$('#pt-privacy').checked || !$('#pt-terms').checked) {
      err.textContent = 'Accept the Privacy Notice and Terms of Use to continue.'; return;
    }
    if (HIS.accounts.exists(email)) { err.textContent = 'An account with that email already exists. Sign in instead.'; return; }

    var hasId = $('#pt-hasid').checked;
    var patientId = String(f.get('pid') || '').trim().toUpperCase();
    var patient = null;

    if (hasId) {
      if (!patientId) { err.textContent = 'Enter your patient ID, or untick the box to register as a new patient.'; return; }
      patient = HIS.registry.byId(patientId);
      if (!patient) { err.textContent = 'No hospital record matches ' + patientId + '. Check the ID on your hospital card.'; return; }
      var sameLast = String(patient.last || '').toLowerCase() === last.toLowerCase();
      var sameDob = String(patient.dob || '') === dob;
      if (!sameLast || !sameDob) {
        err.textContent = 'The name and date of birth you entered do not match ' + patientId +
          '. Registration must verify you in person before this record can be linked.';
        return;
      }
      if (HIS.registry.accountFor(patient.id)) {
        err.textContent = 'That patient record already has a portal account. Use "Forgot password" or ask registration.';
        return;
      }
    } else {
      var dup = HIS.registry.duplicates({ last: last, dob: dob, mobile: mobile });
      if (dup.probable.length) {
        err.textContent = 'A patient record already exists for that name and date of birth (' +
          dup.probable[0].id + '). Enter that patient ID, or ask registration to check for a duplicate.';
        return;
      }
      var made = HIS.registry.create({
        first: first, middle: String(f.get('middle') || '').trim(), last: last,
        name: [first, String(f.get('middle') || '').trim(), last, String(f.get('suffix') || '').trim()]
          .filter(Boolean).join(' '),
        dob: dob, mobile: mobile, email: email, type: 'Outpatient', status: 'Waiting',
        createdBy: 'Patient self-registration'
      });
      if (!made.ok) { err.textContent = made.error; return; }
      patient = made.patient;
    }

    var acct = HIS.accounts.create({
      email: email, name: patient.name, role: 'patient', dept: 'Patient', title: 'Patient',
      patientId: patient.id, password: pw
    });
    if (!acct.ok) { err.textContent = acct.error; return; }

    A.append({
      who: patient.name, role: 'Patient',
      what: 'Portal account created \u2014 ' + email + (hasId ? ' linked to ' + patient.id : ' with new record ' + patient.id),
      entity: 'patient:' + patient.id, before: null, after: 'active'
    });

    var r = HIS.auth.attempt(email, pw, true);
    if (!r.ok) { err.textContent = r.message; return; }
    setSubject(patient.id);
    form.reset();
    location.hash = '#home';
  }

  // ---- recovery -------------------------------------------------------------------------------
  // A static site cannot send mail. The previous flow generated a 6-digit code in the page and
  // asked the user to retype it, which looked like verification and verified nothing. This version
  // states what it actually does.
  function stepTo(n) {
    $$('.pt-step').forEach(function (s) {
      var on = Number(s.dataset.step) === n;
      s.classList.toggle('on', on);
      if (on) s.removeAttribute('inert'); else s.setAttribute('inert', '');
    });
  }
  function initForgot() {
    var send = $('#pt-send');
    if (!send) return;
    send.onclick = function () {
      var email = String($('#pt-recv').value || '').trim().toLowerCase();
      var err = $('#pt-f1err');
      err.textContent = '';
      if (!EMAIL.test(email)) { err.textContent = 'Enter a valid email address.'; return; }
      var acct = HIS.accounts.byEmail(email);
      stepTo(2);
      $('#pt-otp-demo').hidden = false;
      // Same wording either way: this page is public and must not disclose whether an account exists.
      $('#pt-otp-demo').innerHTML = '<b>No email is sent.</b> ' +
        'A password reset is performed by the Super Administrator from the Accounts screen. ' +
        (acct ? 'Ask them to reset the password for this address.' : 'Ask them to check the address on file.');
    };
    $('#pt-verify').onclick = function () {
      $('#pt-f2err').textContent = 'Verification codes are not sent from this environment, so this step cannot be completed.';
    };
    $('#pt-back-signin').onclick = function () { location.hash = '#signin'; };
  }

  // ---- boot -----------------------------------------------------------------------------------
  function boot() {
    // M5: delete the retired private portal store from any browser that still holds it. The
    // portal now authenticates against `mh_accounts`, so these keys are dead weight that would
    // otherwise keep a second, orphaned identity alive in storage.
    ['mh_portal_accounts', 'mh_portal_reset', 'mh_portal_session', 'mh_portal_session_tmp'].forEach(function (k) {
      try { localStorage.removeItem(k); } catch (e) { /* blocked */ }
      try { sessionStorage.removeItem(k); } catch (e) { /* blocked */ }
    });

    var form = $('#pt-signin');
    if (form) form.onsubmit = function (e) { e.preventDefault(); signIn(form); };

    var su = $('#pt-signup');
    if (su) {
      su.onsubmit = function (e) { e.preventDefault(); signUp(su); };
      var hasid = $('#pt-hasid'), fields = $('#pt-idfields');
      var sync = function () { fields.style.display = hasid.checked ? '' : 'none'; };
      hasid.onchange = sync; sync();
      var pw = $('#pt-pw');
      if (pw) pw.oninput = function () {
        var hint = $('#pt-pw-hint');
        hint.textContent = strong(pw.value) ? 'Password strength: acceptable.'
          : 'Use at least 12 characters, including letters and numbers.';
        hint.className = 'pt-hint ' + (strong(pw.value) ? 'strong' : 'weak');
      };
    }

    var fg = $('#pt-forgot');
    if (fg) fg.onclick = function () { location.hash = '#forgot'; stepTo(1); };
    initForgot();

    var out = $('#pt-signout');
    if (out) out.onclick = function () {
      HIS.auth.signOut();
      try { sessionStorage.removeItem(SUBJECT); } catch (e) { /* private mode */ }
      location.hash = '#signin';
      if (form) form.reset();
    };

    window.addEventListener('hashchange', paint);
    paint();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
