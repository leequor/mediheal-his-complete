# Data model

One page for every persisted record in MediHeal. Read this before adding a store.

Everything lives in **browser storage**. It does not synchronise between devices, between browser
profiles, or between two people signed in on the same machine at different times. All records are
synthetic. Nothing here is a hospital database.

---

## 1. Ownership

| Module | Owns | Never does |
|---|---|---|
| `HIS.store` (`assets/js/store.js`) | every `mh_*` key; typed read, safe write, pub/sub | know what a record means |
| `HIS.registry` (`assets/js/registry.js`) | `mh_patients`, `mh_guardians`; account↔patient links | write clinical or financial records |
| `HIS.accounts` (`assets/js/accounts.js`) | `mh_accounts` | create patients |
| `HIS.auth` (`assets/js/auth.js`) | the session (`mh_session` / sessionStorage) | hold profile data |
| `HIS.ledger` (`assets/js/ledger.js`) | `mh_tx` — every movement of money | store a balance on an invoice |
| `HIS.audit` (`assets/js/audit.js`) | `mh_audit` | accept a password |
| `HIS.lab` (`assets/js/lab.js`) | `mh_lab` | invent a result |
| `HIS.pharmacy` (`assets/js/pharmacy.js`) | `mh_rx`, `mh_stock` | dispense expired stock |

Modules that only *read* another module's store must go through its API. Two files must never
compute the same number from the same records — that is how Billing and Reports drifted apart
before M7.

---

## 2. Keys

| Key | Shape | Written by |
|---|---|---|
| `mh_accounts` | `Account[]` | Accounts screen |
| `mh_patients` | `Patient[]` | Registration, portal sign-up |
| `mh_guardians` | `Guardian[]` | Accounts → Patient portal access |
| `mh_tx` | `Transaction[]` | Billing → Record payment, refunds |
| `mh_lab` | `LabOrder[]` | Laboratory |
| `mh_rx` | `Prescription[]` | Consultation, Pharmacy |
| `mh_stock` | `StockBatch[]` | Pharmacy |
| `mh_audit` | `AuditRow[]` | every module |
| `mh_regs_extra`, `mh_appts_extra` | owner-entered rows | Registration / Appointments forms |
| `mh_*_state` | module UI state | Attendance, Nursing, Consultation, Treatment |
| `mh_profile_requests` | `ProfileRequest[]` | patient portal |

`HIS.store.reset()` deliberately leaves `mh_regs_extra` and `mh_appts_extra` alone: they hold work
the owner entered by hand.

---

## 3. Records

### Account
```
{ id:'USR-0001', email, name, role, dept, title,
  patientId,              // ← the ONLY link from a login to a patient record
  status:'active'|'disabled', verifier, createdAt, lastLogin, resetRequired, seeded }
```
`verifier` is a fast non-cryptographic digest, not a password hash. See `docs/AUTH.md`.

### Patient
```
{ id:'PT-99213', name, first, middle, last, age, dob, sex, civil,
  mobile, email,
  address:{ street, barangay, city, province, zip, region },
  emergency:{ name, relation, mobile },
  bloodType, allergies,
  philhealth:{ no, category, memberSince, dependents, eligibility, verifiedAt },
  hmo:{ provider, memberId, plan, loa, coverage, status },
  type:'Inpatient'|'Outpatient', dept, doctor,
  registered, status, attention, ward, bed, admittedAt,
  createdAt, createdBy }
```
`HIS.patients` is a **getter** onto this table, so a module that reads the legacy array cannot see a
different patient list than the portal does.

### Guardian
```
{ id:'GD-0001', accountId, patientId, relationship, scope, status:'active'|'revoked',
  authorizedBy, authorizedAt, reference, revokedAt, revokedBy, revokeReason }
```
A guardian row is the only way one account may read another patient's record. Surname, phone number
and email are explicitly **not** authorisation.

### Transaction
```
{ id:'TX-0001', kind:'payment'|'refund'|'adjustment', invoiceId, patientId,
  method, reference, amount,          // amount in CENTAVOS, integer
  at, cashier, status:'posted'|'pending'|'void', notes, seeded }
```
`pending` means an electronic payment was recorded but no provider confirmation exists. It does not
reduce the balance. Only `posted` moves money.

### Invoice
Invoices live in `HIS.billing.bills` (seed data) and are **never** the source of truth for money:

```
billed    = b.amount
paid      = sum(posted transactions for b.id)      ← HIS.ledger.paidOf(b)
balance   = billed − paid                          ← HIS.ledger.balanceOf(b)
status    = derived, never stored                  ← HIS.ledger.statusOf(b)
```

---

## 4. Money

Amounts are **integers in centavos** inside the ledger, converted once at the boundary
(`toCentavos` / `toPesos`). This is why `0.1 + 0.2` cannot drift. Invoice seeds are still written in
pesos because they are presentation data; they are converted on the way in.

`b.paid` and `b.status` may still exist on an invoice record for backwards compatibility. **Nothing
reads them any more.** If you find code reading them, it is a bug.

---

## 5. Invariants

The stores enforce these. Do not add a screen that can break one.

1. An account has at most one `patientId`, and a patient has at most one owning account
   (`registry.linkAccount` refuses the second).
2. A guardian link needs an existing account and an existing patient.
3. A payment cannot exceed the outstanding balance (`ledger.recordPayment`).
4. An electronic payment needs a provider reference and lands as `pending`.
5. A refund cannot exceed what was received.
6. Stock cannot go negative; an expired batch cannot be dispensed.
7. A result cannot be validated before it is entered.
8. Every mutation writes an audit row with before and after.

---

## 6. Migrations

`HIS.store.version` is 1. Seeding is lazy and idempotent: a store seeds only when its key is absent,
so a browser that already holds records is never overwritten.

The one migration so far is the M7 ledger seed: invoices that already carried a `paid` figure got a
single `seeded: true` opening transaction for exactly that amount, so on-screen totals did not move
while their provenance changed from "a number on the invoice" to "a row in the ledger".

---

## 7. What a real backend would need

- A relational store with `patient`, `account`, `encounter`, `order`, `invoice`, `transaction`,
  `stock_batch` tables and foreign keys — the invariants above become constraints, not checks.
- Server-side authentication (Argon2id) and a session cookie the browser cannot read.
- An append-only audit table, not a localStorage array.
- Per-tenant row-level security so a guardian link is enforced by the database, not by a UI filter.
- Idempotency keys on payment recording.
