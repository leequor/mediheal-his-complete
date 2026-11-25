# Feature matrix

Every relevant capability, classified by what the code actually does. Written from the repository at
M12 with session 46 corrections. Current audit evidence: [AUDIT-RELEASE.md](AUDIT-RELEASE.md).

**Legend**

| # | Class | Meaning |
|---|---|---|
| 1 | **Verified** | Implemented and exercised by a test harness or inspected on screen |
| 2 | **Under-tested** | Implemented; covered thinly or only by inspection |
| 3 | **Partial** | Some of the workflow exists; a stated part does not |
| 4 | **Presentational** | A control or card exists but performs no operation |
| 5 | **Missing** | Not implemented |
| 6 | **Blocked** | Needs a credential, a legal decision or an external system |
| 7 | **Deferred** | Deliberately not done; reason recorded |

---

## A. Identity and access

| Capability | Class | Note |
|---|---|---|
| Email + password sign-in | 1 | `auth-check.mjs` 25 assertions |
| Session persistence (30-day / 12-hour) | 1 | Two storage mechanisms, both tested |
| Session expiry | 1 | Tested by advancing the clock |
| Sign-out clears session | 1 | Back button cannot reveal a protected page |
| 12 roles with distinct permissions | 1 | Page guards and action-level writer checks; `roles-check.mjs` 110 checks |
| Page guard before render | 1 | Redirect happens before any DOM is written |
| Navigation scoped per role | 1 | Single `NAV` table in `rbac.js` |
| Account create / edit / deactivate | 1 | Super Administrator only |
| Last-Super-Admin protection | 1 | Demote and deactivate both refused |
| Password reset | 1 | No email is sent; the new password is shown once |
| Password hashing | 3 | FNV-1a digest, not a password hash. Labelled in `docs/AUTH.md` |
| Server-enforced authorisation | 5 | Client-side only |
| Rate limiting / lockout | 5 | Not modelled |
| MFA | 5 | Not modelled |

## B. Patient identity

| Capability | Class | Note |
|---|---|---|
| Single patient registry | 1 | `HIS.patients` is a getter over `mh_patients` |
| Patient identifiers (MRN) | 1 | `PT-#####`, monotonic |
| Demographics, contacts, emergency contact | 1 | Registration forms |
| Duplicate detection | 1 | Probable / possible, never auto-merges |
| Duplicate resolution UI | 3 | Detection is shown; merging is not implemented |
| Patient search and filter | 1 | Registry and every module picker |
| Patient profile and history | 1 | Consultation, treatment, laboratory, billing |
| Patient ↔ account link | 1 | `account.patientId`, one account per record |
| Guardian relationships | 1 | Separate table with scope and revocation |
| Patient status | 1 | Admitted / Discharged / Waiting / In Consultation / Completed |
| Cross-module references | 1 | Encounter, order, charge, invoice all carry `patientId` |

## C. Outpatient workflow

| Capability | Class | Note |
|---|---|---|
| Appointment booking | 1 | With duplicate prevention |
| Confirm / reschedule / cancel | 1 | Status transitions |
| Check-in | 1 | Sets the patient to Waiting |
| Consultation queue | 1 | Per-department filter, live search |
| Consultation record | 1 | Chief complaint, history, vitals, visit details |
| Diagnosis capture | 1 | Persisted per patient, reopens prefilled |
| Consultation → laboratory order | 1 | Treatment "Order tests" raises a real order |
| Consultation → prescription | 1 | Treatment "Prescribe" raises a real prescription |
| **Consultation fee on completion** | 1 | M12: saving the diagnosis raises the configured fee once per encounter |
| Encounter lifecycle | 1 | Open, close visit, cancel; one open per patient |
| Discharge from clinic | 1 | "Close visit" on the Charges screen |

## D. Laboratory

| Capability | Class | Note |
|---|---|---|
| Test catalogue with prices | 1 | 13 tests, synthetic tariffs |
| Order → collect → process → result → validate | 1 | Every transition guarded |
| Specimen information | 3 | Collection time and collector only; no specimen type/volume/rejection |
| Rejected specimen | 5 | Not modelled |
| Result entry with reference range | 1 | Flag computed mechanically |
| Critical-result acknowledgement | 1 | Strip on the screen, audited |
| Result release to the portal | 1 | Only `Validated` is released |
| Result correction with history | 1 | Archives the released value |
| Cancellation with billing policy | 1 | Voids before collection, retains after |
| Duplicate order prevention | 3 | Duplicate *charge* is prevented; a duplicate order is allowed |
| Charge on order | 1 | Priced from the catalogue |
| Charge void on cancellation | 1 | Policy stated on the order |

## E. Pharmacy

| Capability | Class | Note |
|---|---|---|
| Batch-level stock | 1 | One row per lot |
| First-expiry-first-out | 1 | `batchesFor()` sorts by expiry |
| Expired-batch block | 1 | Refused in the store, not the screen |
| Negative stock block | 1 | Refused |
| Prescription verify / reject | 1 | |
| Dispense (full and partial) | 1 | Charge per dispense event |
| Prescription balance enforcement | 1 | Cannot exceed the remaining authorised quantity |
| Return of a dispensing event | 1 | M12: full reversal, stock restored, charge voided |
| Partial return | 7 | Refused rather than approximated |
| Stock receive / adjust / dispose | 1 | Every movement audited |
| Procurement / supplier orders | 5 | Not modelled |

## F. Inpatient (M12)

| Capability | Class | Note |
|---|---|---|
| Admission record | 1 | Diagnosis, attending, payer, bed |
| Bed inventory | 1 | 172 beds, six wards, three types |
| Bed occupancy | 1 | Derived from the active admission |
| Bed board | 1 | Per-ward grid, state change, admit/transfer from a bed |
| Double-booking prevention | 1 | Refused at admission and at transfer |
| Transfer with history | 1 | Append-only, never overwrites |
| Room-and-board accrual | 1 | Per billable day, idempotent, at the bed rate |
| Nursing daily accrual | 1 | Same mechanism |
| Noon billing cutoff | 1 | Documented rule, tested at boundaries |
| Discharge with final accrual | 1 | Runs accrual through the discharge time |
| Bed release on discharge | 1 | Bed moves to `cleaning` |
| Discharge summary | 1 | Required field |
| Discharge reversal | 1 | Original kept in `dischargeHistory` |
| Outstanding-balance review at discharge | 1 | Shown in the dialog and returned by the store |
| Bed reservation / planned admission | 5 | Not modelled |
| Housekeeping workflow | 3 | A `cleaning` state only |
| Inter-facility transfer | 5 | Not modelled |

## G. Revenue

| Capability | Class | Note |
|---|---|---|
| Charge master with effective dates | 1 | `tariffs.js`, versioned rows |
| Price snapshot per charge | 1 | Frozen at creation |
| Charge → encounter association | 1 | M12: no guessing |
| Persistent unbilled queue | 1 | Charge survives with no invoice |
| Charge assignment (audited, reasoned) | 1 | Refuses wrong patient, duplicate |
| Charge unassignment | 1 | Audited |
| Charge void with reason | 1 | Row kept |
| Charge reversal by source event | 1 | Laboratory cancel, pharmacy return |
| Invoice creation | 1 | M12: `mh_invoices` |
| Invoice total (single definition) | 1 | `ledger.invoiceAmount` |
| Payments, partial payments | 1 | `ledger-check.mjs` 46 assertions |
| Electronic payment intent + confirmation | 1 | `pending` never counts as money |
| Refunds | 1 | Cannot exceed what was received |
| Credits (unapplied money) | 1 | Recorded, never netted off a balance |
| Coverage / discounts / adjustments | 1 | Separate transaction kinds |
| Receipt generation | 3 | PDF invoice download exists; no separate receipt document |
| Credit notes | 7 | A reversal is a void, not a negative line |
| VAT per charge line | 7 | Opening VAT only |
| Payer-specific price tiers | 7 | One price per code |
| Charge master administration screen | 1 | M12: `settings.html` — current price per code, new effective-dated row, per-code history |

## H. Claims

| Capability | Class | Note |
|---|---|---|
| 13-state lifecycle | 1 | `claims-check.mjs` 41 assertions |
| Role-gated transitions | 1 | |
| Document checklist | 1 | |
| Partial approval | 1 | |
| Denial / appeal | 1 | |
| Settlement posts coverage once | 1 | Capped at outstanding; excess unapplied |
| Claim ↔ invoice / patient / payer | 1 | |
| Real insurer submission | 6 | No PhilHealth eClaims credential |
| Eligibility check | 6 | No payer API |
| Remittance matching | 6 | No remittance file |

## I. Workforce

| Capability | Class | Note |
|---|---|---|
| Employee master with pay basis | 1 | Monthly / daily / hourly |
| Attendance register | 1 | 128 seeded records |
| Day types (regular, special, rest) | 1 | |
| Overtime / night differential | 1 | Classified before pricing |
| Timesheet approval | 1 | Gate on payroll |
| Timesheet correction + reopening | 1 | Invalidates approval |
| Payroll runs with versions | 1 | Draft → reviewed → approved → released |
| Released payroll immutability | 1 | Corrections are separate runs |
| Payslip | 1 | Printable, every earning and deduction line |
| Statutory tables with sources | 1 | SSS, PhilHealth, Pag-IBIG, BIR |
| Wage-floor enforcement | 1 | Effective-dated orders, NCR and Region VII verified |
| 13th month | 1 | PD 851 basis |
| Proration for hires/separations | 7 | No hire/separation date on the record |
| Article 83 sixth-day premium | 7 | Undetermined; city population not on record |
| 15 regional wage orders | 7 | Registered, refused as `unverified` |
| Government payroll filing | 6 | No authorisation |

## J. Reporting and portal

| Capability | Class | Note |
|---|---|---|
| Billing / collection report | 1 | Derived from the ledger |
| Unbilled charges by source | 1 | M12 |
| Bed occupancy | 1 | M12, derived from admissions |
| Invoice table with status | 1 | Status derived, never stored |
| Payroll / attendance summary | 3 | Payroll screens carry it; no consolidated report page |
| Audit activity report | 1 | Audit screen with filters |
| Patient volume / appointments report | 5 | Not modelled as a report |
| Portal: profile, appointments, results, bills | 1 | Six views |
| Portal: released results only | 1 | Draft results are filtered out |
| Portal: claims / coverage status | 3 | Shown inside the statement, not as its own view |
| Portal: admission information | 3 | Not surfaced as its own view |
| Portal: route-level authorisation | 1 | Tested by direct navigation, not by hiding links |

## K. Administration

| Capability | Class | Note |
|---|---|---|
| User and role administration | 1 | Accounts screen |
| Department configuration | 3 | Read from `data-departments.js`; listed read-only on Configuration |
| Laboratory catalogue | 3 | Read from `lab.js`; listed read-only on Configuration |
| Pharmacy stock administration | 1 | Receive / adjust / dispose |
| Bed configuration | 3 | Read from `WARDS` in `admissions.js`; listed read-only on Configuration |
| Service and consultation tariffs | 1 | `settings.html`: append an effective-dated price, view history |
| Payer and coverage configuration | 5 | Payer data lives on the patient record |
| Audit log | 1 | Append-only in the UI; no delete control |

---

## Summary

| Class | Count |
|---|---|
| 1 Verified | 109 |
| 2 Under-tested | 0 |
| 3 Partial | 12 |
| 4 Presentational | 0 |
| 5 Missing | 9 |
| 6 Blocked | 4 |
| 7 Deferred | 7 |
| **Total** | **141** |

No capability is classified **presentational**. The `buttons.mjs` sweep reports zero controls that do
nothing, and the Claims screen's previously inert table rows were fixed in M10.
