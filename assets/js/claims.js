// PhilHealth / HMO claim lifecycle (M10).
//
// WHAT THIS IS
// A claim is the hospital asking a payer — PhilHealth or an HMO — to take part of an invoice off
// the patient. M7 could record a "coverage" amount against an invoice, but there was no claim
// behind it: no documents, no submission date, no decision, no follow-up, and no way to tell an
// approval from a settlement.
//
// THE RULE THAT MATTERS
// An approval is a promise. A settlement is money. They are different states, and only settlement
// touches the ledger. Recording an approval as a payment would inflate collections by money the
// hospital has not received; the M7 ledger already refuses to count coverage as collected cash, and
// this module keeps that boundary by posting a `coverage` transaction at settlement only.
//
// SETTLEMENT IS IDEMPOTENT. `settle()` passes the claim id to the ledger as `sourceId`; the ledger
// refuses a second transaction with the same source. A claim that is already settled cannot be
// settled again, so a double click cannot double-credit an invoice.
//
// THIS IS A SIMULATION. Nothing here connects to PhilHealth eClaims, submits a claim, or verifies
// eligibility in real time. See docs/CLAIMS.md for what a real integration would require.
(function () {
  var KEY = HIS.store.KEY.claims;
  // The demo runs on a fixed clock: the header of every screen reads Aug 31, 2026. Follow-up
  // comparisons use the same date, not the wall clock, or every seeded claim would look overdue.
  var TODAY = '2026-08-31';

  // ---- statuses -------------------------------------------------------------------------------
  // `open` claims are still being worked. `tone` maps to the shared badge colours in components.css.
  var STATUS = {
    'draft': { label: 'Draft', short: 'Draft', tone: '', open: true },
    'pending-documentation': { label: 'Pending documentation', short: 'Docs pending', tone: 'off', open: true },
    'ready-for-review': { label: 'Ready for review', short: 'For review', tone: 'in', open: true },
    'ready-for-submission': { label: 'Ready for submission', short: 'For submission', tone: 'in', open: true },
    'submitted': { label: 'Submitted', short: 'Submitted', tone: 'in', open: true },
    'under-review': { label: 'Under review', short: 'Under review', tone: 'off', open: true },
    'additional-info': { label: 'Additional information required', short: 'Info needed', tone: 'off', open: true },
    'approved': { label: 'Approved', short: 'Approved', tone: 'ok', open: true },
    'partially-approved': { label: 'Partially approved', short: 'Part approved', tone: 'ok', open: true },
    'denied': { label: 'Denied', short: 'Denied', tone: 'red', open: false },
    'appeal': { label: 'Appeal requested', short: 'On appeal', tone: 'off', open: true },
    'settled': { label: 'Settled', short: 'Settled', tone: 'ok', open: false },
    'closed': { label: 'Closed', short: 'Closed', tone: '', open: false }
  };
  var ORDER = ['draft', 'pending-documentation', 'ready-for-review', 'ready-for-submission', 'submitted',
    'under-review', 'additional-info', 'approved', 'partially-approved', 'denied', 'appeal', 'settled', 'closed'];

  // ---- documents ------------------------------------------------------------------------------
  var DOCUMENTS = {
    philhealth: ['Member Data Record (MDR)', 'PhilHealth Claim Form 1 (CF1)', 'Statement of account',
      'Medical certificate', 'Procedure or operative record'],
    hmo: ['Letter of Authorisation (LOA)', 'Member ID', 'Statement of account', 'Diagnosis and procedure summary']
  };

  // ---- transitions ----------------------------------------------------------------------------
  // `roles` are RBAC keys. `requires` names the payload fields the transition cannot proceed
  // without, so a denial can never be recorded without a reason.
  var TRANSITIONS = [
    { from: 'draft', to: 'pending-documentation', action: 'prepare', label: 'Request documents', roles: ['finance', 'superadmin'] },
    { from: 'draft', to: 'ready-for-review', action: 'send-review', label: 'Send for review', roles: ['finance', 'superadmin'], requires: 'documents' },
    { from: 'pending-documentation', to: 'ready-for-review', action: 'docs-complete', label: 'Documents complete', roles: ['finance', 'superadmin'], requires: 'documents' },
    { from: 'pending-documentation', to: 'draft', action: 'back-draft', label: 'Return to draft', roles: ['finance', 'superadmin'] },
    { from: 'ready-for-review', to: 'ready-for-submission', action: 'verify', label: 'Verify for submission', roles: ['finance', 'superadmin'] },
    { from: 'ready-for-review', to: 'pending-documentation', action: 'reject-review', label: 'Send back for documents', roles: ['finance', 'superadmin'], requires: ['reason'] },
    { from: 'ready-for-submission', to: 'submitted', action: 'submit', label: 'Record submission', roles: ['finance', 'superadmin'], requires: ['reference'] },
    { from: 'submitted', to: 'under-review', action: 'acknowledge', label: 'Payer acknowledged', roles: ['finance', 'superadmin'] },
    { from: 'under-review', to: 'additional-info', action: 'request-info', label: 'Additional information required', roles: ['finance', 'superadmin'], requires: ['reason'] },
    { from: 'additional-info', to: 'ready-for-submission', action: 'resubmit', label: 'Information provided', roles: ['finance', 'superadmin'] },
    { from: 'under-review', to: 'approved', action: 'approve', label: 'Record approval', roles: ['finance', 'superadmin'], requires: ['approvedAmount'] },
    { from: 'under-review', to: 'partially-approved', action: 'partial', label: 'Record partial approval', roles: ['finance', 'superadmin'], requires: ['approvedAmount', 'reason'] },
    { from: 'under-review', to: 'denied', action: 'deny', label: 'Record denial', roles: ['finance', 'superadmin'], requires: ['reason'] },
    { from: 'denied', to: 'appeal', action: 'appeal', label: 'File appeal', roles: ['finance', 'superadmin'], requires: ['reason'] },
    { from: 'appeal', to: 'under-review', action: 'reopen', label: 'Appeal accepted for review', roles: ['finance', 'superadmin'] },
    { from: 'approved', to: 'settled', action: 'settle', label: 'Record settlement', roles: ['finance', 'superadmin'] },
    { from: 'partially-approved', to: 'settled', action: 'settle', label: 'Record settlement', roles: ['finance', 'superadmin'] },
    { from: 'approved', to: 'closed', action: 'close', label: 'Close without settlement', roles: ['finance', 'superadmin'], requires: ['reason'] },
    { from: 'partially-approved', to: 'closed', action: 'close', label: 'Close without settlement', roles: ['finance', 'superadmin'], requires: ['reason'] },
    { from: 'denied', to: 'closed', action: 'close', label: 'Close claim', roles: ['finance', 'superadmin'] },
    { from: 'settled', to: 'closed', action: 'close', label: 'Close claim', roles: ['finance', 'superadmin'] }
  ];

  function role() {
    return window.HIS && HIS.rbac ? HIS.rbac.key() : null;
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

  // ---- seed -----------------------------------------------------------------------------------
  function docsFor(payerType, received) {
    return (DOCUMENTS[payerType] || []).map(function (name, i) {
      var got = received === true || (Array.isArray(received) && received.indexOf(i) > -1);
      return { name: name, required: true, received: got, receivedAt: got ? '2026-08-28T10:00:00+08:00' : null };
    });
  }

  function base(o) {
    return {
      id: o.id, patientId: o.patientId, patientName: o.patientName,
      invoiceId: o.invoiceId, payer: o.payer, payerType: o.payerType, memberRef: o.memberRef,
      coverage: o.coverage,
      claimAmount: o.claimAmount, requestedAmount: o.requestedAmount,
      approvedAmount: o.approvedAmount || 0, patientShare: o.patientShare || 0,
      documents: o.documents,
      preparedAt: o.preparedAt || null, submittedAt: o.submittedAt || null,
      followUpAt: o.followUpAt || null, officer: o.officer || 'Rowena Lim',
      status: o.status, history: o.history || [], notes: o.notes || [],
      settlement: o.settlement || null, reference: o.reference || ''
    };
  }

  function seed() {
    var now = '2026-08-31T09:00:00+08:00';
    var claims = [
      base({
        id: 'CLM-2026-0001', patientId: 'PT-99213', patientName: 'Isabel Geliz V. Ramos',
        invoiceId: 'BL-8801', payer: 'PhilHealth', payerType: 'philhealth', memberRef: '12-345678901-2',
        coverage: { type: 'case-rate', description: 'Case rate — medical admission, no complication' },
        claimAmount: 4000, requestedAmount: 4000, approvedAmount: 4000, patientShare: 3360,
        documents: docsFor('philhealth', true),
        preparedAt: '2026-08-26T09:10:00+08:00', submittedAt: '2026-08-27T14:30:00+08:00',
        followUpAt: '2026-09-05', status: 'approved', officer: 'Rowena Lim',
        reference: 'PH-2026-08-4471',
        history: [
          { at: '2026-08-26T09:10:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'draft', to: 'pending-documentation', reason: 'Documents requested from the ward' },
          { at: '2026-08-27T11:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'pending-documentation', to: 'ready-for-review', reason: 'Five documents received' },
          { at: '2026-08-27T13:40:00+08:00', by: 'Atty. Ramon Silva', role: 'Hospital Administrator', from: 'ready-for-review', to: 'ready-for-submission', reason: '' },
          { at: '2026-08-27T14:30:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'ready-for-submission', to: 'submitted', reason: 'PH-2026-08-4471' },
          { at: '2026-08-29T09:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'submitted', to: 'under-review', reason: '' },
          { at: '2026-08-31T08:15:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'under-review', to: 'approved', reason: 'Approved at the full case rate' }
        ]
      }),
      base({
        id: 'CLM-2026-0002', patientId: 'PT-99211', patientName: 'Eleanor Whitfield',
        invoiceId: 'BL-8798', payer: 'Maxicare', payerType: 'hmo', memberRef: 'MX-889-221-04',
        coverage: { type: 'loa', description: 'Letter of authorisation — outpatient neurology work-up' },
        claimAmount: 52800, requestedAmount: 52800, approvedAmount: 0, patientShare: 52800,
        documents: docsFor('hmo', true),
        preparedAt: '2026-08-27T10:00:00+08:00', submittedAt: '2026-08-28T09:20:00+08:00',
        followUpAt: '2026-09-10', status: 'denied', officer: 'Rowena Lim',
        reference: 'MX-CLM-77120',
        history: [
          { at: '2026-08-27T10:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'draft', to: 'ready-for-review', reason: '' },
          { at: '2026-08-27T16:00:00+08:00', by: 'Atty. Ramon Silva', role: 'Hospital Administrator', from: 'ready-for-review', to: 'ready-for-submission', reason: '' },
          { at: '2026-08-28T09:20:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'ready-for-submission', to: 'submitted', reason: 'MX-CLM-77120' },
          { at: '2026-08-29T11:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'submitted', to: 'under-review', reason: '' },
          { at: '2026-08-30T15:45:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'under-review', to: 'denied', reason: 'Procedure excluded: the plan covers inpatient neurology only.' }
        ]
      }),
      base({
        id: 'CLM-2026-0003', patientId: 'PT-99211', patientName: 'Eleanor Whitfield',
        invoiceId: 'BL-8798', payer: 'PhilHealth', payerType: 'philhealth', memberRef: '12-345678911-4',
        coverage: { type: 'case-rate', description: 'Case rate — outpatient diagnostic package' },
        claimAmount: 28000, requestedAmount: 28000, approvedAmount: 0,
        documents: docsFor('philhealth', [0, 1, 2]),
        preparedAt: '2026-08-28T08:30:00+08:00', submittedAt: '2026-08-29T10:00:00+08:00',
        followUpAt: '2026-08-29', status: 'under-review', officer: 'Rowena Lim',
        reference: 'PH-2026-08-4502',
        history: [
          { at: '2026-08-28T08:30:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'draft', to: 'pending-documentation', reason: 'Medical certificate and procedure record outstanding' },
          { at: '2026-08-28T14:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'pending-documentation', to: 'ready-for-review', reason: 'Three of five documents on file' },
          { at: '2026-08-29T09:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'ready-for-submission', to: 'submitted', reason: 'PH-2026-08-4502' },
          { at: '2026-08-30T08:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'submitted', to: 'under-review', reason: '' }
        ]
      }),
      base({
        id: 'CLM-2026-0004', patientId: 'PT-99213', patientName: 'Isabel Geliz V. Ramos',
        invoiceId: 'BL-8801', payer: 'Maxicare', payerType: 'hmo', memberRef: 'MX-771-330-19',
        coverage: { type: 'loa', description: 'Letter of authorisation — professional fees' },
        claimAmount: 3000, requestedAmount: 3000, approvedAmount: 0, patientShare: 7360,
        documents: docsFor('hmo', [0, 2]),
        preparedAt: '2026-08-30T09:00:00+08:00',
        followUpAt: '2026-08-30', status: 'additional-info', officer: 'Rowena Lim',
        reference: 'MX-CLM-77301',
        history: [
          { at: '2026-08-30T09:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'draft', to: 'ready-for-review', reason: '' },
          { at: '2026-08-30T10:00:00+08:00', by: 'Atty. Ramon Silva', role: 'Hospital Administrator', from: 'ready-for-review', to: 'ready-for-submission', reason: '' },
          { at: '2026-08-30T11:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'ready-for-submission', to: 'submitted', reason: 'MX-CLM-77301' },
          { at: '2026-08-31T09:30:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'submitted', to: 'under-review', reason: '' },
          { at: '2026-08-31T15:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'under-review', to: 'additional-info', reason: 'Member ID image is unreadable; a clear scan is required.' }
        ]
      }),
      base({
        id: 'CLM-2026-0005', patientId: 'PT-99213', patientName: 'Isabel Geliz V. Ramos',
        invoiceId: 'BL-8801', payer: 'PhilHealth', payerType: 'philhealth', memberRef: '12-345678901-2',
        coverage: { type: 'case-rate', description: 'Case rate — first tranche, professional fees' },
        claimAmount: 1500, requestedAmount: 1500, approvedAmount: 1500, patientShare: 5860,
        documents: docsFor('philhealth', true),
        preparedAt: '2026-08-20T09:00:00+08:00', submittedAt: '2026-08-21T10:00:00+08:00',
        followUpAt: '2026-08-28', status: 'approved', officer: 'Rowena Lim',
        reference: 'PH-2026-08-4310',
        history: [
          { at: '2026-08-21T10:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'draft', to: 'ready-for-review', reason: '' },
          { at: '2026-08-21T11:00:00+08:00', by: 'Atty. Ramon Silva', role: 'Hospital Administrator', from: 'ready-for-review', to: 'ready-for-submission', reason: '' },
          { at: '2026-08-21T13:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'ready-for-submission', to: 'submitted', reason: 'PH-2026-08-4310' },
          { at: '2026-08-24T09:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'submitted', to: 'under-review', reason: '' },
          { at: '2026-08-26T10:00:00+08:00', by: 'Rowena Lim', role: 'Finance / Accounting', from: 'under-review', to: 'approved', reason: 'Approved at the case rate; awaiting remittance' }
        ]
      })
    ];

    // NOTHING IS PRE-SETTLED. A settlement moves money, and a seed that posts coverage would move
    // the demo's billing totals as a side effect of opening a screen. Settlement is a deliberate
    // action: the user records it on the claim, and only then does a coverage row appear.

    var state = { claims: claims, version: 1, seededAt: now };
    HIS.store.set(KEY, state);
    return state;
  }

  function state() {
    var s = HIS.store.get(KEY, null);
    if (!s || !Array.isArray(s.claims)) s = seed();
    return s;
  }
  function save(s) { HIS.store.set(KEY, s); return s; }
  function all() { return state().claims.slice(); }
  function get(id) { return state().claims.filter(function (c) { return c.id === id; })[0] || null; }
  // The sequence is the LAST hyphen-separated segment. Stripping every non-digit (as this did)
  // concatenates the year into the sequence: 0005 -> 20260005 -> 202620260006, and within a few
  // creates the number exceeds Number.MAX_SAFE_INTEGER, two claims collide, and a transition acts
  // on whichever claim `get()` finds first. Caught by the M10 acceptance audit.
  function nextId() {
    var max = all().reduce(function (m, c) {
      var seg = String(c.id).split('-').pop();
      var v = parseInt(seg, 10);
      return isNaN(v) ? m : Math.max(m, v);
    }, 0);
    return 'CLM-2026-' + String(max + 1).padStart(4, '0');
  }

  // ---- reads ---------------------------------------------------------------------------------
  function documentsComplete(claim) {
    return (claim.documents || []).every(function (d) { return !d.required || d.received; });
  }
  function outstandingDocs(claim) {
    return (claim.documents || []).filter(function (d) { return d.required && !d.received; });
  }
  function available(claim) {
    var r = role();
    return TRANSITIONS.filter(function (t) {
      return t.from === claim.status && t.roles.indexOf(r) > -1;
    });
  }
  function can(action, claim) {
    return available(claim).some(function (t) { return t.action === action; });
  }

  // ---- writes --------------------------------------------------------------------------------
  function addHistory(claim, from, to, reason) {
    claim.history = claim.history || [];
    claim.history.push({
      at: new Date().toISOString(), by: actor(), role: roleLabel(),
      from: from, to: to, reason: reason || ''
    });
  }

  function create(input) {
    input = input || {};
    var r = role();
    if (['finance', 'superadmin'].indexOf(r) < 0) {
      return { ok: false, error: 'Your role cannot create a claim.' };
    }
    var patient = input.patientId ? (HIS.registry ? HIS.registry.byId(input.patientId) : null) : null;
    var bill = (HIS.billing.bills || []).filter(function (b) { return b.id === input.invoiceId; })[0];
    if (!bill) return { ok: false, error: 'Choose the invoice this claim is for.' };
    var amount = Number(input.requestedAmount);
    if (!isFinite(amount) || amount <= 0) return { ok: false, error: 'Enter a claim amount greater than zero.' };
    if (amount > bill.amount + 1e-9) return { ok: false, error: 'A claim cannot exceed the invoice total of ' + peso(bill.amount) + '.' };
    if (!String(input.payer || '').trim()) return { ok: false, error: 'Choose the payer.' };
    if (!String(input.memberRef || '').trim()) return { ok: false, error: 'Enter the member reference.' };
    var payerType = input.payerType === 'hmo' ? 'hmo' : 'philhealth';

    var s = state();
    var claim = base({
      id: nextId(), patientId: input.patientId || bill.pt,
      patientName: patient ? patient.name : bill.full,
      invoiceId: bill.id, payer: input.payer, payerType: payerType,
      memberRef: input.memberRef,
      coverage: { type: payerType === 'hmo' ? 'loa' : 'case-rate', description: input.coverage || (payerType === 'hmo' ? 'Letter of authorisation' : 'Case rate') },
      claimAmount: amount, requestedAmount: amount, approvedAmount: 0,
      documents: docsFor(payerType, input.documents || []),
      preparedAt: new Date().toISOString(),
      followUpAt: input.followUpAt || null,
      officer: actor(), status: 'draft', reference: ''
    });
    claim.history.push({ at: new Date().toISOString(), by: actor(), role: roleLabel(), from: null, to: 'draft', reason: 'Claim created' });
    s.claims.push(claim);
    save(s);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Claim created \u2014 ' + claim.id + ' for ' + claim.payer + ' on ' + claim.invoiceId + ', ' + peso(claim.requestedAmount),
        entity: 'claim:' + claim.id, before: '\u2014', after: 'draft'
      });
    }
    return { ok: true, claim: claim };
  }

  function transition(id, action, payload) {
    payload = payload || {};
    var s = state();
    var claim = s.claims.filter(function (c) { return c.id === id; })[0];
    if (!claim) return { ok: false, error: 'Claim not found.' };
    var t = TRANSITIONS.filter(function (x) { return x.from === claim.status && x.action === action; })[0];
    if (!t) return { ok: false, error: 'That action does not apply while the claim is ' + STATUS[claim.status].label.toLowerCase() + '.' };
    if (t.roles.indexOf(role()) < 0) return { ok: false, error: 'Your role cannot perform that step.' };
    if (t.requires === 'documents' && !documentsComplete(claim)) {
      return { ok: false, error: outstandingDocs(claim).length + ' required document(s) are still missing: ' + outstandingDocs(claim).map(function (d) { return d.name; }).join(', ') + '.' };
    }
    if (Array.isArray(t.requires)) {
      for (var i = 0; i < t.requires.length; i++) {
        var k = t.requires[i];
        if (payload[k] == null || String(payload[k]).trim() === '') {
          return { ok: false, error: 'This step needs ' + k.replace(/([A-Z])/g, ' $1').toLowerCase() + '.' };
        }
      }
    }

    // Settlement is the only transition that moves money.
    //
    // Coverage is capped at what is still outstanding. A payer can approve more than the patient
    // owes — because the patient paid part of the bill, or an earlier claim already covered it —
    // and posting the full approval would drive the invoice below zero. The excess is recorded on
    // the claim as `unapplied`, separately from the ledger, so it is visible without inventing a
    // cash refund or a negative balance.
    if (action === 'settle') {
      if (!claim.approvedAmount || claim.approvedAmount <= 0) {
        return { ok: false, error: 'There is no approved amount to settle.' };
      }
      if (claim.settlement) return { ok: false, error: 'This claim is already settled by ' + claim.settlement.transactionId + '.' };
      var bill = (HIS.billing.bills || []).filter(function (b) { return b.id === claim.invoiceId; })[0];
      if (!bill) return { ok: false, error: 'The invoice behind this claim no longer exists.' };
      var balance = HIS.ledger.balanceOf(bill);
      var applied = Math.round(Math.min(claim.approvedAmount, Math.max(0, balance)) * 100) / 100;
      var unapplied = Math.round((claim.approvedAmount - applied) * 100) / 100;
      if (applied <= 0) {
        return { ok: false, error: 'Nothing is outstanding on ' + bill.id + '; the ' + peso(claim.approvedAmount) + ' approval cannot be applied.' };
      }
      var res = HIS.ledger.recordCoverage({
        invoiceId: claim.invoiceId, kind: 'coverage', amount: applied,
        payer: claim.payer, reference: claim.id, basis: claim.coverage.description,
        sourceId: claim.id
      });
      if (!res.ok) return { ok: false, error: res.error };
      claim.settlement = {
        transactionId: res.transaction.id, amount: applied, unapplied: unapplied, at: res.transaction.at
      };
      claim.unappliedAmount = unapplied;
      claim.unappliedReason = unapplied > 0
        ? 'Approved ' + peso(claim.approvedAmount) + ' but only ' + peso(applied) + ' was outstanding on ' + bill.id + '.'
        : '';
    }

    if (action === 'approve' || action === 'partial') {
      var approved = Number(payload.approvedAmount);
      if (!isFinite(approved) || approved < 0) return { ok: false, error: 'Enter the approved amount.' };
      if (approved > claim.requestedAmount + 1e-9) {
        return { ok: false, error: 'An approval cannot exceed the ' + peso(claim.requestedAmount) + ' requested.' };
      }
      claim.approvedAmount = Math.round(approved * 100) / 100;
      var bill = (HIS.billing.bills || []).filter(function (b) { return b.id === claim.invoiceId; })[0];
      // What the patient still owes after this claim, measured against what is outstanding now —
      // not against the original charge, which would ignore payments already received.
      var outstanding = bill ? HIS.ledger.balanceOf(bill) : 0;
      claim.patientShare = Math.max(0, Math.round((outstanding - claim.approvedAmount) * 100) / 100);
      claim.decisionAt = new Date().toISOString();
    }

    var from = claim.status;
    claim.status = t.to;
    if (t.to === 'submitted') {
      claim.submittedAt = new Date().toISOString();
      if (payload.reference) claim.reference = String(payload.reference);
    }
    addHistory(claim, from, t.to, payload.reason || payload.note || '');
    save(s);
    if (window.HIS.audit) {
      HIS.audit.append({
        who: actor(), role: roleLabel(),
        what: 'Claim ' + claim.id + ' \u2014 ' + t.label + ' (' + STATUS[from].label + ' \u2192 ' + STATUS[t.to].label + ')' +
          (payload.reason ? ' \u00b7 ' + payload.reason : ''),
        entity: 'claim:' + claim.id, before: STATUS[from].label, after: STATUS[t.to].label
      });
    }
    return { ok: true, claim: claim, transition: t };
  }

  function setDocument(id, index, received) {
    var s = state();
    var claim = s.claims.filter(function (c) { return c.id === id; })[0];
    if (!claim) return { ok: false, error: 'Claim not found.' };
    var d = claim.documents[index];
    if (!d) return { ok: false, error: 'Document not found.' };
    d.received = !!received;
    d.receivedAt = received ? new Date().toISOString() : null;
    save(s);
    return { ok: true, claim: claim };
  }

  function addNote(id, text) {
    var s = state();
    var claim = s.claims.filter(function (c) { return c.id === id; })[0];
    if (!claim) return { ok: false, error: 'Claim not found.' };
    if (!String(text || '').trim()) return { ok: false, error: 'Write the note first.' };
    claim.notes = claim.notes || [];
    claim.notes.push({ at: new Date().toISOString(), by: actor(), text: String(text).trim() });
    save(s);
    return { ok: true, claim: claim };
  }

  // ---- dashboard -----------------------------------------------------------------------------
  function byStatus(status) { return all().filter(function (c) { return c.status === status; }); }
  function sumOf(list, f) { return list.reduce(function (t, c) { return t + (Number(f(c)) || 0); }, 0); }

  function stats() {
    var list = all();
    var pending = list.filter(function (c) { return STATUS[c.status].open; });
    var awaiting = list.filter(function (c) { return STATUS[c.status].open && (c.status === 'pending-documentation' || outstandingDocs(c).length > 0); });
    var submitted = list.filter(function (c) { return ['submitted', 'under-review', 'additional-info', 'appeal'].indexOf(c.status) > -1; });
    var underReview = list.filter(function (c) { return c.status === 'under-review'; });
    var approved = list.filter(function (c) { return c.status === 'approved' || c.status === 'partially-approved'; });
    var denied = list.filter(function (c) { return c.status === 'denied'; });
    var settled = list.filter(function (c) { return c.status === 'settled'; });
    var closed = list.filter(function (c) { return c.status === 'closed'; });
    var followUps = list.filter(function (c) {
      return STATUS[c.status].open && c.followUpAt && c.followUpAt <= TODAY;
    });
    return {
      total: list.length,
      pending: pending.length,
      awaitingDocuments: awaiting.length,
      submitted: submitted.length,
      underReview: underReview.length,
      approved: approved.length,
      denied: denied.length,
      settled: settled.length,
      closed: closed.length,
      followUps: followUps,
      outstanding: Math.round((sumOf(approved, function (c) { return c.approvedAmount; }) +
        sumOf(submitted, function (c) { return c.requestedAmount; })) * 100) / 100,
      approvedNotSettled: Math.round(sumOf(approved, function (c) { return c.approvedAmount; }) * 100) / 100,
      deniedValue: Math.round(sumOf(denied, function (c) { return c.requestedAmount; }) * 100) / 100,
      byStatus: ORDER.reduce(function (m, k) { m[k] = byStatus(k).length; return m; }, {})
    };
  }

  function peso(n) {
    return '\u20b1' + Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function reset() { HIS.store.remove(KEY); return state(); }

  HIS.claims = {
    KEY: KEY, TODAY: TODAY, STATUS: STATUS, ORDER: ORDER, DOCUMENTS: DOCUMENTS, TRANSITIONS: TRANSITIONS,
    all: all, get: get, create: create, transition: transition, available: available, can: can,
    documentsComplete: documentsComplete, outstandingDocs: outstandingDocs,
    setDocument: setDocument, addNote: addNote, stats: stats,
    seed: seed, reset: reset
  };
})();
