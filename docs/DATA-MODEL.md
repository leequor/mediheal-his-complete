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
| `HIS.employees` (`assets/js/employees.js`) | the salary master (in code, not storage) | store a per-period amount |
| `HIS.attendancePeriod` (`assets/js/attendance-period.js`) | `mh_attendance_period` — one record per employee per day, plus the timesheet status | compute money |
| `HIS.payrollRuns` (`assets/js/payroll-runs.js`) | `mh_payroll_runs` — runs, versions, blocked lists | recompute statutory tables itself |
| `HIS.wageFloor` (`assets/js/wage-floor.js`) | the effective-dated wage orders (in code) | set anyone's pay |
| `HIS.payrollCorrections` (`assets/js/payroll-corrections.js`) | `mh_payroll_corrections` — correction runs linked to a released run | edit the released run |
| `HIS.claims` (`assets/js/claims.js`) | `mh_claims` — claim records and their history | post money; it asks the ledger |
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
| `mh_attendance_period` | `{ period, records[], timesheets{} }` | Attendance, Payroll → Timesheets |
| `mh_payroll_runs` | `{ runs[] }` | Payroll |
| `mh_payroll_corrections` | `{ corrections[] }` | Payroll → corrections |
| `mh_claims` | `{ claims[], version, seededAt }` | Claims |

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
9. One payroll run per pay period; one line per employee (`payrollRuns.create` refuses a second run).
10. A payroll run cannot be approved while any timesheet is unapproved or any line's attendance
    fingerprint differs from the live timesheet.
11. A claim cannot be approved above the amount requested, and cannot be denied, partially approved
    or closed without a reason.
12. A settlement posts exactly one `coverage` row; the claim id is the ledger `sourceId`.
13. An invoice satisfies `charge = collected + covered + outstanding` to the centavo, and no balance
    is negative (`ledger.invariants()`).
14. A `credit` transaction never reduces a balance and is never counted as collected or covered.
15. A claim settlement posts at most the outstanding balance; the excess is `unappliedAmount`.
16. A released payroll is never mutated. Corrections are separate records linked by `originalRunId`.
17. A correction cannot be created twice from the same run, differences and reason (fingerprint).

---

### AttendanceRecord (M10)
```
{ id:'EMP-001:2026-08-16', empId, date, dayType:'regular'|'rest'|'regular-holiday'|'special',
  holiday, shiftStart, shiftEnd, breakMinutes, timeIn, timeOut,
  status:'present'|'late'|'undertime'|'absent'|'leave'|'rest'|'holiday',
  leaveType, leaveApproved, otHours, ndHours, lateMinutes, undertimeMinutes, worked,
  note, history:[{ at, by, before, after, reason }] }
```
Times are `HH:MM` in 24-hour form so payroll can subtract them; the screen formats them for display.
A night shift crosses midnight, so `timeOut < timeIn` means "+1 day", not "negative hours".

### Timesheet
```
{ status:'submitted'|'approved', submittedBy, submittedAt, approvedBy, approvedAt,
  reopenedAt, history:[{ at, by, action, note }] }
```
Payroll's `summary(empId)` returns `null` unless `status === 'approved'`.

### PayrollRun (M10)
```
{ id:'PR-2026-08-16-1', periodId, periodLabel, payDate, frequency,
  version, status:'draft'|'reviewed'|'approved'|'released',
  lines:[{ employeeId, monthlyBasic, periodBasic, earnings{}, statutory{}, employer{},
           taxable, tax, other, deductions, net, days{}, lines[], attendanceFingerprint }],
  blocked:[{ employeeId, name, reason }],
  totals:{ headcount, gross, deductions, net, sss, philhealth, pagibig, tax, employerTotal },
  createdAt, createdBy, history[], versions[] }
```
`versions[]` holds a deep copy of the lines and totals before each recompute, so an earlier
calculation is never lost. `attendanceFingerprint` is compared with the live timesheet when the run
is approved; a mismatch blocks approval until the run is recomputed.

### Employee compensation configuration (M10.1, extended in M10.3)
```
payBasis: 'monthly' | 'daily' | 'hourly'
monthlyBasic | dailyRate | hourlyRate
schedule: { daysPerWeek, hoursPerDay, normalWorkdaysPerMonth, paidRestDays, paidSpecialDays }
payPolicy: 'MH-PAY-2026.1'
payEffectiveFrom: '2026-01-01'
wage: { region:'NCR', sector:'non-agriculture', locality, category:'hospital',
        effectiveFrom, exemption:{ code, reference } | absent }
```
`payBasis` decides the daily-rate method and is never inferred from the salary. `schedule.hoursPerDay`
is the employee's own normal day: the hourly rate divides the daily rate by it, so a part-timer on
four hours divides by four. `payPolicy` names the effective-dated policy that supplies the daily-rate
factor (261 today). `wage.locality` is used where an order splits by area rather than industry, as
Region VII does. `wage.exemption` is only present when a lawful reason to sit below the floor exists,
and it must carry a reference.

### CorrectionRun (M10.1)
```
{ id:'CR-0001', originalRunId, originalVersion, periodId, periodLabel, frequency,
  reason, status:'draft'|'reviewed'|'approved'|'released',
  lines:[{ employeeId, originalNet, correctedNet, alreadyCorrected, difference,
           kind:'underpayment'|'overpayment', payable, receivable,
           recovery:{ status, authorized, reference, method } | null,
           components:{ basic, overtime, night, premium, allowances, sss, philhealth, pagibig, tax },
           attendance:{ absenceDays, lateMinutes, overtimeHours, nightHours } }],
  skipped:[{ employeeId, reason }],
  totals:{ employees, underpayment, overpayment, net },
  fingerprint, createdAt, createdBy, history[] }
```
`fingerprint` is the duplicate guard: the original run, the per-employee differences and the reason.
`alreadyCorrected` is what earlier released corrections paid for the same employee and run, so a
second correction pays the increment only.

### Claim (M10)
See `docs/CLAIMS.md` §1. The one field the ledger cares about is `settlement.transactionId`: a claim
with a settlement cannot settle again, and the ledger refuses a second `coverage` row with the same
`sourceId`.

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
- Idempotency keys on payment recording (the demo already accepts `idempotencyKey` and `sourceId`).
- A payroll run table with a unique constraint on `(period_id, employee_id)` and an approval record
  that cannot be edited after release.
- A claim table with a status-transition trigger, so an illegal transition is rejected by the
  database rather than by a JavaScript guard.
