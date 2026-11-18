# Claims workflow

**This is a simulation.** Nothing here connects to PhilHealth eClaims, submits a claim, verifies
eligibility, or receives a real decision. It is a working model of the workflow a hospital runs
internally around a payer, built so the financial boundary can be inspected and tested.

Implementation: `assets/js/claims.js` (record, state machine, transitions), `assets/js/claims-page.js`
(screen), `claims.html`. Money: `HIS.ledger`. Tests: `scripts/claims-check.mjs`.

---

## 1. What a claim is

A claim is the hospital asking a payer to take part of an invoice off the patient. It is not a
payment, and it is not a discount: it has a payer, a member reference, a document set, a submission,
a decision and a settlement.

```
{
  id, patientId, patientName, invoiceId,
  payer, payerType: 'philhealth' | 'hmo', memberRef,
  coverage: { type: 'case-rate' | 'loa' | 'plan', description },
  claimAmount, requestedAmount, approvedAmount, patientShare,
  documents: [{ name, required, received, receivedAt }],
  preparedAt, submittedAt, followUpAt, officer,
  status, history: [{ at, by, role, from, to, reason }],
  notes: [{ at, by, text }],
  settlement: { transactionId, amount, at } | null,
  reference
}
```

`patientShare` is what the patient still owes after **this** claim. It is indicative: the invoice
balance is authoritative and comes from the ledger.

Document sets are per payer type:

* **PhilHealth** — Member Data Record, Claim Form 1, statement of account, medical certificate,
  procedure or operative record.
* **HMO** — Letter of Authorisation, member ID, statement of account, diagnosis and procedure
  summary.

A claim cannot leave `pending-documentation` or be sent for review while a required document is
missing.

---

## 2. Statuses

| Status | Meaning | Open |
|---|---|---|
| Draft | Created, nothing done | yes |
| Pending documentation | Waiting on the ward or the patient | yes |
| Ready for review | Documents complete, awaiting internal check | yes |
| Ready for submission | Verified, awaiting transmission | yes |
| Submitted | Recorded as sent to the payer (simulated) | yes |
| Under review | Payer acknowledged | yes |
| Additional information required | Payer asked for more | yes |
| Approved | Payer approved the full requested amount | yes |
| Partially approved | Payer approved less, with a reason | yes |
| Denied | Payer refused, with a reason | no |
| Appeal requested | Hospital is contesting a denial | yes |
| Settled | Money received; coverage posted to the ledger | no |
| Closed | Finished without settlement, or after settlement | no |

---

## 3. Transitions and roles

| From | Action | To | Roles | Requires |
|---|---|---|---|---|
| Draft | Request documents | Pending documentation | cashier, finance, superadmin | — |
| Draft | Send for review | Ready for review | cashier, finance, superadmin | all documents |
| Pending documentation | Documents complete | Ready for review | cashier, finance, superadmin | all documents |
| Pending documentation | Return to draft | Draft | cashier, finance, superadmin | — |
| Ready for review | Verify for submission | Ready for submission | finance, superadmin | — |
| Ready for review | Send back for documents | Pending documentation | finance, superadmin | reason |
| Ready for submission | Record submission | Submitted | cashier, finance, superadmin | payer reference |
| Submitted | Payer acknowledged | Under review | cashier, finance, superadmin | — |
| Under review | Additional information required | Additional information | finance, superadmin | reason |
| Additional information | Information provided | Ready for submission | cashier, finance, superadmin | — |
| Under review | Record approval | Approved | finance, superadmin | approved amount |
| Under review | Record partial approval | Partially approved | finance, superadmin | approved amount + reason |
| Under review | Record denial | Denied | finance, superadmin | reason |
| Denied | File appeal | Appeal requested | finance, superadmin | reason |
| Appeal requested | Appeal accepted for review | Under review | finance, superadmin | — |
| Approved / Partially approved | Record settlement | Settled | finance, superadmin | — |
| Approved / Partially approved | Close without settlement | Closed | finance, superadmin | reason |
| Denied / Settled | Close claim | Closed | finance, superadmin | — |

An auditor has read access and no transitions. A cashier can prepare and submit but cannot record a
payer decision. Every transition is written to the claim's history **and** to the audit log with the
before and after status.

A denial, a partial approval and a write-off cannot be recorded without a reason. An approval cannot
exceed the amount requested.

---

## 4. The financial boundary

This is the part that matters.

* **Approval moves no money.** `approved` sets `approvedAmount` and `patientShare` and posts nothing
  to the ledger. The invoice balance is unchanged.
* **Settlement is the only transition that posts.** It calls
  `HIS.ledger.recordCoverage({ kind: 'coverage', sourceId: claim.id, ... })`, which creates a
  `coverage` transaction — never a `payment`. Collections therefore never include the payer's share.
* **Settlement is idempotent.** The claim id is the ledger's `sourceId`, and the ledger refuses a
  second transaction with the same source. A double click, a retry or a re-opened tab cannot credit
  the invoice twice. The claim also refuses to settle when `settlement` is already set.
* **Settlement cannot exceed the balance.** The ledger refuses a coverage larger than the
  outstanding balance, so a claim against an already-paid invoice cannot over-credit it.

Worked example, BL-8801 (₱17,360 total, ₱10,000 already collected):

| Step | Invoice balance | Collected | Covered |
|---|---|---|---|
| Before | 7,360.00 | 10,000.00 | 0.00 |
| Claim approved for 4,000 | 7,360.00 | 10,000.00 | 0.00 |
| Claim settled | 3,360.00 | 10,000.00 | 4,000.00 |

---

## 5. Dashboard definitions

| Tile | Definition |
|---|---|
| Open claims | Claims whose status is flagged open |
| Awaiting documents | Open claims with at least one required document missing, or in `pending-documentation` |
| Submitted / under review | `submitted`, `under-review`, `additional-info`, `appeal` |
| Outstanding claim value | Approved but unsettled **plus** the requested amount of everything still with the payer |
| Approved | `approved` + `partially-approved` — a promise, not cash |
| Denied | `denied`, with the refused value |
| Settled | `settled` only; closed claims are counted separately |
| Follow-ups due | Open claims whose `followUpAt` is on or before the demo date (2026-08-31) |

The demo runs on a fixed clock. Using the wall clock would mark every seeded claim overdue the
moment the calendar moved past August 2026.

---

## 6. What a real integration would require

Not implemented, and not simulated as if it were:

1. **Accreditation and credentials** — a PhilHealth eClaims account, a facility code, and per-officer
   credentials with two-factor authentication.
2. **Transport** — the eClaims SOAP/REST endpoints, mutual TLS, signed payloads, retry with
   idempotency keys, and a store-and-forward queue for outages.
3. **Eligibility** — a real-time member verification call (PhilHealth's eligibility service or the
   HMO's API), not a member number typed from a card.
4. **Document interchange** — scanned documents attached to the claim in the payer's required format
   and resolution, with a hash so the submitted set can be proven later.
5. **Adjudication feed** — the payer's decision, case rate applied, deductions and denial codes
   ingested and mapped onto `approvedAmount` and `reason` rather than typed by an officer.
6. **Remittance matching** — a bank or PhilHealth remittance file reconciled against settled claims,
   with partial remittances and multiple claims per remittance.
7. **Reconciliation and audit** — an immutable submission log, a claim-to-remittance trail, and
   retention that satisfies the payer and the BIR.
8. **Security and privacy** — PHI encryption at rest and in transit, role separation, and an access
   log that is server-side and tamper-evident. The current audit trail is browser-local.

Until those exist, the screen must keep saying that the workflow is simulated. It does.
